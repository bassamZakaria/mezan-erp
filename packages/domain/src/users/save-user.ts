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

export class EmailDomainNotAllowedError extends Error {
  readonly code = "EMAIL_DOMAIN_NOT_ALLOWED";
  constructor(
    readonly email: string,
    readonly allowedDomains: readonly string[],
  ) {
    super(
      `نطاق البريد الإلكتروني غير مسموح. النطاقات المسموحة: ${allowedDomains.join("، ")}`,
    );
    this.name = "EmailDomainNotAllowedError";
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

export class LastCompanyAdminError extends Error {
  readonly code = "LAST_COMPANY_ADMIN";
  constructor(readonly userId: string) {
    super("لا يمكن تعطيل أو تنزيل آخر مدير شركة نشط. عيّن مديرًا آخر أولاً.");
    this.name = "LastCompanyAdminError";
  }
}

const PIN_PATTERN = /^\d{4,6}$/;

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
  /**
   * Plaintext six-digit PIN. `undefined` leaves it unchanged (update), `null`
   * clears it, a string (re)sets it.
   */
  readonly pin?: string | null;
  /** Profile photo as a data URL. `undefined` keeps whatever is stored. */
  readonly photoUrl?: string | null;
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
    throw new InvalidUserError("الاسم الكامل مطلوب.");
  }
  const email = normalizeEmail(cmd.email);
  if (email === "") {
    throw new InvalidUserError("البريد الإلكتروني مطلوب.");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new InvalidUserError("البريد الإلكتروني غير صالح.");
  }
  const domainRefusal = emailDomainRefusal(email, opts?.allowedEmailDomains);
  if (domainRefusal) throw domainRefusal;
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

  const existingByEmail = await uow.users.findByEmail(email);
  if (existingByEmail && existingByEmail.id !== cmd.id) {
    throw new DuplicateUserEmailError(email);
  }

  const prior = await uow.users.findById(cmd.id);

  const staysAdmin = cmd.isCompanyAdmin && cmd.status === "active";
  if (prior && !staysAdmin && (await isLastActiveCompanyAdmin(prior, uow))) {
    throw new LastCompanyAdminError(prior.id);
  }

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
    nameAr: cmd.nameAr,
    nameEn: cmd.nameEn,
    email,
    phone: cmd.phone,
    passwordHash,
    pinHash,
    roleId: cmd.roleId,
    isCompanyAdmin: cmd.isCompanyAdmin,
    employeeId: cmd.employeeId,
    branchScope: cmd.branchScope,
    warehouseScope: cmd.warehouseScope,
    status: cmd.status,
    photoUrl: cmd.photoUrl === undefined ? (prior?.photoUrl ?? null) : cmd.photoUrl,
    lastLoginAt: prior?.lastLoginAt ?? null,
    createdAt: prior?.createdAt ?? cmd.createdAt,
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
