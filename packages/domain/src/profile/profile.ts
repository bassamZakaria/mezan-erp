import { CurrentSecretRefusal } from "@mezan/contracts";
import type { UnitOfWork } from "../journal.js";
import { InvalidUserError, DuplicateUserEmailError, UserNotFoundError } from "../users/save-user.js";
import type { SecretHasher, User } from "../users/user.js";

/**
 * Self-service profile actions (docs/archive/catalog/09 profile screen). Unlike
 * `saveUser` (admin-gated, any user, full field set), every function here is
 * scoped to the CALLING user's own id — no permission check, no ability to
 * touch role/scope/status. The caller (API route) resolves `userId` from the
 * session, never from client input.
 */

export class IncorrectPasswordError extends Error {
  readonly code = CurrentSecretRefusal.IncorrectPassword;
  readonly messageEn: string;
  constructor() {
    super("كلمة المرور الحالية غير صحيحة.");
    this.messageEn = "The current password is incorrect.";
    this.name = "IncorrectPasswordError";
  }
}

export interface UpdateOwnProfileCommand {
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly email: string;
  readonly phone: string | null;
  /** `undefined` leaves the stored photo alone; `null` removes it. */
  readonly photoUrl?: string | null;
}

/** Updates the caller's own name/email/phone. Email must stay unique across users. */
export async function updateOwnProfile(
  userId: string,
  cmd: UpdateOwnProfileCommand,
  uow: UnitOfWork,
): Promise<User> {
  const user = await uow.users.findById(userId);
  if (!user) throw new UserNotFoundError(userId);
  if (cmd.nameAr.trim() === "") throw new InvalidUserError("الاسم بالعربية مطلوب.", "Arabic name is required.");
  if (cmd.email.trim() === "") throw new InvalidUserError("البريد الإلكتروني مطلوب.", "Email is required.");

  const existingByEmail = await uow.users.findByEmail(cmd.email);
  if (existingByEmail && existingByEmail.id !== userId) {
    throw new DuplicateUserEmailError(cmd.email);
  }

  const next: User = {
    ...user,
    nameAr: cmd.nameAr,
    nameEn: cmd.nameEn === undefined ? user.nameEn : cmd.nameEn,
    email: cmd.email,
    phone: cmd.phone,
    photoUrl: cmd.photoUrl === undefined ? user.photoUrl : cmd.photoUrl,
  };
  await uow.users.save(next);
  return next;
}

export interface ChangeOwnPasswordCommand {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/** Changes the caller's password. Requires the current password to verify identity first. */
export async function changeOwnPassword(
  userId: string,
  cmd: ChangeOwnPasswordCommand,
  uow: UnitOfWork,
  hasher: SecretHasher,
): Promise<void> {
  const user = await uow.users.findById(userId);
  if (!user) throw new UserNotFoundError(userId);
  const valid = await hasher.verify(cmd.currentPassword, user.passwordHash);
  if (!valid) throw new IncorrectPasswordError();
  if (cmd.newPassword.length < 8) {
    throw new InvalidUserError("يجب ألا تقل كلمة المرور الجديدة عن 8 أحرف.", "The new password must be at least 8 characters.");
  }
  if (cmd.newPassword === cmd.currentPassword) {
    throw new InvalidUserError("اختر كلمة مرور جديدة تختلف عن الحالية.", "Choose a new password that is different from the current one.");
  }
  const passwordHash = await hasher.hash(cmd.newPassword);
  await uow.users.save({ ...user, passwordHash, mustChangePassword: false });
}

