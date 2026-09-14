import { platformSessionSchema, type PlatformSessionDTO } from "@mezan/contracts";

export type PlatformSession = PlatformSessionDTO;

const PLATFORM_SESSION_STORAGE_KEY = "mezan.platform.session";

function getSessionStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Privacy mode / disabled storage can throw on access rather than just being absent.
    return null;
  }
}

/**
 * Restores the last persisted platform session on load, so a page refresh
 * doesn't sign the operator out. Validated against {@link platformSessionSchema}
 * — a missing, corrupt, or stale-shaped stored value is treated as no session.
 */
export function loadPersistedPlatformSession(): PlatformSession | null {
  const storage = getSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(PLATFORM_SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = platformSessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Persists the platform session (or, for `null` — e.g. on sign-out — clears it) so it survives a page refresh. */
export function persistPlatformSession(session: PlatformSession | null): void {
  const storage = getSessionStorage();
  if (!storage) return;
  if (session) storage.setItem(PLATFORM_SESSION_STORAGE_KEY, JSON.stringify(session));
  else storage.removeItem(PLATFORM_SESSION_STORAGE_KEY);
}
