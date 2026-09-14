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
  visibilityTier,
  type AuthContext,
  type AuthContextInput,
  type ScopeSelection,
  type ScopeQuery,
} from "./auth-context.js";

export {
  isModuleLicensed,
  isAlwaysLicensed,
  licensedModules,
  licensedPermissions,
} from "./module-licensing.js";

export { togglePermission, toggleAll } from "./role-editor.js";
