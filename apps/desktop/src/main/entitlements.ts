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

/**
 * Resolves the desktop edition's current `Entitlements` (docs/archive/plan.md §2.5).
 *
 * STUBBED SEAM: the real path is the Ed25519 offline license file (§2.5) —
 * `verifyLicense()` in @mezan/domain/licensing, wired to a real machine
 * `FingerprintSource` and a persisted monotonic-clock store. That activation
 * flow (fingerprinting per OS, the request/response air-gapped code UX, the
 * signing-key/public-key distribution) is its own, larger piece of work
 * (docs/archive/plan.md Phase 8 "Licensing service + activation portal") and is
 * OUT OF SCOPE here — this issue only needs a real `Entitlements` object to
 * gate LAN mode against, not the full activation UX.
 *
 * Until that lands, this reads a pre-verified entitlements JSON blob from
 * `MEZAN_ENTITLEMENTS_JSON` (validated against the SAME `entitlementsSchema`
 * the license payload itself uses) and falls back to `UNLICENSED_ENTITLEMENTS`
 * — never to a permissive default — when it's absent or invalid. Swapping in
 * real license verification later only touches this one function.
 */
export function resolveDesktopEntitlements(
  env: Record<string, string | undefined> = process.env,
): EntitlementsView {
  return parseDesktopEntitlementsJson(env) ?? UNLICENSED_ENTITLEMENTS;
}

/**
 * Parses the dev/back-compat `MEZAN_ENTITLEMENTS_JSON` blob, returning `null`
 * (not the unlicensed fallback) when it is absent or invalid — so the license
 * resolver can tell "no dev entitlements configured" apart from "configured but
 * empty". This env path is a DEVELOPER CONVENIENCE only; a packaged build
 * derives entitlements from the verified license, never from this var.
 */
export function parseDesktopEntitlementsJson(
  env: Record<string, string | undefined> = process.env,
): EntitlementsView | null {
  const raw = env["MEZAN_ENTITLEMENTS_JSON"];
  if (!raw) return null;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    console.warn(
      "[entitlements] MEZAN_ENTITLEMENTS_JSON is not valid JSON — falling back to unlicensed",
      err,
    );
    return null;
  }

  const parsed = entitlementsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    console.warn(
      "[entitlements] MEZAN_ENTITLEMENTS_JSON failed schema validation — falling back to unlicensed",
      parsed.error.flatten(),
    );
    return null;
  }

  return createEntitlements(parsed.data);
}

/**
 * WHAT THE LICENCE SCREEN SAYS, as opposed to what the licence PERMITS.
 *
 * `main/license-runtime.ts` owns the real decision now: it verifies the signed
 * `license.mezan` and produces the state the write gate enforces (ACTIVE /
 * GRACE / READ_ONLY). Nothing here grants anything.
 *
 * This is only the human-readable reading of the DEV entitlements seam, kept
 * because `mezan:licence:status` reports two facts the verified licence does not
 * carry — the LAN address and the certificate fingerprint a consultant needs to
 * pair a till — and needs a short, stable code to read down the phone beside
 * them.
 *
 * FOLLOW-UP: once that channel reports the verified licence state directly, this
 * and `LicenceStatusNotice` collapse into `LicenseBanner`. Until then treat
 * `LicenseBanner` as authoritative on whether posting is allowed; this can only
 * ever say something about the env seam.
 */
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

const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

function diagnosis(
  status: DesktopLicenceStatus,
  entitlements: EntitlementsView,
): DesktopEntitlementsDiagnosis {
  return { entitlements, status, code: CODE[status], detailAr: DETAIL_AR[status] };
}

export function diagnoseDesktopEntitlements(
  env: Record<string, string | undefined> = process.env,
  clock: Clock = SYSTEM_CLOCK,
): DesktopEntitlementsDiagnosis {
  const raw = env["MEZAN_ENTITLEMENTS_JSON"];
  if (!raw) return diagnosis("missing", UNLICENSED_ENTITLEMENTS);

  const entitlements = parseDesktopEntitlementsJson(env);
  if (!entitlements) {
    // `parseDesktopEntitlementsJson` collapses both failures to null and logs
    // which one it was; the distinction matters only to the support code, so it
    // is re-derived here rather than widening that function's return type.
    try {
      JSON.parse(raw);
      return diagnosis("invalid", UNLICENSED_ENTITLEMENTS);
    } catch {
      return diagnosis("malformed", UNLICENSED_ENTITLEMENTS);
    }
  }

  // The same comparison licensing/license.ts §5 makes, and no other: a null
  // `expiresAt` is a perpetual grant, and an unparseable one is treated as
  // not-expired there too rather than as a licence to revoke.
  const expiresAt = entitlements.expiresAt === null ? NaN : Date.parse(entitlements.expiresAt);
  if (!Number.isNaN(expiresAt) && clock.now() > expiresAt) {
    return diagnosis("expired", entitlements);
  }

  return diagnosis("licensed", entitlements);
}
