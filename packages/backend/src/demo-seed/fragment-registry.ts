import type { App } from "@mezan/api";
import type { SeedPerson, SeedRole } from "./fragments.js";
import { POS_SEED_FRAGMENTS } from "./pos.js";
import { ENH_SEED_FRAGMENTS } from "./enh.js";

const FRAGMENTS = [...POS_SEED_FRAGMENTS, ...ENH_SEED_FRAGMENTS];

export const FRAGMENT_ROLES: readonly SeedRole[] = FRAGMENTS.flatMap((f) => f.roles ?? []);
export const FRAGMENT_PEOPLE: readonly SeedPerson[] = FRAGMENTS.flatMap((f) => f.people ?? []);

export function fragmentGrantsFor(roleCode: string): readonly string[] {
  return FRAGMENTS.flatMap((f) => f.roleGrants?.[roleCode] ?? []);
}

export async function seedFragments(app: App): Promise<void> {
  for (const fragment of FRAGMENTS) await fragment.run?.(app);
}
