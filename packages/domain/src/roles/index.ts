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
export { correctedSeededRolePermissions,
  seededRoleDutyChange,
  seededRoleDutyNotice,
  SEEDED_ROLE_DUTIES_SEPARATED_EVENT,
  type SeededRoleDutyChange, DASHBOARD_VIEW_PERMISSION, GOODS_RECEIVING_PERMISSIONS, SEEDED_ROLE_CODES, SeededRoleCode, SeededRoleSplit } from "./seeded-role-corrections.js";

export {
  ROLE_TEMPLATES,
  RoleTemplateId,
  findRoleTemplate,
  licensedTemplatePermissions,
  roleTemplateProblems,
  type LicensedTemplatePermissions,
  type RoleTemplate,
  type RoleTemplateProblems,
} from "./templates.js";
