import { z } from "zod";

export enum HealthLevelDTO {
  Ok = "ok",
  Warn = "warn",
  Critical = "critical",
  Unknown = "unknown",
}

export enum HealthSectionDTO {
  Outbox = "outbox",
  Eta = "eta",
  AuditChain = "audit_chain",
}

export interface HealthOutboxDTO {
  readonly level: HealthLevelDTO;
  readonly queued: number;
  readonly failed: number;
  readonly oldestQueuedAt: string | null;
  readonly oldestAgeMinutes: number | null;
  readonly mailConfigured: boolean;
}

export interface HealthEtaErrorDTO {
  readonly internalId: string;
  readonly documentType: string;
  readonly updatedAt: string;
  readonly message: string | null;
}

export interface HealthEtaDTO {
  readonly level: HealthLevelDTO;
  readonly ready: number;
  readonly pendingSignature: number;
  readonly error: number;
  readonly submitted: number;
  readonly oldestUnsentAt: string | null;
  readonly recentErrors: readonly HealthEtaErrorDTO[];
  /** The stored ETA client secret cannot be opened here and must be entered again. */
  readonly clientSecretNeedsReentry: boolean;
}

export interface HealthAuditChainDTO {
  readonly level: HealthLevelDTO;
  readonly reason: string;
  readonly headRowId: number | null;
}

export interface HealthLicenceDTO {
  readonly level: HealthLevelDTO;
  readonly state: string;
  readonly canWrite: boolean;
  readonly expiresAt: string | null;
  readonly graceEndsAt: string | null;
  readonly daysLeft: number | null;
  readonly planName: string | null;
}

export interface HealthSeatsDTO {
  readonly level: HealthLevelDTO;
  readonly licensed: number;
  readonly activeUsers: number;
}

export interface HealthJobDTO {
  readonly level: HealthLevelDTO;
  readonly kind: string;
  readonly lastRunAt: string | null;
  readonly lastOkAt: string | null;
  readonly lastError: string | null;
  readonly lastRecorded: number;
  readonly nextRunAt: string | null;
}

export interface HealthDatabaseDTO {
  readonly dbBytes: number;
  readonly walBytes: number | null;
  readonly freeListBytes: number;
}

export interface SystemHealthDTO {
  readonly generatedAt: string;
  readonly cloudTenant: boolean;
  readonly level: HealthLevelDTO;
  readonly withheld: readonly HealthSectionDTO[];
  readonly outbox: HealthOutboxDTO | null;
  readonly eta: HealthEtaDTO | null;
  readonly auditChain: HealthAuditChainDTO | null;
  readonly licence: HealthLicenceDTO;
  readonly seats: HealthSeatsDTO;
  readonly jobs: readonly HealthJobDTO[];
  readonly database: HealthDatabaseDTO;
  readonly clientErrors?: HealthClientErrorsDTO | null;
}

export enum ClientErrorPlatformDTO {
  Web = "web",
  Desktop = "desktop",
  Mobile = "mobile",
}

export enum ClientErrorKindDTO {
  RouteError = "route_error",
  WindowError = "window_error",
  UnhandledRejection = "unhandled_rejection",
  JsError = "js_error",
  FatalJsError = "fatal_js_error",
}

export const CLIENT_ERROR_LIMITS = {
  message: 500,
  stack: 4000,
  route: 300,
  appVersion: 40,
  userAgent: 300,
} as const;

const trimmedText = (max: number) => z.string().transform((value) => value.slice(0, max));

export const clientErrorReportSchema = z.object({
  platform: z.nativeEnum(ClientErrorPlatformDTO),
  kind: z.nativeEnum(ClientErrorKindDTO),
  message: z.string().min(1).transform((value) => value.slice(0, CLIENT_ERROR_LIMITS.message)),
  stack: trimmedText(CLIENT_ERROR_LIMITS.stack).nullish(),
  route: trimmedText(CLIENT_ERROR_LIMITS.route).nullish(),
  appVersion: trimmedText(CLIENT_ERROR_LIMITS.appVersion).nullish(),
  userAgent: trimmedText(CLIENT_ERROR_LIMITS.userAgent).nullish(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).nullish(),
});

export type ClientErrorReportDTO = z.input<typeof clientErrorReportSchema>;

export interface HealthClientErrorDTO {
  readonly id: string;
  readonly receivedAt: string;
  readonly platform: ClientErrorPlatformDTO;
  readonly kind: ClientErrorKindDTO;
  readonly message: string;
  readonly stack: string | null;
  readonly route: string | null;
  readonly appVersion: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly userId: string | null;
}

export interface HealthClientErrorsDTO {
  readonly level: HealthLevelDTO;
  readonly lastDay: number;
  readonly recent: readonly HealthClientErrorDTO[];
}

export interface PlatformAlertStateDTO {
  readonly key: string;
  readonly kind: string;
  readonly lastSentAt: string | null;
  readonly lastRaisedAt: string;
  readonly suppressed: number;
}

export interface PlatformOperationsDTO {
  readonly generatedAt: string;
  readonly ready: boolean;
  readonly checks: Readonly<Record<string, boolean>>;
  readonly alertsConfigured: boolean;
  readonly jobs: readonly HealthJobDTO[];
  readonly alerts: readonly PlatformAlertStateDTO[];
}
