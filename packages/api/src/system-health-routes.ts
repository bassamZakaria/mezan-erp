import { Hono } from "hono";
import {
  AuditChainHeadReason,
  HealthLevel,
  auditChainLevel,
  can,
  etaLevel,
  jobLevel,
  licenceLevel,
  minutesBetween,
  outboxLevel,
  seatsLevel,
  worstLevel,
  type UserRepository,
} from "@mezan/domain";
import {
  HealthLevelDTO,
  HealthSectionDTO,
  type HealthClientErrorDTO,
  type HealthJobDTO,
  type SystemHealthDTO,
} from "@mezan/contracts";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";
import type { LicenseStateResolver } from "./license-gate.js";

const OUTBOX_PERMISSION = "admin.settings.edit";
const ETA_PERMISSION = "accounting.eta.view";
const AUDIT_PERMISSION = "audit.logs.view";
const ETA_RECENT_ERRORS = 5;
const MS_PER_HOUR = 3_600_000;

export interface SystemHealthJobReading {
  readonly kind: string;
  readonly lastRunAt: string | null;
  readonly lastOkAt: string | null;
  readonly lastError: string | null;
  readonly lastRecorded: number;
  readonly nextRunAt: string | null;
  readonly intervalMs: number;
}

export interface SystemHealthRoutesDeps {
  readonly outbox: () => { queued: number; failed: number; oldestQueuedAt: string | null };
  readonly eta: (recentErrorLimit: number) => {
    ready: number;
    pendingSignature: number;
    error: number;
    submitted: number;
    oldestUnsentAt: string | null;
    recentErrors: readonly { internalId: string; documentType: string; updatedAt: string; message: string | null }[];
  };
  readonly database: () => { dbBytes: number; walBytes: number | null; freeListBytes: number };
  readonly auditChain?: { verifyHead(): { reason: AuditChainHeadReason; headRowId: number | null } };
  readonly jobs: () => readonly SystemHealthJobReading[];
  readonly users: Pick<UserRepository, "list">;
  readonly mailConfigured: () => Promise<boolean>;
  readonly resolveLicenseState?: LicenseStateResolver;
  readonly cloudTenant: boolean;
  readonly clientErrors?: (sinceIso: string, recentLimit: number) => { readonly lastDay: number; readonly recent: readonly HealthClientErrorDTO[] };
  readonly now?: () => Date;
}

const CLIENT_ERRORS_SHOWN = 20;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const LEVEL_DTO: Readonly<Record<HealthLevel, HealthLevelDTO>> = {
  [HealthLevel.Ok]: HealthLevelDTO.Ok,
  [HealthLevel.Warn]: HealthLevelDTO.Warn,
  [HealthLevel.Critical]: HealthLevelDTO.Critical,
  [HealthLevel.Unknown]: HealthLevelDTO.Unknown,
};

const GRACE_STATE = "GRACE";

