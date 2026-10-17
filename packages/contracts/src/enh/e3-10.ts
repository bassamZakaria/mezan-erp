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
}
