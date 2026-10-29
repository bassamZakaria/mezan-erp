/** Permissions engine — catalog manifest, dependency resolution, AuthContext. */

export {
  CATALOG_VERSION,
  MODULES,
  PERMISSIONS,
  ALL_PERMISSION_CODES,
  WILDCARD_PERMISSION,
  CostPermission,
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
  SodSideMatch,
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

export {
  ShellRequest,
  ShellRequestModule,
  SHELL_REQUESTS,
  holdsShellRequest,
  planServesShellRequest,
  type PlanModules,
  type ShellRequestGate,
  ScreenRequest,
  SCREEN_REQUESTS,
  mayAskScreenRequest,
  type ScreenRequestGate,
  ShellModuleRequest,
  SHELL_MODULE_REQUESTS,
  mayAskShellModuleRequest,
  type ShellModuleRequestGate,
} from "./shell-requests.js";
export { DashboardRequest, DASHBOARD_REQUESTS, mayActWith, mayAskDashboard, mayReadWith, type DashboardRequestGate, type PermissionHeld } from "./dashboard-requests.js";
