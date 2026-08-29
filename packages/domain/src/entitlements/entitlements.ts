/**
 * Entitlements — the one capability object every gate in the codebase reads
 * (docs/archive/plan.md §2.5). It has the SAME shape in both editions: cloud derives it
 * from the subscription record / JWT, desktop from the signed license file. A
 * gate calls `has('pos')` / `hasFeature('pos.restaurant_mode')` and neither
 * knows nor cares which source produced it.
 */

export interface Entitlements {
  readonly plan: string;
  /** Per-tenant module toggle list gating the whole nav (recon §tenant payload). */
  readonly activeModules: readonly string[];
  /** Finer-grained per-capability flags layered under module activation. */
  readonly features: Readonly<Record<string, boolean>>;
  readonly seats: number;
  /** ISO timestamp, or null for a perpetual/no-expiry grant. */
  readonly expiresAt: string | null;
}

export interface EntitlementsView extends Entitlements {
  has(module: string): boolean;
  hasFeature(flag: string): boolean;
}

export function hasModule(ent: Entitlements, module: string): boolean {
  return ent.activeModules.includes(module);
}

export function hasFeature(ent: Entitlements, flag: string): boolean {
  return ent.features[flag] === true;
}

/**
 * Wraps raw entitlement data with the `has` / `hasFeature` convenience methods.
 * The wrapper is a plain frozen object (no class) so it serializes cleanly.
 */
export function createEntitlements(data: Entitlements): EntitlementsView {
  return Object.freeze({
    plan: data.plan,
    activeModules: data.activeModules,
    features: data.features,
    seats: data.seats,
    expiresAt: data.expiresAt,
    has(module: string) {
      return hasModule(data, module);
    },
    hasFeature(flag: string) {
      return hasFeature(data, flag);
    },
  });
}
