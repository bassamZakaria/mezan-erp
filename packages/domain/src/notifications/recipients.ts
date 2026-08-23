import { WILDCARD_PERMISSION } from "../permissions/catalog.js";
import { resolvePermissions } from "../permissions/resolve.js";
import type { RoleRepository } from "../roles/role.js";
import type { UserRepository } from "../users/user.js";
import type { NotificationDraft } from "./evaluate.js";

/**
 * Recipient resolution port — turns a rule's declarative recipient
 * (`permission` / `role` / `user`) into concrete user ids. Kept behind a port so
 * evaluation stays a pure function and the engine never reaches into a
 * repository itself.
 */
export interface NotificationDirectory {
  /** Active users whose EFFECTIVE permission set contains `code` (admins always do). */
  usersWithPermission(code: string): Promise<readonly string[]>;
  usersInRole(roleId: string): Promise<readonly string[]>;
  userExists(userId: string): Promise<boolean>;
}

/**
 * The real directory over the tenant's users + roles. A role stores the RAW
 * ticked codes, so the effective set is resolved through the same dependency
 * closure `AuthContext` uses — otherwise a user granted `sales.invoice.confirm`
 * would not match a rule addressed to `sales.invoice.view_own`.
 */
export function createNotificationDirectory(
  users: UserRepository,
  roles: RoleRepository,
): NotificationDirectory {
  async function effectivePermissions(roleId: string | null): Promise<ReadonlySet<string>> {
    if (!roleId) return new Set<string>();
    const role = await roles.findById(roleId);
    if (!role) return new Set<string>();
    return resolvePermissions(role.permissions);
  }

  return {
    async usersWithPermission(code) {
      const all = await users.list();
      const matched: string[] = [];
      for (const user of all) {
        if (user.status !== "active") continue;
        if (user.isCompanyAdmin) {
          matched.push(user.id);
          continue;
        }
        const effective = await effectivePermissions(user.roleId);
        if (effective.has(code) || effective.has(WILDCARD_PERMISSION)) matched.push(user.id);
      }
      return matched;
    },
    async usersInRole(roleId) {
      const all = await users.list();
      return all.filter((u) => u.status === "active" && u.roleId === roleId).map((u) => u.id);
    },
    async userExists(userId) {
      const user = await users.findById(userId);
      return user !== null && user.status === "active";
    },
  };
}

/** Resolves one draft's recipient spec to the distinct user ids to deliver to. */
export async function resolveRecipients(
  draft: NotificationDraft,
  directory: NotificationDirectory,
): Promise<readonly string[]> {
  switch (draft.recipientType) {
    case "permission":
      return [...new Set(await directory.usersWithPermission(draft.recipientValue))];
    case "role":
      return [...new Set(await directory.usersInRole(draft.recipientValue))];
    case "user":
      return (await directory.userExists(draft.recipientValue)) ? [draft.recipientValue] : [];
    default:
      return [];
  }
}
