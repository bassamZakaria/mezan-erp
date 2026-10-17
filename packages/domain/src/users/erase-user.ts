import { EmployeeRefStatus } from "../hr-shared/employee-ref.js";
import type { Employee, EmployeeStatus } from "../hr/employee.js";
import type { User, UserStatus } from "./user.js";

/**
 * The account row is anonymised in place, never deleted: posted journal
 * entries, audit rows and every document's `createdBy` name its id and are
 * immutable, and the screens that show a creator resolve the id against the
 * user list. Delete the row and those screens fall back to rendering the raw
 * id; keep it and they render the placeholder below.
 */
export const ERASED_USER_NAME_AR = "مستخدم محذوف";
export const ERASED_USER_NAME_EN = "Deleted user";
export const ERASED_EMPLOYEE_FIRST_NAME_AR = "موظف";
export const ERASED_EMPLOYEE_LAST_NAME_AR = "محذوف";
export const ERASED_EMPLOYEE_FIRST_NAME_EN = "Deleted";
export const ERASED_EMPLOYEE_LAST_NAME_EN = "user";

const ERASED_USER_STATUS: UserStatus = "inactive";
const TERMINATED_EMPLOYEE_STATUS: EmployeeStatus = EmployeeRefStatus.Terminated;

/** `.invalid` is reserved by RFC 2606: the address can never route, and it stays unique per account so the email index still holds. */
export function erasedUserEmail(userId: string): string {
  return `erased-${userId.toLowerCase()}@erased.invalid`;
}

export enum UserErasureRefusal {
  Self = "self",
  LastCompanyAdmin = "last_company_admin",
  EmployeeStillEmployed = "employee_still_employed",
}

const REFUSAL_TEXT: Record<UserErasureRefusal, { readonly ar: string; readonly en: string }> = {
  [UserErasureRefusal.Self]: {
    ar: "لا يمكنك محو بياناتك الشخصية بنفسك؛ يطلبها مدير آخر نيابةً عنك.",
    en: "You cannot erase your own personal data; another administrator performs it on your behalf.",
  },
  [UserErasureRefusal.LastCompanyAdmin]: {
    ar: "لا يمكن محو بيانات آخر مدير شركة نشط. عيّن مديرًا آخر أولاً.",
    en: "The last active company administrator cannot be erased. Appoint another administrator first.",
  },
  [UserErasureRefusal.EmployeeStillEmployed]: {
    ar: "المستخدم مرتبط بموظف لم تُنهَ خدمته بعد؛ أنهِ الخدمة أولاً ثم امحُ البيانات.",
    en: "The user is linked to an employee whose service has not ended; end the employment first, then erase.",
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

export interface UserErasureContext {
  readonly actorId: string;
  readonly users: readonly User[];
  readonly employee: Employee | null;
}

/**
 * The last active company admin is measured against the OTHER active,
 * unerased admins — erasing it would leave the tenant with no one who can
 * grant permissions, and no recovery path inside the product.
 */
export function assertUserErasable(user: User, context: UserErasureContext): void {
  if (user.id === context.actorId) throw new UserErasureRefusedError(user.id, UserErasureRefusal.Self);
  if (user.isCompanyAdmin && user.status === "active") {
    const others = context.users.filter(
      (u) => u.id !== user.id && u.isCompanyAdmin && u.status === "active" && !isErasedUser(u),
    );
    if (others.length === 0) throw new UserErasureRefusedError(user.id, UserErasureRefusal.LastCompanyAdmin);
  }
  if (context.employee && context.employee.status !== TERMINATED_EMPLOYEE_STATUS) {
    throw new UserErasureRefusedError(user.id, UserErasureRefusal.EmployeeStillEmployed);
  }
}

/**
 * The id, role, scopes and dates stay: they are not personal data, and the
 * immutable records that name the id need them to keep resolving. The account
 * can never sign in again — no PIN, a password hash of a secret nobody holds,
 * and an inactive status.
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
    status: ERASED_USER_STATUS,
    lastLoginAt: null,
    erasedAt,
  };
}

/**
 * What payroll, end-of-service and the posted journals still reason about —
 * code, branch, dates, category, status — stays; who the person was does not.
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
    bankAccount: null,
  };
}

/** Mirrors `stampNote` in hr-self-routes.ts: ` @ 30.04440,31.23570 ±12m`. */
const PUNCH_LOCATION = / @ -?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?: ±\d+m)?/g;

/** A self clock-in stamps the device's coordinates into the attendance note; the hours stay, the location goes. */
export function scrubAttendanceNote(note: string | null): string | null {
  if (note === null) return null;
  const scrubbed = note.replace(PUNCH_LOCATION, "");
  return scrubbed === note ? note : scrubbed;
}

export function attendanceNoteCarriesLocation(note: string | null): boolean {
  return note !== null && scrubAttendanceNote(note) !== note;
}
