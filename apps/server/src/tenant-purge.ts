import { existsSync, readdirSync } from "node:fs";
import { lstat, open, readdir, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { createLogger, type JobTracker } from "@mezan/api";
import { PlatformAuditUnavailableError, type PlatformHandle, type PlatformTenantRetentionPort } from "@mezan/backend";
import type { TenantPurgeResultDTO, TenantRetentionDTO } from "@mezan/contracts";
import { AuditSeverityCode, recordSecurityEvent, TenantStatusCode, type Tenant } from "@mezan/domain";
import { createTenantRetentionStore, withSqliteTransaction, type TenantRetentionStore } from "@mezan/persistence";
import { legacyBackupsOf, tenantBackupFolder } from "./backup-scheduler.js";
import { platformActor } from "./provision-tenant.js";
import { tenantDbPath, type TenantRouter } from "./tenant-router.js";

const purgeLog = createLogger("tenant-purge");

const DAY_MS = 24 * 60 * 60 * 1000;
const SHRED_CHUNK_BYTES = 1024 * 1024;
export const TENANT_PURGE_SYSTEM_ACTOR = "system:retention";

export const TENANT_DATA_PURGED_AUDIT = "TENANT_DATA_PURGED";

export enum TenantPurgeLogEvent {
  Scheduled = "tenant_purge.scheduled",
  Planned = "tenant_purge.planned",
  Purged = "tenant_purge.purged",
  Failed = "tenant_purge.failed",
}

export enum TenantPurgeTrigger {
  Retention = "retention",
  Owner = "owner",
}

export class TenantNotTerminatedError extends Error {
  readonly code = "TENANT_NOT_TERMINATED";
  readonly messageEn = "A tenant's data is deleted only after the tenant is archived.";
  constructor(tenantId: string) {
    super(`لا تُحذف بيانات المنشأة ${tenantId} إلا بعد أرشفتها.`);
    this.name = "TenantNotTerminatedError";
  }
}

export interface TenantPurgeDeps {
  readonly platform: PlatformHandle;
  readonly router: Pick<TenantRouter, "evict" | "invalidate">;
  readonly dataDir: string;
  readonly retentionDays: number;
  /** The local anchor file's folder, only when anchors are kept on this host; off-server anchors are never touched. */
  readonly localAnchorDir: string | null;
  readonly discardExports: (tenantId: string) => void;
  readonly now: () => Date;
  readonly store?: TenantRetentionStore;
}

export interface TenantPurgeService extends PlatformTenantRetentionPort {
  /** One daily pass: schedules every archived tenant not yet scheduled, and purges the ones that are due. */
  sweep(): Promise<{ readonly scheduled: number; readonly purged: number; readonly failed: number }>;
  purge(tenant: Tenant, by: { readonly actor: string; readonly reason: string; readonly trigger: TenantPurgeTrigger }): Promise<TenantPurgeResultDTO>;
}

// Best effort: the bytes are overwritten in place before the name is removed. On an SSD or a copy-on-write
// file system the old blocks can survive until the drive reuses them; the server disk is not encrypted.
export async function shredFile(file: string): Promise<void> {
  const info = await lstat(file);
  if (info.isFile()) {
    const handle = await open(file, "r+");
    try {
      const zeros = Buffer.alloc(Math.min(SHRED_CHUNK_BYTES, Math.max(info.size, 1)));
      for (let written = 0; written < info.size; written += zeros.length) await handle.write(zeros, 0, Math.min(zeros.length, info.size - written), written);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  await unlink(file);
}

async function shredTree(target: string, removed: string[]): Promise<void> {
  if (!existsSync(target)) return;
  if ((await stat(target)).isDirectory()) {
    for (const entry of await readdir(target)) await shredTree(path.join(target, entry), removed);
    await rmdir(target);
    removed.push(target);
    return;
  }
  await shredFile(target);
  removed.push(target);
}

function databaseFilesOf(dataDir: string, tenant: Pick<Tenant, "dbFile">): string[] {
  const database = tenantDbPath(dataDir, tenant.dbFile);
  const directory = path.dirname(database);
  if (!existsSync(directory)) return [];
  const base = path.basename(database);
  return readdirSync(directory)
    .filter((name) => name === base || name.startsWith(`${base}-`) || name.startsWith(`${base}.`))
    .map((name) => path.join(directory, name));
}

const addDays = (iso: string, days: number): string => new Date(Date.parse(iso) + days * DAY_MS).toISOString();

export function createTenantPurge(deps: TenantPurgeDeps): TenantPurgeService {
  const { platform, dataDir } = deps;
  const store = deps.store ?? createTenantRetentionStore(platform.stores.sqlite);
  const nowIso = () => deps.now().toISOString();

  const view = (tenant: Tenant): TenantRetentionDTO => {
    const record = tenant.status === TenantStatusCode.Archived ? store.find(tenant.id) : null;
    return {
      retentionDays: deps.retentionDays,
      retention: record ? { terminatedAt: record.terminatedAt, deleteAfter: record.deleteAfter, lastExtension: record.lastExtension } : null,
    };
  };

  const filesOf = (tenant: Tenant): string[] => [
    ...databaseFilesOf(dataDir, tenant),
    tenantBackupFolder(dataDir, tenant.id),
    ...legacyBackupsOf(dataDir, tenant),
    ...(deps.localAnchorDir ? [path.join(deps.localAnchorDir, `${tenant.id}.jsonl`)] : []),
  ].filter((file) => existsSync(file));

  async function purge(tenant: Tenant, by: { readonly actor: string; readonly reason: string; readonly trigger: TenantPurgeTrigger }): Promise<TenantPurgeResultDTO> {
    const buried = store.tombstoneOf(tenant.id);
    if (buried) return { tenantId: buried.id, code: buried.code, deletedAt: buried.deletedAt, removed: [] };
    // SECURITY: never an active, suspended or provisioning tenant — whatever schedule row says otherwise.
    if (tenant.status !== TenantStatusCode.Archived) throw new TenantNotTerminatedError(tenant.id);
    const planned = filesOf(tenant);
    purgeLog.warn({ event: TenantPurgeLogEvent.Planned, tenantId: tenant.id, code: tenant.code, trigger: by.trigger, files: planned }, `tenant "${tenant.code}" is about to be deleted`);
    const removed: string[] = [];
    await platform.outsideTheTurn(async () => {
      await deps.router.evict(tenant.id);
      deps.discardExports(tenant.id);
      for (const target of planned) await shredTree(target, removed);
    });
    const deletedAt = nowIso();
    // REQUIRED ORDERING: files first, rows last. A crash between them leaves the row, and the next pass finishes
    // the job; the other way round would orphan files nothing ever looks for again.
    await withSqliteTransaction(
      platform.stores.sqlite,
      async () => {
        store.removeTenantRows(tenant, deletedAt);
        await recordSecurityEvent(platform.audit, {
          module: "platform",
          entityType: "PLATFORM",
          entityId: tenant.id,
          action: TENANT_DATA_PURGED_AUDIT,
          actor: by.actor,
          severity: AuditSeverityCode.Critical,
          timestamp: deletedAt,
          details: { code: tenant.code, trigger: by.trigger, reason: by.reason, removed: removed.map((file) => path.relative(dataDir, file)), keptOffServer: ["restic snapshots", "off-server audit anchors"] },
        }).catch((cause: unknown) => {
          throw new PlatformAuditUnavailableError(cause);
        });
      },
      "BEGIN IMMEDIATE",
    );
    deps.router.invalidate(tenant.code);
    purgeLog.warn({ event: TenantPurgeLogEvent.Purged, tenantId: tenant.id, code: tenant.code, trigger: by.trigger, removed: removed.length }, `tenant "${tenant.code}" was deleted`);
    return { tenantId: tenant.id, code: tenant.code, deletedAt, removed: removed.map((file) => path.relative(dataDir, file)) };
  }

  return {
    view,
    scheduleOnArchive(tenant, at) {
      store.schedule(tenant.id, at, addDays(at, deps.retentionDays));
    },
    extend({ tenant, deleteAfter, reason, actorId, at }) {
      return store.extend(tenant.id, deleteAfter, { actor: platformActor(actorId), at, reason });
    },
    purgeNow({ tenant, reason, actorId }) {
      return purge(tenant, { actor: platformActor(actorId), reason, trigger: TenantPurgeTrigger.Owner });
    },
    purge,
    sweep: () => platform.inTheTurn("tenant purge sweep", async () => {
      const counts = { scheduled: 0, purged: 0, failed: 0 };
      const at = nowIso();
      for (const tenant of await platform.stores.tenants.list()) {
        if (tenant.status !== TenantStatusCode.Archived || store.find(tenant.id)) continue;
        // Archived before this schedule existed: the clock starts the first time it is seen, never backdated.
        const record = store.schedule(tenant.id, at, addDays(at, deps.retentionDays));
        counts.scheduled += 1;
        purgeLog.info({ event: TenantPurgeLogEvent.Scheduled, tenantId: tenant.id, code: tenant.code, deleteAfter: record.deleteAfter }, `tenant "${tenant.code}" is scheduled for deletion`);
      }
      for (const due of store.due(at)) {
        const tenant = await platform.stores.tenants.findById(due.tenantId);
        if (!tenant || tenant.status !== TenantStatusCode.Archived) continue;
        try {
          await purge(tenant, { actor: TENANT_PURGE_SYSTEM_ACTOR, reason: `retention of ${deps.retentionDays} days after archive ended ${due.deleteAfter}`, trigger: TenantPurgeTrigger.Retention });
          counts.purged += 1;
        } catch (err) {
          counts.failed += 1;
          purgeLog.error({ event: TenantPurgeLogEvent.Failed, tenantId: tenant.id, err }, `tenant "${tenant.code}" could not be deleted`);
        }
      }
      return counts;
    }),
  };
}

export interface TenantPurgeTimer {
  stop(): Promise<void>;
  runNow(): Promise<void>;
}

export function startTenantPurgeTimer(purge: Pick<TenantPurgeService, "sweep">, options: { readonly intervalMs?: number; readonly job?: JobTracker }): TenantPurgeTimer {
  let current: Promise<unknown> = Promise.resolve();
  const run = (): Promise<void> => {
    const sweep = () => purge.sweep();
    current = (options.job ? options.job.run(sweep, (result) => result.purged) : sweep()).catch((err: unknown) =>
      purgeLog.error({ event: TenantPurgeLogEvent.Failed, err }, "the tenant purge sweep failed"),
    );
    return current.then(() => undefined);
  };
  void run();
  const timer = setInterval(() => void run(), options.intervalMs ?? DAY_MS);
  timer.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      await current;
    },
    runNow: run,
  };
}
