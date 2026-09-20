import type { AttendanceEntry } from "./attendance.js";
import type { Employee } from "./employee.js";

export enum SelfClockAction {
  In = "in",
  Out = "out",
}

export enum ClockRefusalCode {
  NotLinked = "USER_NOT_LINKED_TO_EMPLOYEE",
  EmployeeNotActive = "EMPLOYEE_NOT_ACTIVE",
  AlreadyClockedIn = "ALREADY_CLOCKED_IN",
  AlreadyClockedOut = "ALREADY_CLOCKED_OUT",
  NotClockedIn = "NOT_CLOCKED_IN",
  TooSoon = "CLOCK_OUT_TOO_SOON",
  SelfieRequired = "SELFIE_REQUIRED",
  SelfieInvalid = "SELFIE_INVALID",
  BiometricRequired = "BIOMETRIC_REQUIRED",
  BiometricNotRegistered = "BIOMETRIC_NOT_REGISTERED",
  BiometricAlreadyRegistered = "BIOMETRIC_ALREADY_REGISTERED",
  BiometricFailed = "BIOMETRIC_FAILED",
  BiometricChallengeExpired = "BIOMETRIC_CHALLENGE_EXPIRED",
  StorageUnavailable = "CLOCK_STORAGE_UNAVAILABLE",
}

const REFUSAL_MESSAGES: Record<ClockRefusalCode, { readonly ar: string; readonly en: string; readonly status: 403 | 409 | 422 | 503 }> = {
  [ClockRefusalCode.NotLinked]: {
    ar: "حسابك غير مرتبط بملف موظف — اطلب من الموارد البشرية ربطه.",
    en: "Your account is not linked to an employee record — ask HR to link it.",
    status: 409,
  },
  [ClockRefusalCode.EmployeeNotActive]: {
    ar: "لا يمكن تسجيل الحضور لموظف غير نشط.",
    en: "Attendance cannot be recorded for an employee who is not active.",
    status: 409,
  },
  [ClockRefusalCode.AlreadyClockedIn]: {
    ar: "سجّلت حضورك اليوم بالفعل.",
    en: "You have already clocked in today.",
    status: 409,
  },
  [ClockRefusalCode.AlreadyClockedOut]: {
    ar: "سجّلت حضورك وانصرافك اليوم بالفعل.",
    en: "You have already clocked in and out today.",
    status: 409,
  },
  [ClockRefusalCode.NotClockedIn]: {
    ar: "لا يوجد تسجيل حضور مفتوح لتسجيل الانصراف عليه.",
    en: "There is no open clock-in to clock out from.",
    status: 409,
  },
  [ClockRefusalCode.TooSoon]: {
    ar: "لا يمكن تسجيل الانصراف في نفس دقيقة الحضور.",
    en: "You cannot clock out in the same minute you clocked in.",
    status: 409,
  },
  [ClockRefusalCode.SelfieRequired]: {
    ar: "يتطلب ملفك صورة شخصية من الكاميرا عند تسجيل الحضور.",
    en: "Your record requires a camera selfie to clock in or out.",
    status: 422,
  },
  [ClockRefusalCode.SelfieInvalid]: {
    ar: "الصورة المرسلة غير صالحة — يجب أن تكون صورة JPEG أو PNG أو WebP لا تتجاوز 5 ميجابايت.",
    en: "The photo is not valid — it must be a JPEG, PNG or WebP image of at most 5 MB.",
    status: 422,
  },
  [ClockRefusalCode.BiometricRequired]: {
    ar: "يتطلب ملفك التحقق بالبصمة أو الوجه من جهازك عند تسجيل الحضور.",
    en: "Your record requires a fingerprint or face check on your device to clock in or out.",
    status: 422,
  },
  [ClockRefusalCode.BiometricNotRegistered]: {
    ar: "لم تُسجَّل بصمة جهاز لك بعد — سجّل جهازك أولاً.",
    en: "No device biometric is registered for you yet — register your device first.",
    status: 409,
  },
  [ClockRefusalCode.BiometricAlreadyRegistered]: {
    ar: "لديك جهاز مسجّل بالفعل — اطلب من الموارد البشرية إعادة تعيينه لتسجيل جهاز جديد.",
    en: "You already have a registered device — ask HR to reset it before registering a new one.",
    status: 409,
  },
  [ClockRefusalCode.BiometricFailed]: {
    ar: "تعذّر التحقق من البصمة — حاول مرة أخرى.",
    en: "The biometric check could not be verified — try again.",
    status: 403,
  },
  [ClockRefusalCode.BiometricChallengeExpired]: {
    ar: "انتهت صلاحية طلب التحقق — حاول مرة أخرى.",
    en: "The verification request expired — try again.",
    status: 409,
  },
  [ClockRefusalCode.StorageUnavailable]: {
    ar: "تخزين صور وبصمات الحضور غير مُهيأ على هذا الخادم.",
    en: "Attendance photo and biometric storage is not configured on this server.",
    status: 503,
  },
};

export class ClockPunchRefusedError extends Error {
  readonly messageEn: string;
  readonly status: 403 | 409 | 422 | 503;
  constructor(readonly code: ClockRefusalCode) {
    const text = REFUSAL_MESSAGES[code];
    super(text.ar);
    this.messageEn = text.en;
    this.status = text.status;
    this.name = "ClockPunchRefusedError";
  }
}

