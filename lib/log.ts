/**
 * Structured operational logging.
 *
 * Rules enforced here, not left to callers:
 *  - secrets, API keys, session cookies and Authorization headers never appear;
 *  - query parameters and User-Agent strings are never logged verbatim;
 *  - caller identity is a short hash, never a raw IP address;
 *  - correlation ids are per-request and are NOT a persistent visitor id.
 *
 * Output is a single JSON line per event so platform log drains can index it.
 */

export type Severity = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Severity, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function configuredLevel(): Severity {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return raw === 'debug' || raw === 'warn' || raw === 'error' ? raw : 'info';
}

/** Field names that must never be logged, matched case-insensitively. */
const FORBIDDEN_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'secret',
  'token',
  'api_key',
  'api-key',
  'apikey',
  'x-api-key',
  'key',
  'supabase_service_role_key',
  'anon_key',
  'destination_url',
  'destination',
  'notes',
  'note',
  'user_agent',
  'user-agent',
  'referer',
  'referrer',
  'ip',
  'ip_address',
  'x-forwarded-for'
]);

const MAX_STRING = 200;

export function redactString(value: string): string {
  const truncated = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  // Defence in depth: strip anything that looks like a bearer token or a key.
  return truncated
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bgo_[A-Za-z0-9_-]{16,}\b/g, '[redacted-key]');
}

/**
 * Remove or replace sensitive values.
 *
 * Unknown nested objects are dropped entirely rather than risk leaking a field
 * we did not anticipate.
 */
export function redact(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const lower = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(lower)) {
      output[key] = '[redacted]';
      continue;
    }
    if (value === null || value === undefined) {
      output[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      output[key] = redactString(value);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      output[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      output[key] = value.slice(0, 20).map((item) =>
        typeof item === 'string' ? redactString(item) : typeof item === 'number' || typeof item === 'boolean' ? item : '[redacted]'
      );
      continue;
    }
    // Nested objects are not logged; field-level control is the caller's job.
    output[key] = '[object]';
  }

  return output;
}

let currentCorrelationId: string | null = null;

export function setCorrelationId(id: string): void {
  currentCorrelationId = id;
}

export function getCorrelationId(): string | null {
  return currentCorrelationId;
}

/**
 * Derive a short correlation id from an incoming request id, or generate one.
 *
 * This identifies one request, not one visitor: it is never persisted and is
 * not shared between requests.
 */
export function correlationIdFrom(headers?: Headers): string {
  const incoming = headers?.get('x-request-id');
  if (incoming && /^[\w-]{8,64}$/.test(incoming)) return incoming.slice(0, 64);
  return `req_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export type LogFields = Record<string, unknown>;

/**
 * Emit one structured log line.
 *
 * Errors are recorded by *name* rather than message: driver messages can contain
 * connection strings or row contents.
 */
export function logEvent(
  event: string,
  severity: Severity = 'info',
  fields: LogFields = {}
): void {
  if (LEVEL_ORDER[severity] < LEVEL_ORDER[configuredLevel()]) return;

  const record = {
    ts: new Date().toISOString(),
    level: severity,
    event,
    ...(currentCorrelationId ? { request_id: currentCorrelationId } : {}),
    ...redact(fields)
  };

  const line = JSON.stringify(record);
  if (severity === 'error') console.error(line);
  else if (severity === 'warn') console.warn(line);
  else console.log(line);
}

export function logError(event: string, error: unknown, fields: LogFields = {}): void {
  logEvent(
    event,
    'error',
    {
      ...fields,
      // Name only: messages can embed secrets or row data.
      error_type: error instanceof Error ? error.name : typeof error
    }
  );
}

/** Canonical event names, so alerts can key on them. */
export const EVENTS = {
  redirectError: 'redirect.error',
  redirectDbTimeout: 'redirect.db_timeout',
  redirectRateLimited: 'redirect.rate_limited',
  clickRecordFailed: 'analytics.click_record_failed',
  assignmentFailed: 'analytics.assignment_failed',
  rateLimitStoreUnavailable: 'ratelimit.store_unavailable',
  rateLimitBlocked: 'ratelimit.blocked',
  authRateLimited: 'auth.login_rate_limited',
  loginFailed: 'auth.login_failed',
  linkCreated: 'links.created',
  linkCreateRejected: 'links.create_rejected',
  qrRateLimited: 'qr.rate_limited',
  exportRateLimited: 'export.rate_limited',
  apiRateLimited: 'api.rate_limited',
  apiDenied: 'api.denied',
  cronRun: 'cron.run',
  cronFailed: 'cron.failed',
  purgeCompleted: 'retention.purge_completed',
  readyCheckFailed: 'health.readiness_failed'
} as const;

/**
 * Events also recorded in Postgres via `lib/observability`.
 *
 * Deliberately a small, explicit subset. stdout is the right place for
 * high-volume request logging but is not queryable, so a handful of rare,
 * security-relevant events are additionally persisted to make questions like
 * "how many failed logins overnight?" answerable.
 *
 * The redirect hot path is intentionally absent: a database write per redirect
 * would make the cheapest operation the most expensive one.
 */
export const PERSISTED_EVENTS = {
  loginFailed: EVENTS.loginFailed,
  authRateLimited: EVENTS.authRateLimited,
  apiDenied: EVENTS.apiDenied,
  apiRateLimited: EVENTS.apiRateLimited,
  linkCreateRejected: EVENTS.linkCreateRejected,
  cronRun: EVENTS.cronRun,
  cronFailed: EVENTS.cronFailed,
  purgeCompleted: EVENTS.purgeCompleted,
  readyCheckFailed: EVENTS.readyCheckFailed,
  rateLimitStoreUnavailable: EVENTS.rateLimitStoreUnavailable,
  linkPasswordPrompted: 'links.password_prompted'
} as const;

export type PersistedEvent = (typeof PERSISTED_EVENTS)[keyof typeof PERSISTED_EVENTS];
