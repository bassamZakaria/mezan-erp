import { ALL_SCOPE, type ScopeSelection } from "../permissions/auth-context.js";
import type { UnitOfWork } from "../journal.js";
import type { SecretHasher, User, UserStatus } from "./user.js";
import { accessExpiryProblem } from "./access-expiry.js";

export class InvalidUserError extends Error {
  readonly code = "INVALID_USER";
  readonly messageEn: string;
  constructor(message: string, messageEn: string) {
    super(message);
    this.messageEn = messageEn;
    this.name = "InvalidUserError";
  }
}

export class DuplicateUserEmailError extends Error {
  readonly code = "DUPLICATE_USER_EMAIL";
  readonly messageEn: string;
  constructor(readonly email: string) {
    super(`يوجد مستخدم بالفعل بالبريد الإلكتروني "${email}"`);
    this.messageEn = `A user with the email "${email}" already exists`;
    this.name = "DuplicateUserEmailError";
  }
}

export class EmailDomainNotAllowedError extends Error {
  readonly code = "EMAIL_DOMAIN_NOT_ALLOWED";
  readonly messageEn: string;
  constructor(
    readonly email: string,
    readonly allowedDomains: readonly string[],
  ) {
    super(
      `نطاق البريد الإلكتروني غير مسموح. النطاقات المسموحة: ${allowedDomains.join("، ")}`,
    );
    this.messageEn = `The email domain is not allowed. Allowed domains: ${allowedDomains.join(", ")}`;
    this.name = "EmailDomainNotAllowedError";
  }
}

export class UnknownRoleError extends Error {
  readonly code = "UNKNOWN_ROLE";
  readonly messageEn: string;
  constructor(readonly roleId: string) {
    super(`الدور "${roleId}" غير موجود`);
    this.messageEn = `Role "${roleId}" was not found`;
    this.name = "UnknownRoleError";
  }
}

export class UserNotFoundError extends Error {
  readonly code = "USER_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly userId: string) {
    super(`المستخدم "${userId}" غير موجود`);
    this.messageEn = `User "${userId}" was not found`;
    this.name = "UserNotFoundError";
  }
}

export class LastCompanyAdminError extends Error {
  readonly code = "LAST_COMPANY_ADMIN";
  readonly messageEn: string;
  constructor(readonly userId: string) {
    super("لا يمكن تعطيل أو تنزيل آخر مدير شركة نشط. عيّن مديرًا آخر أولاً.");
    this.messageEn = "The last active company administrator cannot be disabled or demoted. Assign another administrator first.";
    this.name = "LastCompanyAdminError";
  }
}

/**
 * Deliberately not RFC 5322. It rejects what an operator actually mistypes —
 * a bare name, a missing @, a domain with no dot, an embedded space — and
 * accepts everything a real company address looks like. A stricter pattern
 * refuses valid addresses; a looser one lets «محمد الشهابي» back in as a login.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isPlausibleEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

/** Trimmed and lower-cased — emails are compared, stored and matched in this form only. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** The part after the "@", already normalised. Empty when there is no "@". */
export function emailDomain(email: string): string {
  const at = normalizeEmail(email).lastIndexOf("@");
  return at === -1 ? "" : normalizeEmail(email).slice(at + 1);
}

/** Trimmed, lower-cased, and with a leading "@" or "." stripped — how domains are stored. */
export function normalizeEmailDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^[@.]+/, "");
}

export interface SaveUserCommand {
  readonly id: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly email: string;
  readonly phone: string | null;
  /**
   * Plaintext temporary password. Required on create; on update, omit to
   * keep the existing hash unchanged.
   */
  readonly password?: string;
  /** Whether `password` is a temporary one the user must replace at first sign-in. Defaults to true whenever a password is given. */
  readonly passwordIsTemporary?: boolean;
  /** Profile photo as a data URL. `undefined` keeps whatever is stored. */
  readonly photoUrl?: string | null;
  readonly roleId: string | null;
  readonly isCompanyAdmin: boolean;
  readonly employeeId: string | null;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
  readonly status: UserStatus;
  readonly createdAt: string;
  /** ISO instant the account stops working. `undefined` keeps what is stored, `null` clears it. */
  readonly accessExpiresAt?: string | null;
}