export function createSystemHealthRoutes(deps: SystemHealthRoutesDeps, resolveAuthContext: AuthContextResolver) {
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

  app.get("/", gate("admin.health.view"), async (c) => {
    const ctx = getAuthContext(c);
    const now = deps.now?.() ?? new Date();
    const withheld: HealthSectionDTO[] = [];
    const levels: HealthLevel[] = [];

    let outbox: SystemHealthDTO["outbox"] = null;
    if (ctx && can(ctx, OUTBOX_PERMISSION)) {
      const reading = deps.outbox();
      const mailConfigured = await deps.mailConfigured();
      const oldestAgeMinutes = reading.oldestQueuedAt ? minutesBetween(reading.oldestQueuedAt, now) : null;
      const level = outboxLevel({ queued: reading.queued, oldestAgeMinutes, mailConfigured });
      levels.push(level);
      outbox = { level: LEVEL_DTO[level], ...reading, oldestAgeMinutes, mailConfigured };
    } else withheld.push(HealthSectionDTO.Outbox);

    let eta: SystemHealthDTO["eta"] = null;
    if (ctx && can(ctx, ETA_PERMISSION)) {
      const reading = deps.eta(ETA_RECENT_ERRORS);
      const unsent = reading.ready + reading.pendingSignature + reading.error;
      const oldestUnsentAgeHours = reading.oldestUnsentAt ? Math.floor((now.getTime() - new Date(reading.oldestUnsentAt).getTime()) / MS_PER_HOUR) : null;
      const level = etaLevel({ errors: reading.error, unsent, oldestUnsentAgeHours });
      levels.push(level);
      eta = { level: LEVEL_DTO[level], ...reading };
    } else withheld.push(HealthSectionDTO.Eta);

    let auditChain: SystemHealthDTO["auditChain"] = null;
    if (ctx && can(ctx, AUDIT_PERMISSION) && deps.auditChain) {
      const verdict = deps.auditChain.verifyHead();
      const level = auditChainLevel(verdict.reason);
      levels.push(level);
      auditChain = { level: LEVEL_DTO[level], reason: verdict.reason, headRowId: verdict.headRowId };
    } else withheld.push(HealthSectionDTO.AuditChain);

    const entitlements = c.get("entitlements");
    const license = deps.resolveLicenseState ? await deps.resolveLicenseState(c) : null;
    const expiresAt = license?.expiresAt ?? entitlements?.expiresAt ?? null;
    const daysLeft = expiresAt ? Math.floor((new Date(expiresAt).getTime() - now.getTime()) / (24 * MS_PER_HOUR)) : null;
    const licenceState = license?.state ?? "ACTIVE";
    const licence = licenceLevel({
      usable: license?.usable ?? true,
      canWrite: license?.canWrite ?? true,
      grace: licenceState === GRACE_STATE,
      daysLeft,
    });
    levels.push(licence);

    const activeUsers = (await deps.users.list()).filter((u) => u.status === "active").length;
    const licensedSeats = entitlements?.seats ?? 0;
    const seats = seatsLevel({ licensed: licensedSeats, used: activeUsers });
    levels.push(seats);

    const jobs: HealthJobDTO[] = deps.jobs().map((job) => {
      const level = jobLevel({ lastError: job.lastError, lastRunAt: job.lastRunAt, lastOkAt: job.lastOkAt, intervalMs: job.intervalMs, now });
      levels.push(level);
      return {
        level: LEVEL_DTO[level],
        kind: job.kind,
        lastRunAt: job.lastRunAt,
        lastOkAt: job.lastOkAt,
        lastError: job.lastError,
        lastRecorded: job.lastRecorded,
        nextRunAt: job.nextRunAt,
      };
    });

    let clientErrors: SystemHealthDTO["clientErrors"] = null;
    if (deps.clientErrors) {
      const reading = deps.clientErrors(new Date(now.getTime() - MS_PER_DAY).toISOString(), CLIENT_ERRORS_SHOWN);
      const level = reading.lastDay === 0 ? HealthLevel.Ok : HealthLevel.Warn;
      levels.push(level);
      clientErrors = { level: LEVEL_DTO[level], ...reading };
    }

    const body: SystemHealthDTO = {
      generatedAt: now.toISOString(),
      cloudTenant: deps.cloudTenant,
      level: LEVEL_DTO[worstLevel(levels)],
      withheld,
      outbox,
      eta,
      auditChain,
      licence: {
        level: LEVEL_DTO[licence],
        state: licenceState,
        canWrite: license?.canWrite ?? true,
        expiresAt,
        graceEndsAt: license?.graceEndsAt ?? null,
        daysLeft,
        planName: entitlements?.planNameAr ?? entitlements?.plan ?? null,
      },
      seats: { level: LEVEL_DTO[seats], licensed: licensedSeats, activeUsers },
      jobs,
      database: deps.database(),
      clientErrors,
    };
    return c.json(body);
  });

  return app;
}
