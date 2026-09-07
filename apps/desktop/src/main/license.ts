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
import {
  checkinMessageAr,
  type CheckinDecision,
  type LicenseGuardStore,
} from "./license-checkin.js";

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

/**
 * A BUILD PROBLEM, NOT A CUSTOMER PROBLEM — and the two must not read alike.
 *
 * `NO_PUBLIC_KEY` means this binary was produced without the vendor key baked
 * into it, so it cannot verify any licence, including a correct one the shop
 * has paid for and installed. Showing «لا يوجد ترخيص مُفعّل» there blames the
 * shop for something only the vendor's release pipeline can fix, and sends them
 * to buy a second copy of what they already own.
 */
export const NO_PUBLIC_KEY_MESSAGE_AR =
  "هذه النسخة من ميزان بُنيت بدون مفتاح المورّد، ولا يمكنها التحقق من أي ملف ترخيص. " +
  "المشكلة في النسخة نفسها وليست في ترخيصك. تواصل مع الدعم للحصول على نسخة صحيحة.";

/** Facts about the licence the rest of the process needs, beyond the gate view. */
export interface LicenseIdentity {
  /** `payload.licenseId` — what the check-in must send, not the state enum. */
  readonly licenseId: string | null;
  /** This machine's SALTED fingerprint hash. Support reads it for a rebind. */
  readonly fingerprint: string | null;
  /** The licence's signed start date — the check-in clock's origin. */
  readonly notBefore: string | null;
  readonly expiresAt: string | null;
  readonly graceDays: number | null;
}

export const UNKNOWN_IDENTITY: LicenseIdentity = {
  licenseId: null,
  fingerprint: null,
  notBefore: null,
  expiresAt: null,
  graceDays: null,
};

export interface DesktopLicense {
  readonly entitlements: EntitlementsView;
  readonly state: LicenseStateView;
  /**
   * True ONLY when a signed licence file produced this decision. A dev build
   * with nothing configured is writable but not verified, and must not have its
   * (empty) module list gate anything.
   */
  readonly verified: boolean;
  readonly identity: LicenseIdentity;
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
      fingerprint: result.fingerprint ?? null,
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
    fingerprint: result.fingerprint ?? null,
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
      // rather than trusting it. The message says whose fault it is.
      return {
        entitlements: UNLICENSED_ENTITLEMENTS,
        state: {
          ...UNLICENSED_STATE,
          reason: "NO_PUBLIC_KEY",
          messageAr: NO_PUBLIC_KEY_MESSAGE_AR,
        },
        verified: false,
        identity: UNKNOWN_IDENTITY,
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
      verified: result.entitlements !== null,
      identity: {
        licenseId: result.payload?.licenseId ?? null,
        fingerprint: result.fingerprint ?? null,
        notBefore: result.payload?.notBefore ?? null,
        expiresAt: result.payload?.expiresAt ?? null,
        graceDays: result.payload?.graceDays ?? null,
      },
    };
  }

  // No license file. Dev entitlements are a developer convenience only.
  if (input.devEntitlements && !input.packaged) {
    return {
      entitlements: input.devEntitlements,
      state: DEV_WRITABLE_STATE,
      verified: false,
      identity: UNKNOWN_IDENTITY,
    };
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
      verified: false,
      identity: UNKNOWN_IDENTITY,
    };
  }

  // Packaged, no license: fully closed, read-only, awaiting activation.
  return {
    entitlements: UNLICENSED_ENTITLEMENTS,
    state: UNLICENSED_STATE,
    verified: false,
    identity: UNKNOWN_IDENTITY,
  };
}

/**
 * THE PER-REQUEST VERDICT (L-3, L-7).
 *
 * The write gate used to close over one `const verdict` computed at startup, so
 * two things could not happen: pressing «تحقق الآن» could not lift read-only
 * without a restart — the handler wrote the file and nothing re-read it — and a
 * licence that expired during a session left open for weeks was never noticed.
 *
 * This is what `resolveLicenseState` calls on every mutating request: a small
 * file read plus arithmetic, no signature check (the signature was verified at
 * startup and the payload cannot change under us), so it is cheap enough to run
 * per request and honest enough to change its mind mid-session.
 */
export function reevaluateLicenseState(
  base: DesktopLicense,
  params: { readonly now: number; readonly checkin: CheckinDecision },
): LicenseStateView {
  let state = base.state;

  // 1. The licence's own clock, re-read now rather than at startup.
  if (base.verified && base.identity.expiresAt !== null && state.usable) {
    const expiresAt = Date.parse(base.identity.expiresAt);
    const graceDays = base.identity.graceDays ?? 0;
    if (!Number.isNaN(expiresAt)) {
      const graceEnd = expiresAt + graceDays * 86_400_000;
      if (params.now <= expiresAt) {
        state = { ...state, state: "ACTIVE", canWrite: true, usable: true };
      } else if (params.now <= graceEnd) {
        state = {
          ...state,
          state: "GRACE",
          canWrite: true,
          usable: true,
          graceEndsAt: new Date(graceEnd).toISOString(),
        };
      } else {
        state = {
          ...state,
          state: "READ_ONLY",
          canWrite: false,
          usable: true,
          reason: "EXPIRED_PAST_GRACE",
        };
      }
    }
  }

  // 2. The check-in verdict, folded in only for an AUTHENTIC licence. An
  //    install with no licence at all must keep saying so — "your check-in is
  //    overdue" would be a wrong answer to "you never had one".
  if (!base.verified) return state;

  const { verdict, daysSince, blocking } = params.checkin;
  if (verdict === "revoked") {
    return {
      ...state,
      state: "REVOKED",
      canWrite: false,
      usable: true,
      reason: "REVOKED",
      messageAr: checkinMessageAr("revoked", 0),
      blocking: true,
    };
  }
  if (verdict === "tampered") {
    return {
      ...state,
      state: "TAMPERED",
      canWrite: false,
      usable: true,
      reason: "GUARD_TAMPERED",
      messageAr: checkinMessageAr("tampered", 0),
      blocking: true,
    };
  }
  if (verdict === "read-only" || verdict === "blocked") {
    return {
      ...state,
      state: "READ_ONLY",
      canWrite: false,
      usable: true,
      reason: "CHECKIN_OVERDUE",
      messageAr: checkinMessageAr(verdict, daysSince),
      daysSince,
      blocking,
    };
  }
  return state;
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
 * Monotonic-clock guard over the MAC'd guard record: the greatest wall-clock
 * value ever seen, so a clock rollback between runs (a common offline-license
 * bypass) is caught.
 *
 * It shares ONE record with `lastVerifiedAt` and the install stamp rather than
 * living in its own `license-clock.json`, because those three facts have to be
 * consistent with each other to mean anything — the cross-check
 * `decideCheckin` performs — and because a separate unsigned file was simply
 * deletable. Writes are best-effort; a persistence failure must never brick a
 * legitimately-licensed install.
 */
export function createGuardMonotonicStore(store: LicenseGuardStore): MonotonicClockStore {
  return {
    async getHighWaterMark() {
      const read = store.read();
      // A record we cannot vouch for must not be allowed to LOWER the bar: it
      // is reported as no history here, and `decideCheckin` refuses it
      // separately with TAMPERED, so nothing is granted by the ambiguity.
      return read.integrity === "ok" ? read.record.highWater : null;
    },
    async record(epochMs: number) {
      try {
        const read = store.read();
        if (read.integrity === "tampered") return;
        store.write({
          ...read.record,
          highWater: Math.max(read.record.highWater ?? 0, epochMs),
        });
      } catch {
        // Best-effort; never fatal.
      }
    },
  };
}
