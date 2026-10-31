/**
 * Composes the permission catalog with the entitlements engine: which catalog
 * modules — and therefore which permissions — are visible/grantable for a
 * tenant's current license (phase1 §"Users & Roles", building on the merged
 * permissions + entitlements engines rather than re-deriving either).
 *
 * A handful of catalog modules are core platform surface, not a licensable
 * module in `Entitlements.activeModules` (workflow, admin, audit) — those are
 * always visible. Everything else must match an active module, via
 * `CATALOG_TO_ENTITLEMENT_MODULE` where the id differs (the catalog's
 * `cheques` module is the `financial_papers` entitlement).
 */

import { hasAnyPartOf, hasModule, hasReadOnlyModule, type Entitlements } from "../entitlements/entitlements.js";
import { MODULES, PERMISSIONS, getPermission, type ModuleDef, type PermissionDef } from "./catalog.js";

/** Catalog module ids that are core platform surface, never entitlement-gated. */
const ALWAYS_LICENSED_MODULES: ReadonlySet<string> = new Set([
  "workflow",
  "admin",
  "audit",
  "dashboard",
]);

/** Catalog module id -> entitlement module id, only where they differ. */
const CATALOG_TO_ENTITLEMENT_MODULE: Readonly<Record<string, string>> = {
  cheques: "financial_papers",
};

/** True when `moduleId` is core platform surface, never entitlement-gated. */
export function isAlwaysLicensed(moduleId: string): boolean {
  return ALWAYS_LICENSED_MODULES.has(moduleId);
}

/** True when `moduleId` (a catalog module) is available under `entitlements`. */
export function isModuleLicensed(moduleId: string, entitlements: Entitlements): boolean {
  if (ALWAYS_LICENSED_MODULES.has(moduleId)) return true;
  const entitlementModule = CATALOG_TO_ENTITLEMENT_MODULE[moduleId] ?? moduleId;
  return hasModule(entitlements, entitlementModule);
}

/** The entitlement module id a catalog module is licensed under. */
export function entitlementModuleOf(moduleId: string): string {
  return CATALOG_TO_ENTITLEMENT_MODULE[moduleId] ?? moduleId;
}

/** True when `moduleId` (a catalog module) left the tenant's entitlements but its data stays readable. */
export function isModuleReadOnly(moduleId: string, entitlements: Entitlements): boolean {
  if (ALWAYS_LICENSED_MODULES.has(moduleId)) return false;
  return hasReadOnlyModule(entitlements, entitlementModuleOf(moduleId));
}

/** Catalog modules visible under `entitlements`, in catalog order. */
export function licensedModules(entitlements: Entitlements): readonly ModuleDef[] {
  return MODULES.filter((m) => isModuleLicensed(m.id, entitlements) || hasAnyPartOf(entitlements, entitlementModuleOf(m.id)));
}

/** The id a permission is licensed under: its sub-module, else its module's entitlement id. */
export function licensingIdOf(permission: PermissionDef): string {
  return permission.subModule ?? entitlementModuleOf(permission.module);
}

function permissionLicensed(p: PermissionDef, entitlements: Entitlements): boolean {
  return p.subModule === null ? isModuleLicensed(p.module, entitlements) : hasModule(entitlements, p.subModule);
}

/** True when `code`'s module — or its sub-module — is licensed. An unknown code is not licensed. */
export function isPermissionLicensed(code: string, entitlements: Entitlements): boolean {
  const p = getPermission(code);
  return p !== undefined && permissionLicensed(p, entitlements);
}

/** True when `code`'s module or sub-module left the plan but its data stays readable. */
export function isPermissionReadOnly(code: string, entitlements: Entitlements): boolean {
  const p = getPermission(code);
  if (!p) return false;
  return p.subModule === null ? isModuleReadOnly(p.module, entitlements) : hasReadOnlyModule(entitlements, p.subModule);
}

/** Catalog permissions grantable under `entitlements`, in catalog order. */
export function licensedPermissions(entitlements: Entitlements): readonly PermissionDef[] {
  return PERMISSIONS.filter((p) => permissionLicensed(p, entitlements));
}