function isScopeEmpty(scope: ScopeSelection): boolean {
  return scope !== ALL_SCOPE && scope.length === 0;
}

/**
 * Creates or updates a user account. Enforces the two-dimensional scoping
 * model: exactly one of `roleId` / `isCompanyAdmin` (WHAT), and at least one
 * branch (WHERE — `docs/archive/catalog/09`: "at least one required"). Secrets are
 * hashed through the injected `SecretHasher` port, never touched in the clear
 * beyond this function's stack frame.
 */
/**
 * The allowed-domain policy as a pure check, so a route can apply it in the
 * ORDER it needs rather than only wherever `saveUser` happens to reach it.
 *
 * An empty allowlist is no policy at all, not a policy that forbids everyone:
 * a company must not be locked out of creating its first users by a rule
 * nobody has configured yet.
 */
export function emailDomainRefusal(
  rawEmail: string,
  allowedEmailDomains: readonly string[] | undefined,
): EmailDomainNotAllowedError | null {
  const email = normalizeEmail(rawEmail);
  const allowed = (allowedEmailDomains ?? []).map(normalizeEmailDomain).filter((d) => d !== "");
  if (allowed.length === 0 || allowed.includes(emailDomain(email))) return null;
  return new EmailDomainNotAllowedError(email, allowed);
}

export interface SaveUserOptions {
  /**
   * Domains the email may belong to. Empty (or omitted) means no restriction —
   * the caller reads this off tenant settings, so the domain stays free of a
   * settings dependency it would otherwise need only for this one rule.
   */
  readonly allowedEmailDomains?: readonly string[];
  readonly now?: () => number;
}

/**
 * True when `user` is the ONLY active company admin the tenant has left.
 *
 * Deactivating or demoting that account locks the shop out of its own books
 * with no way back through the product — there is no support console to undo
 * it and no other account that can grant the flag again. An INACTIVE admin does
 * not count: it cannot sign in, so it is not a way back either (D117).
 */
async function isLastActiveCompanyAdmin(user: User, uow: UnitOfWork): Promise<boolean> {
  if (!user.isCompanyAdmin || user.status !== "active") return false;
  const others = (await uow.users.list()).filter(
    (u) => u.id !== user.id && u.isCompanyAdmin && u.status === "active",
  );
  return others.length === 0;
}

