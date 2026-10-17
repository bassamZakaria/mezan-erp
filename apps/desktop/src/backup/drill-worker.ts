import { rm } from "node:fs/promises";
import path from "node:path";
import { createBackend } from "@mezan/backend";
import { ALL_SCOPE, createEntitlements, Money, MODULE_CATALOG } from "@mezan/domain";
import { extractArchive } from "./archive.js";
import { sha256File } from "./checksum.js";
import { countRows, parseManifest, type BackupManifest } from "./manifest.js";
import { assertIntegrityOk, openArchiveDatabase, type RestoreCipher } from "./restore-service.js";
import {
  ArchiveContentsError,
  BackupKeyMismatchError,
  ChecksumMismatchError,
  IntegrityCheckFailedError,
  ManifestValidationError,
} from "./errors.js";
import { cipherDriver } from "../main/encrypted-database.js";
import { DRILL_WORKER_FLAG } from "./worker-flags.js";
import {
  DrillCheck,
  DrillOutcome,
  type DrillInvariantsDTO,
  type DrillRowMismatchDTO,
  type DrillStepDTO,
} from "../shared/ipc-contract.js";

export interface DrillWorkerJob {
  readonly archivePath: string;
  readonly sandboxDir: string;
  readonly cipherKey: string | null;
  readonly appSchemaVersion: number;
}

export interface DrillWorkerResult {
  readonly outcome: DrillOutcome;
  readonly failedCheck: DrillCheck | null;
  readonly detail: string | null;
  readonly archiveCreatedAt: string | null;
  readonly schemaVersion: { readonly file: number; readonly manifest: number; readonly app: number } | null;
  readonly tables: number | null;
  readonly rows: number | null;
  readonly rowMismatches: readonly DrillRowMismatchDTO[];
  readonly invariants: DrillInvariantsDTO | null;
  readonly steps: readonly DrillStepDTO[];
}

class DrillStop extends Error {
  constructor(
    readonly check: DrillCheck,
    detail: string,
  ) {
    super(detail);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function scaledOf(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    return Money.fromMajor(String(value)).scaled;
  } catch {
    return null;
  }
}

async function computeInvariants(dbPath: string, cipherKey: string | null): Promise<DrillInvariantsDTO> {
  const backend = await createBackend({
    dbPath,
    scheduledJobs: false,
    ...(cipherKey ? { connection: { driver: cipherDriver, key: cipherKey } } : {}),
    resolveEntitlements: () =>
      createEntitlements({ plan: "DRILL", activeModules: MODULE_CATALOG, features: {}, seats: 1000, expiresAt: null }),
  });
  try {
    const token = backend.sessions.issue({
      userId: "SYSTEM-RESTORE-DRILL",
      permissions: ["*"],
      roleCode: "*",
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });
    const get = async (route: string): Promise<Record<string, unknown>> => {
      const res = await backend.app.fetch(
        new Request(`http://mezan.drill${route}`, {
          headers: { authorization: `Bearer ${token}`, "x-branch-scope": "*", "x-warehouse-scope": "*" },
        }),
      );
      if (!res.ok) throw new Error(`${route} answered ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    };

    const tb = await get("/financial-reports/trial-balance");
    const totals = (tb["grandTotals"] ?? {}) as Record<string, unknown>;
    const debit = scaledOf(totals["debit"]);
    const credit = scaledOf(totals["credit"]);
    if (debit === null || credit === null) throw new Error("the trial balance carried no grand totals");

    const recon = await get("/reconciliation");
    const rows = Array.isArray(recon["rows"]) ? (recon["rows"] as Array<Record<string, unknown>>) : [];
    const diff = (key: string): bigint => {
      const row = rows.find((r) => r["key"] === key);
      if (!row) throw new Error(`the reconciliation had no ${key} row`);
      const sub = scaledOf(row["subLedgerBalance"]);
      const gl = scaledOf(row["glBalance"]);
      if (sub === null || gl === null) throw new Error(`the ${key} reconciliation row was not numeric`);
      return sub - gl;
    };

    return {
      trialBalance: Money.fromScaled(debit - credit).toString(),
      inventory: Money.fromScaled(diff("inventory")).toString(),
      payables: Money.fromScaled(diff("ap")).toString(),
      receivables: Money.fromScaled(diff("ar")).toString(),
    };
  } finally {
    backend.close();
  }
}

function isZero(value: string): boolean {
  return Money.fromMajor(value).scaled === 0n;
}

export async function runDrillJob(job: DrillWorkerJob): Promise<DrillWorkerResult> {
  const steps: DrillStepDTO[] = [];
  const cipher: RestoreCipher | undefined = job.cipherKey ? { driver: cipherDriver, key: job.cipherKey } : undefined;
  let manifest: BackupManifest | null = null;
  let schemaVersion: DrillWorkerResult["schemaVersion"] = null;
  let tables: number | null = null;
  let rows: number | null = null;
  let rowMismatches: DrillRowMismatchDTO[] = [];
  let invariants: DrillInvariantsDTO | null = null;

  async function step<T>(check: DrillCheck, fn: () => Promise<T>, classify?: (err: unknown) => DrillCheck): Promise<T> {
    const started = Date.now();
    try {
      const value = await fn();
      steps.push({ check, ok: true, ms: Date.now() - started });
      return value;
    } catch (err) {
      const failed = err instanceof DrillStop ? err.check : (classify?.(err) ?? check);
      steps.push({ check: failed, ok: false, ms: Date.now() - started });
      throw err instanceof DrillStop ? err : new DrillStop(failed, messageOf(err));
    }
  }

  const extractDir = path.join(job.sandboxDir, "extract");
  try {
    const extracted = await step(DrillCheck.Archive, () => extractArchive(job.archivePath, extractDir));
    manifest = await step(DrillCheck.Manifest, async () => parseManifest(extracted.manifestJson));
    const expected = manifest;

    await step(DrillCheck.Checksum, async () => {
      const actual = await sha256File(extracted.dbFilePath);
      if (actual !== expected.checksum) throw new ChecksumMismatchError(expected.checksum, actual);
    });

    await step(
      DrillCheck.Integrity,
      () => assertIntegrityOk(extracted.dbFilePath, cipher),
      (err) => (err instanceof BackupKeyMismatchError ? DrillCheck.Key : DrillCheck.Integrity),
    );

    const db = await step(
      DrillCheck.Open,
      () => openArchiveDatabase(extracted.dbFilePath, cipher),
      (err) => (err instanceof BackupKeyMismatchError ? DrillCheck.Key : DrillCheck.Open),
    );

    try {
      await step(DrillCheck.Schema, async () => {
        const raw = db.pragma("user_version", { simple: true });
        const file = typeof raw === "number" ? raw : 0;
        schemaVersion = { file, manifest: expected.schemaVersion, app: job.appSchemaVersion };
        if (file > job.appSchemaVersion) {
          throw new Error(`schema ${file} is newer than this build (${job.appSchemaVersion})`);
        }
        if (file !== 0 && file !== expected.schemaVersion) {
          throw new Error(`the database says schema ${file}, the manifest says ${expected.schemaVersion}`);
        }
      });

      await step(DrillCheck.RowCounts, async () => {
        const restored = countRows(db);
        const names = new Set([...Object.keys(expected.tables), ...Object.keys(restored)]);
        tables = Object.keys(restored).length;
        rows = Object.values(restored).reduce((sum, n) => sum + n, 0);
        rowMismatches = [...names]
          .filter((name) => expected.tables[name] !== restored[name])
          .map((name) => ({ table: name, manifest: expected.tables[name] ?? null, restored: restored[name] ?? null }));
        if (rowMismatches.length > 0) {
          throw new Error(`${rowMismatches.length} table(s) differ from the manifest's row counts`);
        }
      });
    } finally {
      db.close();
    }

