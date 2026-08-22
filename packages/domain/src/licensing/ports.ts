/**
 * Licensing ports — the seams the domain depends on so it stays pure and
 * portable (docs/plan.md §2.5). Adapters bind the real sources: the desktop
 * app reads the OS machine id + a persisted last-seen clock; tests pass stubs.
 */

/**
 * Wall-clock source. Behind a port so the monotonic guard is testable and so
 * verification never reaches for a global `Date.now()` directly.
 */
export interface Clock {
  /** Current time, epoch milliseconds. */
  now(): number;
}

/**
 * The raw machine fingerprint source (Windows MachineGuid / macOS
 * IOPlatformUUID / Linux /etc/machine-id — §2.5). STUBBED behind this port; the
 * domain only ever sees the raw identity string and hashes it with a salt, so
 * no raw identifier is ever stored.
 */
export interface FingerprintSource {
  read(): Promise<string>;
}

/**
 * Persistence for the monotonic-clock guard: the greatest wall-clock value the
 * app has ever observed. If `now()` comes back materially earlier, the system
 * clock was rolled back (a common offline-license bypass) and we flag tampering.
 */
export interface MonotonicClockStore {
  /** Highest previously-recorded epoch ms, or null on first run. */
  getHighWaterMark(): Promise<number | null>;
  record(epochMs: number): Promise<void>;
}
