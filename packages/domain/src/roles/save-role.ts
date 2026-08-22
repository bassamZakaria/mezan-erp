import { isKnownPermission } from "../permissions/catalog.js";
import { isModuleLicensed } from "../permissions/module-licensing.js";
import type { Entitlements } from "../entitlements/entitlements.js";
import type { UnitOfWork } from "../journal.js";
import type { Role } from "./role.js";

export class UnknownPermissionError extends Error {
  readonly code = "UNKNOWN_PERMISSION";
  constructor(readonly permission: string) {
    super(`صلاحية غير معروفة: ${permission}`);
    this.name = "UnknownPermissionError";
  }
}

export class UnlicensedPermissionError extends Error {
  readonly code = "UNLICENSED_PERMISSION";
  constructor(readonly permission: string) {
    super(`الصلاحية "${permission}" تابعة لوحدة غير مرخصة لهذا المستأجر`);
    this.name = "UnlicensedPermissionError";
  }
}

export class DuplicateRoleCodeError extends Error {
  readonly code = "DUPLICATE_ROLE_CODE";
  constructor(readonly roleCode: string) {
    super(`يوجد دور بالفعل بالكود "${roleCode}"`);
    this.name = "DuplicateRoleCodeError";
  }
}

export class SystemRoleImmutableError extends Error {
  readonly code = "SYSTEM_ROLE_IMMUTABLE";
  constructor(readonly roleId: string) {
    super(`الدور "${roleId}" هو دور نظام ولا يمكن تعديله`);
    this.name = "SystemRoleImmutableError";
  }
}

export class RoleNotFoundError extends Error {
  readonly code = "ROLE_NOT_FOUND";
  constructor(readonly roleId: string) {
    super(`الدور "${roleId}" غير موجود`);
    this.name = "RoleNotFoundError";
  }
}

export class RoleInUseError extends Error {
  readonly code = "ROLE_IN_USE";
  constructor(readonly roleId: string) {
    super(`الدور "${roleId}" مُسند إلى مستخدم واحد أو أكثر ولا يمكن حذفه`);
    this.name = "RoleInUseError";
  }
}

export interface SaveRoleCommand {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  /** Raw granted permission codes — deduplicated by this use-case. */
  readonly permissions: readonly string[];
  readonly createdAt: string;
}

/**
 * Creates or updates a custom role. Validates every permission code is both
 * known to the catalog and grantable under the tenant's current entitlements
 * (reuses `isKnownPermission` + `isModuleLicensed` — no re-derivation of the
 * catalog), and that the role code stays unique. System roles are immutable.
 *
 * The permission set is stored exactly as submitted (deduplicated) — the UI
 * is expected to have already closed it over its dependency graph via
 * `togglePermission`, and `AuthContext` resolves the closure again downstream
 * regardless, so this is a defence-in-depth validation, not a rewrite.
 */
export async function saveRole(
  cmd: SaveRoleCommand,
  uow: UnitOfWork,
  entitlements: Entitlements,
): Promise<Role> {
  for (const permission of cmd.permissions) {
    if (!isKnownPermission(permission)) {
      throw new UnknownPermissionError(permission);
    }
    if (permission !== "*" && !isModuleLicensed(permissionModule(permission), entitlements)) {
      throw new UnlicensedPermissionError(permission);
    }
  }

  const existingByCode = await uow.roles.findByCode(cmd.code);
  if (existingByCode && existingByCode.id !== cmd.id) {
    throw new DuplicateRoleCodeError(cmd.code);
  }

  const existingById = await uow.roles.findById(cmd.id);
  if (existingById?.isSystem) {
    throw new SystemRoleImmutableError(cmd.id);
  }

  const role: Role = {
    id: cmd.id,
    code: cmd.code,
    name: cmd.name,
    description: cmd.description,
    permissions: Array.from(new Set(cmd.permissions)),
    isSystem: existingById?.isSystem ?? false,
    createdAt: existingById?.createdAt ?? cmd.createdAt,
  };

  await uow.roles.save(role);
  return role;
}

/** Deletes a custom role. System roles and roles still assigned to a user are protected. */
export async function deleteRole(roleId: string, uow: UnitOfWork): Promise<void> {
  const role = await uow.roles.findById(roleId);
  if (!role) throw new RoleNotFoundError(roleId);
  if (role.isSystem) throw new SystemRoleImmutableError(roleId);

  const users = await uow.users.list();
  if (users.some((u) => u.roleId === roleId)) {
    throw new RoleInUseError(roleId);
  }

  await uow.roles.delete(roleId);
}

function permissionModule(code: string): string {
  const dotIndex = code.indexOf(".");
  return dotIndex === -1 ? code : code.slice(0, dotIndex);
}