export interface TenantClockReading {
  readonly date: string;
  readonly time: string;
  readonly yesterday: string;
}

export type ClockPunchPlan =
  | { readonly kind: "create"; readonly date: string; readonly checkIn: string }
  | { readonly kind: "check_in_existing"; readonly entry: AttendanceEntry; readonly checkIn: string }
  | { readonly kind: "check_out"; readonly entry: AttendanceEntry; readonly checkOut: string };

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function isOpen(entry: AttendanceEntry | null): boolean {
  return entry !== null && entry.checkIn !== null && entry.checkOut === null;
}

export function assertMayClock(employee: Pick<Employee, "status">): void {
  if (employee.status !== "active") throw new ClockPunchRefusedError(ClockRefusalCode.EmployeeNotActive);
}

/**
 * Decides which attendance row a self-service punch touches. The time is the
 * server's tenant-local clock, never the device's. An out-punch with no open
 * entry today closes yesterday's only while it is still an overnight shift
 * (earlier in the day than yesterday's clock-in); past that point the day is
 * HR's to correct, because `workedMinutesBetween` would read it as a short shift.
 */
export function planClockPunch(
  action: `${SelfClockAction}`,
  now: TenantClockReading,
  today: AttendanceEntry | null,
  yesterday: AttendanceEntry | null,
): ClockPunchPlan {
  if (action === SelfClockAction.In) {
    if (today?.checkIn) {
      throw new ClockPunchRefusedError(today.checkOut ? ClockRefusalCode.AlreadyClockedOut : ClockRefusalCode.AlreadyClockedIn);
    }
    if (today) return { kind: "check_in_existing", entry: today, checkIn: now.time };
    return { kind: "create", date: now.date, checkIn: now.time };
  }

  if (today && isOpen(today)) {
    if (minutesOf(now.time) <= minutesOf(today.checkIn as string)) throw new ClockPunchRefusedError(ClockRefusalCode.TooSoon);
    return { kind: "check_out", entry: today, checkOut: now.time };
  }
  if (today?.checkOut) throw new ClockPunchRefusedError(ClockRefusalCode.AlreadyClockedOut);
  if (yesterday && isOpen(yesterday) && minutesOf(now.time) < minutesOf(yesterday.checkIn as string)) {
    return { kind: "check_out", entry: yesterday, checkOut: now.time };
  }
  throw new ClockPunchRefusedError(ClockRefusalCode.NotClockedIn);
}

export const SELFIE_MIME_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/** True when the bytes start with the signature of the mime type they claim. */
export function selfieBytesMatchMime(bytes: Uint8Array, mimeType: string): boolean {
  const at = (i: number) => bytes[i] ?? -1;
  if (mimeType === "image/jpeg") return at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff;
  if (mimeType === "image/png") return at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47;
  if (mimeType === "image/webp") {
    return at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50;
  }
  return false;
}

/** A device-bound WebAuthn credential an employee clocks in with. One per employee; HR resets it. */
export interface ClockCredential {
  readonly id: string;
  readonly employeeId: string;
  readonly userId: string;
  /** base64url credential id as the authenticator reports it. */
  readonly credentialId: string;
  /** base64url SubjectPublicKeyInfo DER. */
  readonly publicKeySpki: string;
  /** COSE algorithm: -7 ES256, -257 RS256. */
  readonly algorithm: number;
  readonly rpId: string;
  readonly signCount: number;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface ClockCredentialRepository {
  findByEmployeeId(employeeId: string): Promise<ClockCredential | null>;
  create(credential: ClockCredential): Promise<void>;
  recordUse(id: string, signCount: number, usedAt: string): Promise<void>;
  deleteByEmployeeId(employeeId: string): Promise<number>;
}

/** A WebAuthn ceremony's ID stays valid this long, matching the industry-normal window for a challenge/response round trip. */
export const WEBAUTHN_CHALLENGE_TTL_MS = 120_000;

/** One outstanding WebAuthn challenge — the fingerprint clock-in's register/assert ceremony. */
export interface PendingWebauthnChallenge {
  readonly challenge: string;
  readonly purpose: string;
  readonly rpId: string;
  readonly expiresAt: number;
}

/**
 * Persistence port for WebAuthn challenges (D289's cloud twin). Held in the
 * database rather than process memory: a multi-server cloud deployment has no
 * guarantee that the request which ISSUES a challenge and the request that
 * CONSUMES it land on the same server instance, and an in-memory `Map` on one
 * instance is invisible to the others.
 *
 * `issue` replaces any prior pending challenge for that user (at most one
 * outstanding challenge per user, matching the WebAuthn ceremony's own
 * one-at-a-time shape). `consume` is single-use: an implementation deletes the
 * row on ANY call, whether or not the purpose matches or the challenge has
 * expired, so a mismatched or expired attempt still burns it rather than
 * leaving it available to a second guess.
 */
export interface WebauthnChallengeRepository {
  issue(userId: string, purpose: string, rpId: string, now?: number): Promise<string>;
  consume(userId: string, purpose: string, now?: number): Promise<PendingWebauthnChallenge | null>;
}
