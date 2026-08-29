import { createEntitlements, type EntitlementsView } from "@mezan/domain";
import { entitlementsSchema } from "@mezan/contracts";

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
  const raw = env["MEZAN_ENTITLEMENTS_JSON"];
  if (!raw) return UNLICENSED_ENTITLEMENTS;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    console.warn(
      "[entitlements] MEZAN_ENTITLEMENTS_JSON is not valid JSON — falling back to unlicensed",
      err,
    );
    return UNLICENSED_ENTITLEMENTS;
  }

  const parsed = entitlementsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    console.warn(
      "[entitlements] MEZAN_ENTITLEMENTS_JSON failed schema validation — falling back to unlicensed",
      parsed.error.flatten(),
    );
    return UNLICENSED_ENTITLEMENTS;
  }

  return createEntitlements(parsed.data);
}
