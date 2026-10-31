import {
  MODULES,
  WILDCARD_PERMISSION,
  isKnownPermission,
  isPlatformAdminOnly,
} from "../permissions/catalog.js";
import { isAlwaysLicensed, isModuleLicensed, isPermissionLicensed } from "../permissions/module-licensing.js";
import { FREE_SUB_MODULES, isSubModule } from "../entitlements/sub-modules.js";
import { resolvePermissions } from "../permissions/resolve.js";
import { can, type AuthContext } from "../permissions/auth-context.js";
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
  constructor(
    readonly permission: string,
    /** The catalog module that is not licensed — for `"*"`, the first one it would unlock. */
    readonly module?: string,
  ) {
    super(
      permission === WILDCARD_PERMISSION
        ? `صلاحية المدير الكامل "*" تشمل كل الوحدات، والوحدة "${module}" غير مرخصة لهذا المستأجر`
        : `الصلاحية "${permission}" تابعة لوحدة غير مرخصة لهذا المستأجر`,
    );
    this.name = "UnlicensedPermissionError";
  }
}

export class PlatformOnlyPermissionError extends Error {
  readonly code = "PLATFORM_ONLY_PERMISSION";
  constructor(readonly permission: string) {
    super(`الصلاحية "${permission}" مخصصة لمدير المنصة ولا يمكن منحها من داخل المنشأة`);
    this.name = "PlatformOnlyPermissionError";
  }
}

export class UngrantablePermissionError extends Error {
  readonly code = "PRIVILEGE_ESCALATION_DENIED";
  constructor(readonly permission: string) {
    super(`لا يمكنك منح صلاحية لا تملكها: "${permission}"`);
    this.name = "UngrantablePermissionError";
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
 * True when `actor` may put `code` into a role.
 *
 * A `"*"` holder holds everything the tenant has — `can()` says so — EXCEPT the
 * codes the catalog reserves for the platform operator. Those are not part of
 * the wildcard: the operator holds them by an explicit grant, and a tenant
 * admin who could hand them out would be minting authority over the platform
 * that sold them the licence.
 */
function actorHolds(actor: AuthContext, code: string): boolean {
  if (isPlatformAdminOnly(code)) return actor.permissions.has(code);
  return can(actor, code);
}

/**
 * The module a permission belongs to, refused when the tenant is not licensed
 * for it. `"*"` is no longer exempt (D85 — the exemption let a tenant licensed
 * for nothing mint full admin), but it is measured against whether the tenant
 * is licensed for ANY licensable module, not all of them: the catalog always
 * carries a module no tenant is licensed for (`pos` has no domain, routes or
 * persistence in this repo), so requiring the full set would make an admin
 * role un-mintable on every install. The wildcard confers no unlicensed module
 * either way — `AuthContext` resolves it against entitlements downstream.
 */
function assertLicensed(permission: string, entitlements: Entitlements): void {
  if (permission === WILDCARD_PERMISSION) {
    const licensable = MODULES.filter((m) => !isAlwaysLicensed(m.id));
    // A paid part listed on its own counts; a free part does not — it is held by a tenant licensed for nothing.
    const holdsPaidPart = entitlements.activeModules.some((id) => isSubModule(id) && !FREE_SUB_MODULES.has(id));
    if (!holdsPaidPart && !licensable.some((m) => isModuleLicensed(m.id, entitlements))) {
      throw new UnlicensedPermissionError(WILDCARD_PERMISSION, licensable[0]?.id);
    }
    return;
  }
  // A permission tied to a sub-module (the HR staff list, payroll, …) is licensed by its part.
  if (!isPermissionLicensed(permission, entitlements)) {
    throw new UnlicensedPermissionError(permission);
  }
}

/**
 * Creates or updates a custom role. Validates every permission code is both
 * known to the catalog and grantable under the tenant's current entitlements
 * (reuses `isKnownPermission` + `isModuleLicensed` — no re-derivation of the
 * catalog), and that the role code stays unique. System roles are immutable.
 *
 * A role is a bundle of authority, so writing one is a GRANT and `actor` is
 * therefore not optional: without it "you may not grant more than you hold"
 * was enforced nowhere in the domain, and `"*"` — which outranks every named
 * code — was exempt from the licence check on top of that (D85).
 *
 * The grant is measured against the RESOLVED closure of the submitted set, not
 * the raw ticked boxes: granting `.confirm` implies `.view_own`, so a caller
 * who holds neither must not hand out the implied one either.
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
  actor: AuthContext,
): Promise<Role> {
  for (const permission of cmd.permissions) {
    if (!isKnownPermission(permission)) {
      throw new UnknownPermissionError(permission);
    }
    assertLicensed(permission, entitlements);
  }

  for (const permission of resolvePermissions(cmd.permissions)) {
    if (isPlatformAdminOnly(permission) && !actorHolds(actor, permission)) {
      throw new PlatformOnlyPermissionError(permission);
    }
    if (!actorHolds(actor, permission)) {
      throw new UngrantablePermissionError(permission);
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

