import type { App } from "@mezan/api";

export interface SeedRole {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
}

export interface SeedPerson {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly local: string;
  readonly role: string | null;
  readonly status: "active" | "inactive";
  readonly branchScope?: readonly string[];
  readonly warehouseScope?: readonly string[];
  readonly employeeId?: string;
}

export interface SeedFragmentContext {
  /** Whether the tenant being seeded holds this entitlement module (the cloud demo plan does not hold `pos`). */
  readonly licensed: (moduleId: string) => boolean;
}

/**
 * A POS area's or an enhancement lane's share of the demo seed. `roles`,
 * `roleGrants` and `people` are folded into `seedAccess`; `run` goes through
 * the same HTTP routes as the rest of the seed, after the core profile and
 * before the historic periods close.
 */
export interface SeedFragment {
  readonly roles?: readonly SeedRole[];
  readonly roleGrants?: Readonly<Record<string, readonly string[]>>;
  readonly people?: readonly SeedPerson[];
  readonly run?: (app: App, ctx: SeedFragmentContext) => Promise<void>;
}
