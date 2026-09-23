import type { Employee } from "../hr/employee.js";
import type { User } from "./user.js";

/**
 * Erasure of a person's personal data (D348) — the step beyond deactivation.
 *
 * The account row is kept, anonymised, rather than deleted: posted journal
 * entries, audit rows and approval decisions name its id, and they are
 * immutable. Every one of them then renders the placeholder below instead of
 * a name, and nothing in the ledger changes.
 */
export const ERASED_USER_NAME_AR = "مستخدم محذوف";
export const ERASED_USER_NAME_EN = "Deleted user";
export const ERASED_EMPLOYEE_FIRST_NAME_AR = "موظف";
export const ERASED_EMPLOYEE_LAST_NAME_AR = "محذوف";
export const ERASED_EMPLOYEE_FIRST_NAME_EN = "Deleted";
export const ERASED_EMPLOYEE_LAST_NAME_EN = "employee";

/** `.invalid` is reserved (RFC 2606): the address can never route, and stays unique per account. */
export function erasedUserEmail(userId: string): string {
  return `erased-${userId.toLowerCase()}@erased.invalid`;
}

export enum UserErasureRefusal {
  Self = "self",
  LastCompanyAdmin = "last_company_admin",
  AlreadyErased = "already_erased",
  EmployeeStillEmployed = "employee_still_employed",
}

const REFUSAL_TEXT: Record<UserErasureRefusal, { readonly ar: string; readonly en: string }> = {
  [UserErasureRefusal.Self]: {
    ar: "لا يمكنك محو بياناتك الشخصية بنفسك؛ يطلبها مدير آخر نيابةً عنك.",
    en: "You cannot erase your own personal data; another administrator performs it on your behalf.",
  },
  [UserErasureRefusal.LastCompanyAdmin]: {
    ar: "لا يمكن محو آخر مدير شركة نشط. عيّن مديرًا آخر أولاً.",
    en: "The last active company administrator cannot be erased. Appoint another administrator first.",
  },
  [UserErasureRefusal.AlreadyErased]: {
    ar: "بيانات هذا المستخدم الشخصية محيت بالفعل.",
    en: "This user's personal data has already been erased.",
  },
  [UserErasureRefusal.EmployeeStillEmployed]: {
    ar: "المستخدم مرتبط بموظف لم تُنهَ خدمته بعد؛ أنهِ الخدمة أولاً ثم امحُ البيانات.",
    en: "The user is linked to an employee who has not been terminated; terminate the employment first, then erase.",
  },
};

export class UserErasureRefusedError extends Error {
  readonly code = "USER_ERASURE_REFUSED";
  readonly messageEn: string;
  constructor(readonly userId: string, readonly reason: UserErasureRefusal) {
    super(REFUSAL_TEXT[reason].ar);
    this.name = "UserErasureRefusedError";
    this.messageEn = REFUSAL_TEXT[reason].en;
  }
}

export function isErasedUser(user: Pick<User, "erasedAt">): boolean {
  return Boolean(user.erasedAt);
}

/**
 * Refuses an erasure the tenant cannot absorb. The last active company admin
 * is checked against the ACTIVE admins other than this one, the same rule
 * deactivation follows; a linked employee still on the books would lose the
 * identity their payroll and leave depend on mid-employment.
 */
export function assertUserErasable(
  user: User,
  context: { readonly actorId: string; readonly users: readonly User[]; readonly employee: Employee | null },
): void {
  if (isErasedUser(user)) throw new UserErasureRefusedError(user.id, UserErasureRefusal.AlreadyErased);
  if (user.id === context.actorId) throw new UserErasureRefusedError(user.id, UserErasureRefusal.Self);
  if (user.isCompanyAdmin && user.status === "active") {
    const others = context.users.filter((u) => u.id !== user.id && u.isCompanyAdmin && u.status === "active" && !isErasedUser(u));
    if (others.length === 0) throw new UserErasureRefusedError(user.id, UserErasureRefusal.LastCompanyAdmin);
  }
  if (context.employee && context.employee.status !== "terminated") {
    throw new UserErasureRefusedError(user.id, UserErasureRefusal.EmployeeStillEmployed);
  }
}

/**
 * The anonymised account. Its id, role, scopes and dates stay — they are not
 * personal data and the records that name the id need them to stay coherent —
 * and it can never sign in again: no PIN, a password hash of a secret nobody
 * holds, and an inactive status.
 */
export function erasedUser(user: User, erasedAt: string, unusablePasswordHash: string): User {
  return {
    ...user,
    nameAr: ERASED_USER_NAME_AR,
    nameEn: ERASED_USER_NAME_EN,
    email: erasedUserEmail(user.id),
    phone: null,
    photoUrl: null,
    passwordHash: unusablePasswordHash,
    pinHash: null,
    status: "inactive",
    lastLoginAt: null,
    erasedAt,
  };
}

/**
 * The anonymised employee. What payroll, end-of-service and the posted
 * journals still reason about — code, branch, dates, category, status — stays;
 * who the person was does not.
 */
export function erasedEmployee(employee: Employee): Employee {
  return {
    ...employee,
    firstName: ERASED_EMPLOYEE_FIRST_NAME_EN,
    lastName: ERASED_EMPLOYEE_LAST_NAME_EN,
    firstNameAr: ERASED_EMPLOYEE_FIRST_NAME_AR,
    lastNameAr: ERASED_EMPLOYEE_LAST_NAME_AR,
    email: null,
    phone: null,
    birthDate: null,
    nationalId: null,
    gender: null,
    maritalStatus: null,
    deviceBadgeId: null,
    address: null,
    emergencyContact: null,
  };
}

const PUNCH_LOCATION = / @ -?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?: ±\d+m)?/g;

/** A self clock-in stamps the device's coordinates into the attendance note; the hours stay, the location goes. */
export function scrubAttendanceNote(note: string | null): string | null {
  return note === null ? null : note.replace(PUNCH_LOCATION, "");
}
