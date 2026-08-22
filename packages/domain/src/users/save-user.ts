import { ALL_SCOPE, type ScopeSelection } from "../permissions/auth-context.js";
import type { UnitOfWork } from "../journal.js";
import type { SecretHasher, User, UserStatus } from "./user.js";

export class InvalidUserError extends Error {
  readonly code = "INVALID_USER";
  constructor(message: string) {
    super(message);
    this.name = "InvalidUserError";
  }
}

export class DuplicateUserEmailError extends Error {
  readonly code = "DUPLICATE_USER_EMAIL";
  constructor(readonly email: string) {
    super(`يوجد مستخدم بالفعل بالبريد الإلكتروني "${email}"`);
    this.name = "DuplicateUserEmailError";
  }
}

export class UnknownRoleError extends Error {
  readonly code = "UNKNOWN_ROLE";
  constructor(readonly roleId: string) {
    super(`الدور "${roleId}" غير موجود`);
    this.name = "UnknownRoleError";
  }
}

export class UserNotFoundError extends Error {
  readonly code = "USER_NOT_FOUND";
  constructor(readonly userId: string) {
    super(`المستخدم "${userId}" غير موجود`);
    this.name = "UserNotFoundError";
  }
}

const PIN_PATTERN = /^\d{4,6}$/;

export interface SaveUserCommand {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  /**
   * Plaintext temporary password. Required on create; on update, omit to
   * keep the existing hash unchanged.
   */
  readonly password?: string;
  /**
   * Plaintext 4-6 digit PIN. `undefined` leaves it unchanged (update), `null`
   * clears it, a string (re)sets it.
   */
  readonly pin?: string | null;
  readonly roleId: string | null;
  readonly isCompanyAdmin: boolean;
  readonly employeeId: string | null;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
  readonly status: UserStatus;
  readonly createdAt: string;
}

function isScopeEmpty(scope: ScopeSelection): boolean {
  return scope !== ALL_SCOPE && scope.length === 0;
}

/**
 * Creates or updates a user account. Enforces the two-dimensional scoping
 * model: exactly one of `roleId` / `isCompanyAdmin` (WHAT), and at least one
 * branch (WHERE — `docs/catalog/09`: "at least one required"). Secrets are
 * hashed through the injected `SecretHasher` port, never touched in the clear
 * beyond this function's stack frame.
 */
export async function saveUser(
  cmd: SaveUserCommand,
  uow: UnitOfWork,
  hasher: SecretHasher,
): Promise<User> {
  if (cmd.fullName.trim() === "") {
    throw new InvalidUserError("الاسم الكامل مطلوب.");
  }
  if (cmd.email.trim() === "") {
    throw new InvalidUserError("البريد الإلكتروني مطلوب.");
  }
  if (cmd.isCompanyAdmin === (cmd.roleId !== null)) {
    throw new InvalidUserError(
      "يجب أن يكون للمستخدم دور واحد فقط أو صلاحية مدير الشركة، وليس كليهما.",
    );
  }
  if (isScopeEmpty(cmd.branchScope)) {
    throw new InvalidUserError("يجب اختيار فرع واحد على الأقل.");
  }
  if (cmd.pin !== undefined && cmd.pin !== null && !PIN_PATTERN.test(cmd.pin)) {
    throw new InvalidUserError("يجب أن يتكون الرقم السري من 4 إلى 6 أرقام.");
  }

  if (cmd.roleId) {
    const role = await uow.roles.findById(cmd.roleId);
    if (!role) throw new UnknownRoleError(cmd.roleId);
  }

  const existingByEmail = await uow.users.findByEmail(cmd.email);
  if (existingByEmail && existingByEmail.id !== cmd.id) {
    throw new DuplicateUserEmailError(cmd.email);
  }

  const prior = await uow.users.findById(cmd.id);

  const passwordHash = cmd.password
    ? await hasher.hash(cmd.password)
    : prior?.passwordHash;
  if (!passwordHash) {
    throw new InvalidUserError("كلمة المرور مطلوبة لإنشاء المستخدم.");
  }

  const pinHash =
    cmd.pin === undefined
      ? (prior?.pinHash ?? null)
      : cmd.pin === null
        ? null
        : await hasher.hash(cmd.pin);

  const user: User = {
    id: cmd.id,
    fullName: cmd.fullName,
    email: cmd.email,
    phone: cmd.phone,
    passwordHash,
    pinHash,
    roleId: cmd.roleId,
    isCompanyAdmin: cmd.isCompanyAdmin,
    employeeId: cmd.employeeId,
    branchScope: cmd.branchScope,
    warehouseScope: cmd.warehouseScope,
    status: cmd.status,
    lastLoginAt: prior?.lastLoginAt ?? null,
    createdAt: prior?.createdAt ?? cmd.createdAt,
  };

  await uow.users.save(user);
  return user;
}

/** Sets a user's active/inactive status (the "deactivate" / reactivate action). */
export async function setUserStatus(
  userId: string,
  status: UserStatus,
  uow: UnitOfWork,
): Promise<User> {
  const user = await uow.users.findById(userId);
  if (!user) throw new UserNotFoundError(userId);
  const next: User = { ...user, status };
  await uow.users.save(next);
  return next;
}