export async function saveUser(
  cmd: SaveUserCommand,
  uow: UnitOfWork,
  hasher: SecretHasher,
  opts?: SaveUserOptions,
): Promise<User> {
  if (cmd.nameAr.trim() === "") {
    throw new InvalidUserError("الاسم الكامل مطلوب.", "Full name is required.");
  }
  const email = normalizeEmail(cmd.email);
  if (email === "") {
    throw new InvalidUserError("البريد الإلكتروني مطلوب.", "Email is required.");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new InvalidUserError("البريد الإلكتروني غير صالح.", "Email is not valid.");
  }
  const domainRefusal = emailDomainRefusal(email, opts?.allowedEmailDomains);
  if (domainRefusal) throw domainRefusal;
  if (cmd.isCompanyAdmin === (cmd.roleId !== null)) {
    throw new InvalidUserError(
      "يجب أن يكون للمستخدم دور واحد فقط أو صلاحية مدير الشركة، وليس كليهما.",
      "A user must have exactly one role or company-administrator access, not both.",
    );
  }
  if (isScopeEmpty(cmd.branchScope)) {
    throw new InvalidUserError("يجب اختيار فرع واحد على الأقل.", "Select at least one branch.");
  }

  const role = cmd.roleId ? await uow.roles.findById(cmd.roleId) : null;
  if (cmd.roleId && !role) throw new UnknownRoleError(cmd.roleId);

  const existingByEmail = await uow.users.findByEmail(email);
  if (existingByEmail && existingByEmail.id !== cmd.id) {
    throw new DuplicateUserEmailError(email);
  }

  const prior = await uow.users.findById(cmd.id);

  const accessExpiresAt = cmd.accessExpiresAt === undefined ? (prior?.accessExpiresAt ?? null) : cmd.accessExpiresAt;
  const expiryRefusal = accessExpiryProblem(
    { accessExpiresAt, isCompanyAdmin: cmd.isCompanyAdmin, roleCode: role?.code ?? null },
    (opts?.now ?? Date.now)(),
  );
  if (expiryRefusal && (cmd.accessExpiresAt !== undefined || !prior || prior.roleId !== cmd.roleId || prior.isCompanyAdmin !== cmd.isCompanyAdmin)) {
    throw expiryRefusal;
  }

  const staysAdmin = cmd.isCompanyAdmin && cmd.status === "active";
  if (prior && !staysAdmin && (await isLastActiveCompanyAdmin(prior, uow))) {
    throw new LastCompanyAdminError(prior.id);
  }

  const passwordHash = cmd.password
    ? await hasher.hash(cmd.password)
    : prior?.passwordHash;
  if (!passwordHash) {
    throw new InvalidUserError("كلمة المرور مطلوبة لإنشاء المستخدم.", "A password is required to create the user.");
  }

  const mustChangePassword = cmd.password ? (cmd.passwordIsTemporary ?? true) : (prior?.mustChangePassword ?? false);

  const user: User = {
    id: cmd.id,
    nameAr: cmd.nameAr,
    nameEn: cmd.nameEn,
    email,
    phone: cmd.phone,
    passwordHash,
    mustChangePassword,
    roleId: cmd.roleId,
    isCompanyAdmin: cmd.isCompanyAdmin,
    employeeId: cmd.employeeId,
    branchScope: cmd.branchScope,
    warehouseScope: cmd.warehouseScope,
    status: cmd.status,
    photoUrl: cmd.photoUrl === undefined ? (prior?.photoUrl ?? null) : cmd.photoUrl,
    lastLoginAt: prior?.lastLoginAt ?? null,
    createdAt: prior?.createdAt ?? cmd.createdAt,
    accessExpiresAt,
  };

  await uow.users.save(user);
  return user;
}

/**
 * Stamps the moment an account last signed in successfully.
 *
 * `lastLoginAt` was declared on the entity, stored in the schema, serialized by
 * the users route and RENDERED in the users list — and assigned by nothing, so
 * the column read «أبداً» for every account forever. That is worse than a blank
 * column: a dormant account and a fake one both look exactly like a real one
 * that has never signed in, so "an account that has posted documents but never
 * logged in" was not a question anyone could ask.
 *
 * Deliberately a targeted write rather than a `saveUser` round trip: nothing
 * about a login is allowed to revalidate, rehash or renumber the account.
 */
export async function recordSuccessfulLogin(
  userId: string,
  at: string,
  uow: UnitOfWork,
): Promise<void> {
  const user = await uow.users.findById(userId);
  if (!user) return;
  await uow.users.save({ ...user, lastLoginAt: at });
}

/** Sets a user's active/inactive status (the "deactivate" / reactivate action). */
export async function setUserStatus(
  userId: string,
  status: UserStatus,
  uow: UnitOfWork,
): Promise<User> {
  const user = await uow.users.findById(userId);
  if (!user) throw new UserNotFoundError(userId);
  if (status !== "active" && (await isLastActiveCompanyAdmin(user, uow))) {
    throw new LastCompanyAdminError(userId);
  }
  const next: User = { ...user, status };
  await uow.users.save(next);
  return next;
}
