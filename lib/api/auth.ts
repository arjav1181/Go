import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/db/supabase-server';
import { isOwnerEmail } from '@/lib/auth/owner';
import {
  hashApiKey,
  safeHashEquals,
  looksLikeApiKey,
  parseBearerToken
} from '@/lib/api/keys';
import { parseScopes, hasScope, consumeRateLimit, type Scope } from '@/lib/api/scopes';

/**
 * Consistent error envelope for every API response.
 *
 * Shape: { "error": { "code": "...", "message": "..." } }
 * Codes are stable and safe to branch on; messages never contain internals.
 */
export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'insufficient_scope'
  | 'rate_limited'
  | 'invalid_request'
  | 'not_found'
  | 'rate_limit_not_configured'
  | 'server_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  insufficient_scope: 403,
  rate_limited: 429,
  invalid_request: 400,
  not_found: 404,
  rate_limit_not_configured: 503,
  server_error: 500
};

export function apiError(
  code: ApiErrorCode,
  message: string,
  extraHeaders: Record<string, string> = {}
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status: STATUS_BY_CODE[code], headers: extraHeaders }
  );
}

export type ApiAuthResult =
  | { ok: true; ownerId: string; scopes: Scope[] }
  | { ok: false; response: NextResponse };

/**
 * Authenticate, then authorise.
 *
 * Order matters: an unauthenticated caller never learns whether a scope is
 * valid, and a rate-limited caller is rejected before any database work beyond
 * key lookup.
 */
export async function authorizeApiRequest(
  request: Request,
  required: Scope
): Promise<ApiAuthResult> {
  const token = parseBearerToken(request.headers.get('authorization'));
  if (!token || !looksLikeApiKey(token)) {
    return {
      ok: false,
      response: apiError('unauthorized', 'Missing or invalid API key.')
    };
  }

  // Any unexpected failure (including missing database configuration) must
  // fail closed with 401 rather than surfacing a 500.
  let ownerId: string;
  let scopes: Scope[];
  let keyId: string;
  try {
    const candidateHash = hashApiKey(token);
    const supabase = getServiceSupabase();

    const { data: keys, error } = await supabase
      .from('api_keys')
      .select('id, key_hash, created_by, owner_email, scopes, revoked_at')
      .is('revoked_at', null);

    if (error) return { ok: false, response: apiError('unauthorized', 'Invalid API key.') };

    const match = (keys ?? []).find(
      (row: { key_hash: string }) => safeHashEquals(row.key_hash, candidateHash)
    );
    if (!match) return { ok: false, response: apiError('unauthorized', 'Invalid API key.') };

    if (!isOwnerEmail(match.owner_email)) {
      return { ok: false, response: apiError('forbidden', 'This key is not authorized.') };
    }

    ownerId = match.created_by;
    scopes = parseScopes(match.scopes);
    keyId = match.id;

    // Best-effort usage stamp; never fail the request over it.
    void supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyId);
  } catch {
    return { ok: false, response: apiError('unauthorized', 'Invalid API key.') };
  }

  // Rate limit after authentication, keyed on the key id (never the secret).
  const limit = consumeRateLimit(keyId);
  const headers = {
    'X-RateLimit-Limit': String(limit.limit),
    'X-RateLimit-Remaining': String(limit.remaining),
    'X-RateLimit-Reset': String(Math.floor(limit.resetAt / 1000))
  };
  if (!limit.allowed) {
    return {
      ok: false,
      response: apiError('rate_limited', 'Too many requests. Slow down and retry shortly.', {
        ...headers,
        'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000))
      })
    };
  }

  if (!hasScope(scopes, required)) {
    return {
      ok: false,
      response: apiError(
        'insufficient_scope',
        `This key lacks the "${required}" scope.`,
        headers
      )
    };
  }

  return { ok: true, ownerId, scopes };
}

export function apiJson(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(data, { status, headers });
}