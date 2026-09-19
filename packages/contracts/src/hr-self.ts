import { z } from "zod";
import { moneyString } from "./money-string.js";
import { createLeaveRequestSchema, type AttendanceEntryDTO, type EmployeeStatusDTO } from "./hr.js";
import type { EmployeeAdvanceDTO, PayrollRunStatusDTO, PayslipDTO } from "./hr-payroll.js";

/**
 * Wire contracts for employee self-service (`/hr/self/*`). The employee is
 * always the caller's own linked record; no body names one.
 */

export enum SelfClockActionDTO {
  In = "in",
  Out = "out",
}

export enum ClockChallengePurposeDTO {
  Register = "register",
  Assert = "assert",
}

export const selfClockActionSchema = z.nativeEnum(SelfClockActionDTO);
export const clockChallengePurposeSchema = z.nativeEnum(ClockChallengePurposeDTO);

const base64url = z.string().min(1).max(20_000).regex(/^[A-Za-z0-9_-]+={0,2}$/);

export const selfieUploadSchema = z.object({
  contentBase64: z.string().min(1).max(7_000_000),
  mimeType: z.string().min(1).max(100),
});

export const biometricAssertionSchema = z.object({
  credentialId: base64url,
  clientDataJSON: base64url,
  authenticatorData: base64url,
  signature: base64url,
});

export const geoStampSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().max(1_000_000).nullable().optional(),
});

export const selfClockPunchSchema = z.object({
  action: selfClockActionSchema,
  selfie: selfieUploadSchema.optional(),
  biometric: biometricAssertionSchema.optional(),
  location: geoStampSchema.optional(),
});

export const clockChallengeRequestSchema = z.object({
  purpose: clockChallengePurposeSchema,
});

export const clockCredentialRegistrationSchema = z.object({
  credentialId: base64url,
  clientDataJSON: base64url,
  authenticatorData: base64url,
  publicKey: base64url,
  publicKeyAlgorithm: z.number().int(),
});

export const selfCreateAdvanceSchema = z.object({
  amount: moneyString,
  installmentCount: z.number().int().positive().max(60),
  firstDeductionDate: z.string().min(1),
  reason: z.string().max(500).nullable().optional(),
});

export const selfCreateLeaveRequestSchema = createLeaveRequestSchema.omit({ employeeId: true });

export type SelfClockPunchDTO = z.infer<typeof selfClockPunchSchema>;
export type SelfieUploadDTO = z.infer<typeof selfieUploadSchema>;
export type BiometricAssertionDTO = z.infer<typeof biometricAssertionSchema>;
export type GeoStampDTO = z.infer<typeof geoStampSchema>;
export type ClockCredentialRegistrationDTO = z.infer<typeof clockCredentialRegistrationSchema>;
export type SelfCreateAdvanceDTO = z.infer<typeof selfCreateAdvanceSchema>;
export type SelfCreateLeaveRequestDTO = z.infer<typeof selfCreateLeaveRequestSchema>;

export interface SelfEmployeeDTO {
  readonly id: string;
  readonly code: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly firstNameAr: string | null;
  readonly lastNameAr: string | null;
  readonly departmentName: string | null;
  readonly departmentNameAr: string | null;
  readonly jobTitleName: string | null;
  readonly jobTitleNameAr: string | null;
  readonly branchId: string;
  readonly hireDate: string;
  readonly status: EmployeeStatusDTO;
  readonly requireSelfieAtClockIn: boolean;
  readonly requireBiometricAtClockIn: boolean;
}

export interface SelfProfileDTO {
  readonly employeeId: string | null;
  readonly employee: SelfEmployeeDTO | null;
}

export interface SelfClockStatusDTO {
  readonly employeeId: string | null;
  readonly today: string;
  readonly serverTime: string;
  readonly todayEntry: AttendanceEntryDTO | null;
  /** The entry an out-punch would close: today's, or yesterday's still-open overnight shift. */
  readonly openEntry: AttendanceEntryDTO | null;
  readonly requireSelfie: boolean;
  readonly requireBiometric: boolean;
  readonly biometricRegistered: boolean;
  readonly storageAvailable: boolean;
}

export interface ClockChallengeDTO {
  readonly challenge: string;
  readonly rpId: string;
  readonly rpName: string;
  readonly userId: string;
  readonly userName: string;
  readonly userDisplayName: string;
  readonly timeoutMs: number;
  readonly allowCredentialIds: readonly string[];
}

export interface SelfClockPunchResultDTO {
  readonly entry: AttendanceEntryDTO;
  readonly selfieAttachmentId: string | null;
}

export interface SelfAttendanceMonthDTO {
  readonly employeeId: string | null;
  readonly month: string;
  readonly entries: readonly AttendanceEntryDTO[];
}

export interface SelfPayslipRowDTO {
  readonly payslip: PayslipDTO;
  readonly run: {
    readonly id: string;
    readonly number: string;
    readonly year: number;
    readonly month: number;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly status: PayrollRunStatusDTO;
    readonly statutoryTableCodes: readonly string[];
  };
}

export interface SelfPayslipsDTO {
  readonly employeeId: string | null;
  readonly payslips: readonly SelfPayslipRowDTO[];
}

export interface SelfPayslipPrintDTO extends SelfPayslipRowDTO {
  readonly employee: SelfEmployeeDTO;
  readonly printTemplate: unknown;
  readonly company: {
    readonly companyName: string;
    readonly address: string | null;
    readonly phone: string | null;
    readonly email: string | null;
    readonly taxRegistrationNumber: string | null;
    readonly commercialRegistrationNumber: string | null;
  } | null;
}

export interface SelfAdvancesDTO {
  readonly employeeId: string | null;
  readonly advances: readonly EmployeeAdvanceDTO[];
}
