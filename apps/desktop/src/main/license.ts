import { createEntitlements, verifyLicense } from "@mezan/domain";
import type {
  Clock,
  EntitlementsView,
  FingerprintSource,
  LicenseVerifyResult,
  MonotonicClockStore,
} from "@mezan/domain";
import type { LicenseStateView } from "@mezan/api";
import { defaultMachineIdReader, type MachineIdReader } from "./machine-fingerprint.js";

/**
 * Wires the Ed25519 offline license (docs/archive/plan.md §2.5) into the desktop
 * edition — closing D115, where `resolveDesktopEntitlements` read an UNSIGNED
 * `MEZAN_ENTITLEMENTS_JSON` env var straight into `createEntitlements` while
 * `verifyLicense` (signature + expiry + fingerprint + grace) was called by
 * nothing the shipped binary ran, so anyone with shell access granted
 * themselves any plan.
 *
 * The whole decision — entitlements AND whether writes are allowed — now comes
 * from the verified license. The pure part (`decideLicense`) is unit-tested;
 * the fs/exec/clock adapters are thin and injected.
 *
 * NOT in scope here (Phase 8 — the activation portal): fingerprinting UX,
 * air-gapped activation codes, key distribution. This reads an already-issued
 * `license.mezan` from disk and enforces it.
 */

/** Fully-closed entitlements — an install with no valid license licenses nothing. */
const UNLICENSED_ENTITLEMENTS: EntitlementsView = createEntitlements({
  plan: "UNLICENSED",
  activeModules: [],
  features: {},
  seats: 0,
  expiresAt: null,
});

/** State for the write-gate + banner when no authentic license is present. */
export const UNLICENSED_STATE: LicenseStateView = {
  state: "UNLICENSED",
  canWrite: false,
  usable: true,
  reason: "NO_LICENSE",
};

/** Dev/back-compat state: writable, no real license. Never for a packaged build. */
const DEV_WRITABLE_STATE: LicenseStateView = {
  state: "ACTIVE",
  canWrite: true,
  usable: true,
};

export interface DesktopLicense {
  readonly entitlements: EntitlementsView;
  readonly state: LicenseStateView;
}

/** Maps the domain's verify result to the transport-facing state view. */
export function mapVerifyResult(result: LicenseVerifyResult): LicenseStateView {
  const payload = result.payload;
  if (!payload) {
    return {
      state: result.state,
      canWrite: result.canWrite,
      usable: result.usable,
      reason: result.reason,
    };
  }
  const expiresAtMs = Date.parse(payload.expiresAt);
  const graceEndsAt =
    result.state === "GRACE" && !Number.isNaN(expiresAtMs)
      ? new Date(expiresAtMs + payload.graceDays * 86_400_000).toISOString()
      : undefined;
  return {
    state: result.state,
    canWrite: result.canWrite,
    usable: result.usable,
    licensee: payload.licensee,
    expiresAt: payload.expiresAt,
    ...(graceEndsAt ? { graceEndsAt } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

export interface DecideLicenseInput {
  /** Raw `license.mezan` contents, or null when no license file is present. */
  readonly licenseRaw: string | null;
  /** Vendor Ed25519 public key (hex), or null when not configured. */
  readonly publicKey: string | null;
  readonly fingerprintSalt: string;
  /** True for a packaged/production build — the fail-closed posture applies. */
  readonly packaged: boolean;
  /** Dev-only pre-verified entitlements JSON (`MEZAN_ENTITLEMENTS_JSON`). */
  readonly devEntitlements: EntitlementsView | null;
  readonly clock: Clock;
  readonly fingerprintSource: FingerprintSource;
  readonly monotonicStore: MonotonicClockStore;
}

/**
 * The pure license decision. A packaged build with no authentic license fails
 * CLOSED (read-only, `UNLICENSED`) — never to a permissive default — while a
 * dev build with nothing configured stays writable so first-run works. When a
 * license file IS present it is verified in full; the ethic holds even on
 * failure: `usable` keeps data viewable, only `canWrite` gates new postings.
 */
export async function decideLicense(input: DecideLicenseInput): Promise<DesktopLicense> {
  if (input.licenseRaw) {
    if (!input.publicKey) {
      // A license exists but we cannot verify it — treat as unusable-for-writes
      // rather than trusting it.
      return {
        entitlements: UNLICENSED_ENTITLEMENTS,
        state: { ...UNLICENSED_STATE, reason: "NO_PUBLIC_KEY" },
      };
    }
    const result = await verifyLicense(input.licenseRaw, {
      publicKey: input.publicKey,
      clock: input.clock,
      fingerprintSource: input.fingerprintSource,
      fingerprintSalt: input.fingerprintSalt,
      monotonicStore: input.monotonicStore,
    });
    return {
      entitlements: result.entitlements ?? UNLICENSED_ENTITLEMENTS,
      state: mapVerifyResult(result),
    };
  }

  // No license file. Dev entitlements are a developer convenience only.
  if (input.devEntitlements && !input.packaged) {
    return { entitlements: input.devEntitlements, state: DEV_WRITABLE_STATE };
  }

  // Unpackaged with nothing configured: stay writable so `pnpm start` works.
  if (!input.packaged) {
    return {
      entitlements: createEntitlements({
        plan: "DEV",
        activeModules: [],
        features: {},
        seats: 999,
        expiresAt: null,
      }),
      state: DEV_WRITABLE_STATE,
    };
  }

  // Packaged, no license: fully closed, read-only, awaiting activation.
  return { entitlements: UNLICENSED_ENTITLEMENTS, state: UNLICENSED_STATE };
}

// ---------------------------------------------------------------------------
// Real adapters — thin bindings over fs/exec/clock, injected into decideLicense.
// ---------------------------------------------------------------------------

/** Wall clock. */
export const systemClock: Clock = { now: () => Date.now() };

/** Machine-fingerprint source over the per-OS reader. */
export function createFingerprintSource(
  reader: MachineIdReader = defaultMachineIdReader,
): FingerprintSource {
  return { read: async () => reader(process.platform) };
}

/**
 * File-backed monotonic-clock guard: the greatest wall-clock value ever seen,
 * persisted so a clock rollback between runs (a common offline-license bypass)
 * is caught. Writes are best-effort; a persistence failure must never brick a
 * legitimately-licensed install, so it degrades to "no high-water recorded".
 */
export function createMonotonicClockStore(
  filePath: string,
  fs: {
    readFile(p: string): string | null;
    writeFile(p: string, data: string): void;
  },
): MonotonicClockStore {
  return {
    async getHighWaterMark() {
      const raw = fs.readFile(filePath);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { highWater?: unknown };
        return typeof parsed.highWater === "number" ? parsed.highWater : null;
      } catch {
        return null;
      }
    },
    async record(epochMs: number) {
      try {
        fs.writeFile(filePath, JSON.stringify({ highWater: epochMs }));
      } catch {
        // Best-effort; never fatal.
      }
    },
  };
}
