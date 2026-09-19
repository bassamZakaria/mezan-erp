import type { App } from "@mezan/api";
import { getPermission, isModuleLicensed, type Entitlements } from "@mezan/domain";
import type { SeedFragmentContext, SeedPerson, SeedRole } from "./fragments.js";
import { POS_SEED_FRAGMENTS } from "./pos.js";
import { ENH_SEED_FRAGMENTS } from "./enh.js";
import { step } from "./shared.js";

const FRAGMENTS = [...POS_SEED_FRAGMENTS, ...ENH_SEED_FRAGMENTS];

export interface SeedLicensing extends SeedFragmentContext {
  /**
   * `POST /roles` refuses a code whose module the tenant is not licensed for,
   * so fragment grants are narrowed to what this tenant holds — the cloud
   * demo's plan carries no `pos` (DEC-23) and must still seed.
   */
  readonly grantable: (codes: readonly string[]) => string[];
}

export async function seedLicensing(app: App): Promise<SeedLicensing> {
  const entitlements = (await step(app, "GET", "/entitlements")) as Entitlements;
  return {
    licensed: (moduleId) => entitlements.activeModules.includes(moduleId),
    grantable: (codes) =>
      codes.filter((code) => {
        const moduleId = getPermission(code)?.module;
        return moduleId === undefined || isModuleLicensed(moduleId, entitlements);
      }),
  };
}

export function fragmentRoles(licensing: SeedLicensing): SeedRole[] {
  return FRAGMENTS.flatMap((f) => f.roles ?? [])
    .map((role) => ({ ...role, permissions: licensing.grantable(role.permissions) }))
    .filter((role) => role.permissions.length > 0);
}

export function fragmentPeople(roleCodes: ReadonlySet<string>): SeedPerson[] {
  return FRAGMENTS.flatMap((f) => f.people ?? []).filter((p) => p.role === null || roleCodes.has(p.role));
}

export function fragmentGrantsFor(roleCode: string, licensing: SeedLicensing): string[] {
  return licensing.grantable(FRAGMENTS.flatMap((f) => f.roleGrants?.[roleCode] ?? []));
}

export async function seedFragments(app: App): Promise<void> {
  const licensing = await seedLicensing(app);
  for (const fragment of FRAGMENTS) await fragment.run?.(app, licensing);
}