    invariants = await step(DrillCheck.Invariants, () => computeInvariants(extracted.dbFilePath, job.cipherKey));
    const computed = invariants;
    const tied = [computed.trialBalance, computed.inventory, computed.payables, computed.receivables].every(isZero);
    return {
      outcome: tied ? DrillOutcome.Pass : DrillOutcome.Warn,
      failedCheck: tied ? null : DrillCheck.Invariants,
      detail: tied
        ? null
        : `the archive restores, but its books do not tie: TB ${computed.trialBalance}, inventory ${computed.inventory}, AP ${computed.payables}, AR ${computed.receivables}`,
      archiveCreatedAt: manifest.createdAt,
      schemaVersion,
      tables,
      rows,
      rowMismatches,
      invariants,
      steps,
    };
  } catch (err) {
    const stop =
      err instanceof DrillStop
        ? err
        : new DrillStop(
            err instanceof ArchiveContentsError
              ? DrillCheck.Archive
              : err instanceof ManifestValidationError
                ? DrillCheck.Manifest
                : err instanceof IntegrityCheckFailedError
                  ? DrillCheck.Integrity
                  : DrillCheck.Crashed,
            messageOf(err),
          );
    return {
      outcome: DrillOutcome.Fail,
      failedCheck: stop.check,
      detail: stop.message,
      archiveCreatedAt: manifest?.createdAt ?? null,
      schemaVersion,
      tables,
      rows,
      rowMismatches,
      invariants,
      steps,
    };
  } finally {
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

if (process.argv.includes(DRILL_WORKER_FLAG)) {
  process.on("message", (job: DrillWorkerJob) => {
    runDrillJob(job)
      .catch(
        (err: unknown): DrillWorkerResult => ({
          outcome: DrillOutcome.Fail,
          failedCheck: DrillCheck.Crashed,
          detail: messageOf(err),
          archiveCreatedAt: null,
          schemaVersion: null,
          tables: null,
          rows: null,
          rowMismatches: [],
          invariants: null,
          steps: [],
        }),
      )
      .then((result) => {
        process.send?.(result, () => process.exit(0));
      });
  });
}
