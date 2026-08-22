export { type Role, type RoleRepository } from "./role.js";
export {
  saveRole,
  deleteRole,
  UnknownPermissionError,
  UnlicensedPermissionError,
  DuplicateRoleCodeError,
  SystemRoleImmutableError,
  RoleNotFoundError,
  RoleInUseError,
  type SaveRoleCommand,
} from "./save-role.js";
