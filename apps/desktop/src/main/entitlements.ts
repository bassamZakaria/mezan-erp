import { createEntitlements, type Clock, type EntitlementsView } from "@mezan/domain";
import { entitlementsSchema } from "@mezan/contracts";
import type { LicenceCode } from "../shared/ipc-contract.js";

/**
 * Safe default: nothing licensed, zero seats, LAN mode off. An install with
 * no entitlements source configured stays fully closed rather than silently
 * permissive — same "fail closed" posture as the module gate and LAN gate.
 */
const UNLICENSED_ENTITLEMENTS: EntitlementsView = createEntitlements({
  plan: "UNLICENSED",
  activeModules: [],
  features: {},
  seats: 0,
  expiresAt: null,
});

const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

/** What the resolver could work out about the licence, beyond the capability set. */
export type DesktopLicenceStatus = "licensed" | "missing" | "malformed" | "invalid" | "expired";

export interface DesktopEntitlementsDiagnosis {
  readonly entitlements: EntitlementsView;
  readonly status: DesktopLicenceStatus;
  /** Short, stable, and safe to read down the phone to support. */
  readonly code: LicenceCode;
  /** Arabic, ready to render. The screen shows `code` BESIDE it, never instead of it. */
  readonly detailAr: string;
}

const DETAIL_AR: Record<DesktopLicenceStatus, string> = {
  licensed: "الترخيص سارٍ.",
  missing:
    "لا يوجد ترخيص على هذا الجهاز. لم تُفعَّل أي وحدة، وخاصية تعدد نقاط البيع على الشبكة المحلية متوقفة.",
  malformed: "ملف الترخيص غير مقروء. يعمل النظام بدون ترخيص إلى أن يُستبدل.",
  invalid: "بيانات الترخيص لا تطابق الصيغة المتوقعة. يعمل النظام بدون ترخيص إلى أن يُستبدل.",
  expired: "انتهت صلاحية الترخيص. جدّد الاشتراك لدى الدعم للاستمرار في التحديثات والدعم.",
};

const CODE: Record<DesktopLicenceStatus, LicenceCode> = {
  licensed: "LIC-OK",
  missing: "LIC-MISSING",
  malformed: "LIC-MALFORMED",
  invalid: "LIC-INVALID",
  expired: "LIC-EXPIRED",
};

function diagnosis(
  status: DesktopLicenceStatus,
  entitlements: EntitlementsView,
): DesktopEntitlementsDiagnosis {
  return { entitlements, status, code: CODE[status], detailAr: DETAIL_AR[status] };
}

/**
 * Resolves the desktop edition's current `Entitlements` (docs/archive/plan.md §2.5)
 * AND says what it found, which is the half that was missing.
 *
 * IT ANSWERED EVERY FAILURE WITH A `console.warn` AND NOTHING ELSE. A missing,
 * malformed or schema-invalid `MEZAN_ENTITLEMENTS_JSON` fell to
 * `UNLICENSED_ENTITLEMENTS` — zero seats, no modules, no LAN — the window
 * opened, and the product was simply ABSENT: no message, no code to read down
 * the phone, nothing an owner or the consultant standing next to them could
 * act on. Falling closed is right; falling closed silently is not.
 *
 * EXPIRY DOES NOT WITHHOLD CAPABILITY HERE, deliberately. licensing/license.ts
 * states the ethic — "a licensing lapse NEVER withholds data" — and models the
 * real cutover as ACTIVE → GRACE → READ_ONLY, all of them `usable`, driven by
 * the `graceDays` the signed payload carries. `entitlementsSchema` has no
 * `graceDays`, so a hard cutoff invented here would take a shop offline on a
 * date with no grace and no warning — the opposite of the fix. Past `expiresAt`
 * this reports `expired` (and the screen says so, in Arabic, with LIC-EXPIRED)
 * while the capability set stays exactly as granted; the enforcement decision
 * belongs to `verifyLicense`, which already models it, when Phase 8 wires the
 * real Ed25519 licence file in place of this env-var seam.
 *
 * STUBBED SEAM: the real path is the Ed25519 offline license file (§2.5) —
 * `verifyLicense()` in @mezan/domain/licensing, wired to a real machine
 * `FingerprintSource` and a persisted monotonic-clock store. That activation
 * flow (fingerprinting per OS, the request/response air-gapped code UX, the
 * signing-key/public-key distribution) is its own, larger piece of work
 * (docs/archive/plan.md Phase 8 "Licensing service + activation portal") and is
 * OUT OF SCOPE here. FINGERPRINT_MISMATCH — "this licence belongs to another
 * machine" — has no code below for the same reason: nothing in this build reads
 * a machine fingerprint, so a state it cannot detect must not be one it claims
 * to report.
 */
export function diagnoseDesktopEntitlements(
  env: Record<string, string | undefined> = process.env,
  clock: Clock = SYSTEM_CLOCK,
): DesktopEntitlementsDiagnosis {
  const raw = env["MEZAN_ENTITLEMENTS_JSON"];
  if (!raw) return diagnosis("missing", UNLICENSED_ENTITLEMENTS);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    console.warn(
      "[entitlements] MEZAN_ENTITLEMENTS_JSON is not valid JSON — falling back to unlicensed",
      err,
    );
    return diagnosis("malformed", UNLICENSED_ENTITLEMENTS);
  }

  const parsed = entitlementsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    console.warn(
      "[entitlements] MEZAN_ENTITLEMENTS_JSON failed schema validation — falling back to unlicensed",
      parsed.error.flatten(),
    );
    return diagnosis("invalid", UNLICENSED_ENTITLEMENTS);
  }

  const entitlements = createEntitlements(parsed.data);

  // The same comparison licensing/license.ts §5 makes, and no other: a null
  // `expiresAt` is a perpetual grant, and an unparseable one is treated as
  // not-expired there too rather than as a licence to revoke.
  const expiresAt = entitlements.expiresAt === null ? NaN : Date.parse(entitlements.expiresAt);
  if (!Number.isNaN(expiresAt) && clock.now() > expiresAt) {
    console.warn(`[entitlements] licence expired at ${entitlements.expiresAt}`);
    return diagnosis("expired", entitlements);
  }

  return diagnosis("licensed", entitlements);
}

/**
 * The capability set alone, for the gates that only ever needed that much
 * (main/index.ts's `SeatSessionRegistry`, `createBackend`, `startLanHost`).
 * Kept as its own export so adding the diagnosis did not change what every
 * existing caller receives.
 */
export function resolveDesktopEntitlements(
  env: Record<string, string | undefined> = process.env,
): EntitlementsView {
  return diagnoseDesktopEntitlements(env).entitlements;
}
