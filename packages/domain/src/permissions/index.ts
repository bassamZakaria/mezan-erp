/** Permissions engine — catalog manifest, dependency resolution, AuthContext. */

export {
  CATALOG_VERSION,
  MODULES,
  PERMISSIONS,
  ALL_PERMISSION_CODES,
  WILDCARD_PERMISSION,
  getPermission,
  isKnownPermission,
  isSensitive,
  isPlatformAdminOnly,
  assertCatalogIntegrity,
  type PermissionDef,
  type ModuleDef,
  type VisibilityTier,
} from "./catalog.js";

export type { PermissionFragment, PermissionModuleFragment, PermissionRow } from "./fragment.js";

export { resolvePermissions, dependenciesOf } from "./resolve.js";

export {
  ungrantablePermissions,
  ungrantableScopes,
  targetOutranksCaller,
  type AccountAuthority,
} from "./escalation.js";

export {
  ALL_SCOPE,
  createAuthContext,
  can,
  isTenantAdmin,
  isScopeRestricted,
  visibilityTier,
  type AuthContext,
  type AuthContextInput,
  type ScopeSelection,
  type ScopeQuery,
} from "./auth-context.js";

export {
  isModuleLicensed,
  isAlwaysLicensed,
  isModuleReadOnly,
  entitlementModuleOf,
  licensedModules,
  licensedPermissions,
} from "./module-licensing.js";

export { togglePermission, toggleAll } from "./role-editor.js";

export {
  SodConflictId,
  SOD_CONFLICT_RULES,
  detectSodConflicts,
  getSodConflictRule,
  type SodConflictRule,
  type SodConflictMatch,
} from "./sod.js";

export {
  PermissionLabelLocale,
  PERMISSION_ACTION_LABELS,
  PERMISSION_ENTITY_LABELS,
  permissionLabelTranslations,
  permissionEntitySegment,
  permissionHumanLabel,
  type PermissionLabel,
  type PermissionLabelTranslations,
} from "./labels.js";
