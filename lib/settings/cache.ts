import { getOwnerSettings, DEFAULT_OWNER_SETTINGS, type OwnerSettings } from './repo';

/**
 * Short-lived in-process cache for the redirect path.
 *
 * The redirect handler should not issue an extra query on every click, and a
 * settings change should still take effect promptly. A 60-second TTL is a
 * reasonable compromise for a low-traffic personal service.
 *
 * This is a best-effort optimisation only: any failure falls back to defaults
 * so a redirect is never delayed or broken by settings.
 */
const TTL_MS = 60_000;

let cache = new Map<string, { value: OwnerSettings; expiresAt: number }>();

export function invalidateSettingsCache(ownerId?: string): void {
  if (ownerId) cache.delete(ownerId);
  else cache = new Map();
}

export async function getCachedOwnerSettings(ownerId: string): Promise<OwnerSettings> {
  const now = Date.now();
  const hit = cache.get(ownerId);
  if (hit && hit.expiresAt > now) return hit.value;

  try {
    const value = await getOwnerSettings(ownerId);
    cache.set(ownerId, { value, expiresAt: now + TTL_MS });
    return value;
  } catch {
    return DEFAULT_OWNER_SETTINGS;
  }
}

/** Test seam: drop all cached settings. */
export function __resetSettingsCacheForTests(): void {
  cache = new Map();
}