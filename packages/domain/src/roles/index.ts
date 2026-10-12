export { type Role, type RoleRepository } from "./role.js";
export {
  saveRole,
  deleteRole,
  UnknownPermissionError,
  UnlicensedPermissionError,
  PlatformOnlyPermissionError,
  UngrantablePermissionError,
  DuplicateRoleCodeError,
  SystemRoleImmutableError,
  RoleNotFoundError,
  RoleInUseError,
  type SaveRoleCommand,
} from "./save-role.js";
export { correctedSeededRolePermissions, DASHBOARD_VIEW_PERMISSION, SEEDED_ROLE_CODES, SeededRoleCode } from "./seeded-role-corrections.js";
