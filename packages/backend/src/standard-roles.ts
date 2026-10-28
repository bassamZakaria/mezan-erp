import { getPermission, isKnownPermission, isModuleLicensed, withAttachmentPermissions, type Entitlements, type Role, type UnitOfWork } from "@mezan/domain";
import { seededRoles } from "./demo-seed/access.js";

const STANDARD_ROLE_ID_PREFIX = "ROLE-STD-";
const HELD_BY_EVERY_ROLE = /^(dashboard\.view$|hr\.self\.)/;

/**
 * The roles a shop separates — the same definitions the demo tenant is seeded
 * with, and none of its data. A fresh install used to hold the system role
 * alone, which cannot be given to anyone but an administrator, so the owner
 * had to author a role before the first cashier could exist.
 *
 * INVARIANT: a role is given only the permissions the licence carries, and a
 * role left with nothing of its own is not created.
 */
export async function ensureStandardRoles(uow: UnitOfWork, entitlements: Entitlements, now: () => Date = () => new Date()): Promise<string[]> {
  const grantable = (codes: readonly string[]): string[] =>
    codes.filter((code) => {
      if (!isKnownPermission(code)) return false;
      const moduleId = getPermission(code)?.module;
      return moduleId === undefined || isModuleLicensed(moduleId, entitlements);
    });
  const created: string[] = [];
  for (const definition of seededRoles({ licensed: (moduleId) => isModuleLicensed(moduleId, entitlements), grantable })) {
    const licensedPermissions = grantable(definition.permissions);
    if (!licensedPermissions.some((code) => !HELD_BY_EVERY_ROLE.test(code))) continue;
    const permissions = withAttachmentPermissions(licensedPermissions);
    if (await uow.roles.findByCode(definition.code)) continue;
    const role: Role = {
      id: `${STANDARD_ROLE_ID_PREFIX}${definition.code}`,
      code: definition.code,
      name: definition.name,
      description: definition.description,
      permissions,
      isSystem: false,
      createdAt: now().toISOString(),
    };
    await uow.roles.save(role);
    created.push(definition.code);
  }
  return created;
}
