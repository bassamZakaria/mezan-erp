import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, openSync, readSync, renameSync, rmSync, statSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Context } from "hono";
import { tenantDbFile, TenantDbFileRefusal, tenantDbFileRefusalOf, TenantStatusCode, type Tenant, type TenantRepository } from "@mezan/domain";
import { holdSqliteFile, SqliteFileBusyError } from "@mezan/persistence";

const SQLITE_FILE_SUFFIXES = ["", "-wal", "-shm"] as const;
const SQLITE_SIBLING_SUFFIXES = ["-wal", "-shm"] as const;

const SQLITE_HEADER_MAGIC = Buffer.from("SQLite format 3\0");
const SQLITE_HEADER_BYTES = 100;

export { TenantDbFileRefusal };

export abstract class TenantDbFileError extends Error {
  abstract readonly code: TenantDbFileRefusal;
  readonly retryable: boolean = false;

  constructor(readonly tenantId: string, readonly file: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class TenantDbFileConflictError extends TenantDbFileError {
  readonly code = TenantDbFileRefusal.Conflict;

  constructor(tenantId: string, file: string) {
    super(tenantId, file, `tenant "${tenantId}" has two different database files; "${file}" was left untouched`);
  }
}

export class TenantDbFileMissingError extends TenantDbFileError {
  readonly code = TenantDbFileRefusal.Missing;

  constructor(tenantId: string, file: string) {
    super(tenantId, file, `the database file "${file}" of tenant "${tenantId}" is not where its row says; nothing was changed`);
  }
}

export class TenantDbFileSharedError extends TenantDbFileError {
  readonly code = TenantDbFileRefusal.Shared;

  constructor(tenantId: string, file: string, readonly otherTenantIds: readonly string[]) {
    super(tenantId, file, `the database file "${file}" of tenant "${tenantId}" is also named by ${otherTenantIds.map((id) => `"${id}"`).join(", ")}; nothing was changed`);
  }
}

export class TenantDbFileBusyError extends TenantDbFileError {
  readonly code = TenantDbFileRefusal.Busy;
  override readonly retryable = true;

  constructor(tenantId: string, file: string) {
    super(tenantId, file, `the database file "${file}" of tenant "${tenantId}" is open elsewhere; it was not moved`);
  }
}

export class TenantDbFileForeignError extends TenantDbFileError {
  readonly code = TenantDbFileRefusal.Foreign;

  constructor(tenantId: string, file: string, readonly boundTenantId: string | null) {
    super(
      tenantId,
      file,
      boundTenantId === null
        ? `the database file "${file}" is not bound to tenant "${tenantId}" and nobody ever claimed it; it was not opened for use and nothing was written`
        : `the database file "${file}" of tenant "${tenantId}" is bound to tenant "${boundTenantId}"; it was not opened for use and nothing was written`,
    );
  }
}

export class TenantDbFileDisownedError extends TenantDbFileError {
  readonly code = TenantDbFileRefusal.Disowned;

  constructor(tenantId: string, file: string) {
    super(tenantId, file, `the platform console recorded that the database file "${file}" does not hold the books of tenant "${tenantId}"; it was not opened for use`);
  }
}

export class TenantDbFileUnreadableError extends TenantDbFileError {
  readonly code = TenantDbFileRefusal.Unreadable;

  constructor(tenantId: string, file: string, readonly cause: unknown) {
    super(tenantId, file, `the database file "${file}" of tenant "${tenantId}" is not a readable SQLite database; nothing was written`);
  }
}

const RETRY_AFTER_SECONDS = 5;

export function answerTenantDbFileRefusal(c: Context, err: unknown): Response | null {
  const refusal = tenantDbFileRefusalOf(err);
  if (!refusal) return null;
  if (refusal.retryable) c.header("Retry-After", String(RETRY_AFTER_SECONDS));
  return c.json({ error: refusal.error, message: refusal.message, messageEn: refusal.messageEn }, 503);
}

export function sha256OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export interface TenantDbFileIo {
  readonly copyFile?: (from: string, to: string) => Promise<void>;
  readonly sha256Of?: (file: string) => Promise<string>;
  readonly waitMs?: number;
  // REQUIRED: hashing and copying a file is not the platform's database; a
  // caller that holds the platform connection's turn hands it back through this.
  readonly outsideTheTurn?: <T>(work: () => Promise<T>) => Promise<T>;
}

type Tenants = Pick<TenantRepository, "setDbFile" | "findById" | "list">;

export function holdsSqliteDatabase(file: string): boolean {
  const stat = statSync(file, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.size < SQLITE_HEADER_BYTES) return false;
  const magic = Buffer.alloc(SQLITE_HEADER_MAGIC.length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, magic, 0, magic.length, 0);
  } finally {
    closeSync(fd);
  }
  return magic.equals(SQLITE_HEADER_MAGIC);
}

// SECURITY: a tenant that was ever served has books. Opening a name that holds
// no database would create an empty one in their place, with no owner in it,
// for the first anonymous caller to claim.
function refuseServedTenantWithoutBooks(tenant: Tenant, file: string): void {
  if (tenant.status !== TenantStatusCode.Provisioning && !holdsSqliteDatabase(file)) throw new TenantDbFileMissingError(tenant.id, tenant.dbFile);
}

function stampOf(files: readonly string[]): string {
  return files
    .flatMap((file) => SQLITE_FILE_SUFFIXES.map((suffix) => `${file}${suffix}`))
    .map((file) => {
      const stat = statSync(file, { throwIfNoEntry: false });
      return stat ? `${stat.size}:${stat.mtimeMs}` : "-";
    })
    .join("|");
}

const knownConflicts = new Map<string, { readonly stamp: string; readonly error: TenantDbFileConflictError }>();
const differingStaleCopies = new Map<string, string>();

async function othersNaming(tenants: Tenants, tenant: Tenant, dbFile: string): Promise<string[]> {
  return (await tenants.list()).filter((other) => other.id !== tenant.id && other.dbFile === dbFile).map((other) => other.id);
}

async function dropStaleCopy(tenants: Tenants, dataDir: string, tenant: Tenant, sha256Of: (file: string) => Promise<string>): Promise<void> {
  const legacy = `tenants/${tenant.code}.db`;
  const stale = path.join(dataDir, legacy);
  const current = path.join(dataDir, tenant.dbFile);
  if (legacy === tenant.dbFile || !existsSync(stale) || !existsSync(current)) return;
  if ((await othersNaming(tenants, tenant, legacy)).length > 0) return;
  const key = `${dataDir}\n${tenant.id}`;
  const stamp = stampOf([stale, current]);
  if (differingStaleCopies.get(key) === stamp) return;
  if ((await sha256Of(stale)) === (await sha256Of(current))) {
    for (const suffix of SQLITE_FILE_SUFFIXES) rmSync(`${stale}${suffix}`, { force: true });
    differingStaleCopies.delete(key);
    return;
  }
  const reported = differingStaleCopies.has(key);
  differingStaleCopies.set(key, stamp);
  if (reported) return;
  console.warn(`[cloud] tenant "${tenant.id}" is served from "${tenant.dbFile}", and a different file was left at "${legacy}"; it was not removed`);
}

// REQUIRED ORDERING: hold the old file exclusively, copy and verify, point the
// platform row at the copy, and only then remove the old file. The platform
// row is the source of truth: a crash at any step leaves a file the row names,
// complete, and a write that could land in the old file afterwards is refused
// before anything is copied.
export async function settleTenantDbFile(tenants: Tenants, dataDir: string, tenant: Tenant, io: TenantDbFileIo = {}): Promise<Tenant> {
  const outside = io.outsideTheTurn ?? (<T>(work: () => Promise<T>): Promise<T> => work());
  const sha256Of = (file: string): Promise<string> => outside(() => (io.sha256Of ?? sha256OfFile)(file));
  const copy = (source: string, target: string): Promise<void> => outside(() => (io.copyFile ?? copyFile)(source, target));
  const wanted = tenantDbFile(tenant.id);
  if (tenant.dbFile === wanted) {
    refuseServedTenantWithoutBooks(tenant, path.join(dataDir, wanted));
    await dropStaleCopy(tenants, dataDir, tenant, sha256Of);
    return tenant;
  }
  const from = path.join(dataDir, tenant.dbFile);
  const to = path.join(dataDir, wanted);
  const cacheKey = `${dataDir}\n${tenant.id}`;

  if (existsSync(from)) {
    refuseServedTenantWithoutBooks(tenant, from);
    const sharers = await othersNaming(tenants, tenant, tenant.dbFile);
    if (sharers.length > 0) throw new TenantDbFileSharedError(tenant.id, tenant.dbFile, sharers);
    const known = knownConflicts.get(cacheKey);
    if (known && known.stamp === stampOf([from, to])) throw known.error;
    knownConflicts.delete(cacheKey);

    let held;
    try {
      held = holdSqliteFile(from, { waitMs: io.waitMs });
    } catch (err) {
      if (err instanceof SqliteFileBusyError) throw new TenantDbFileBusyError(tenant.id, tenant.dbFile);
      throw err;
    }
    try {
      const conflict = (file: string): TenantDbFileConflictError => {
        const error = new TenantDbFileConflictError(tenant.id, file);
        knownConflicts.set(cacheKey, { stamp: stampOf([from, to]), error });
        return error;
      };
      for (const suffix of SQLITE_SIBLING_SUFFIXES) if (existsSync(`${to}${suffix}`)) throw conflict(`${to}${suffix}`);
      const source = await sha256Of(from);
      if (existsSync(to)) {
        if ((await sha256Of(to)) !== source) throw conflict(to);
      } else {
        await outside(async () => void (await mkdir(path.dirname(to), { recursive: true })));
        const staged = `${to}.adopting`;
        await copy(from, staged);
        if ((await sha256Of(staged)) !== source) {
          rmSync(staged, { force: true });
          throw new Error(`the copy of "${from}" did not match its source`);
        }
        renameSync(staged, to);
      }
      await repoint(tenants, tenant, wanted);
    } finally {
      held.release();
    }
    for (const suffix of SQLITE_FILE_SUFFIXES) rmSync(`${from}${suffix}`, { force: true });
    return { ...tenant, dbFile: wanted };
  }

  refuseServedTenantWithoutBooks(tenant, to);
  await repoint(tenants, tenant, wanted);
  return { ...tenant, dbFile: wanted };
}

async function repoint(tenants: Tenants, tenant: Tenant, wanted: string): Promise<void> {
  if (await tenants.setDbFile(tenant.id, tenant.dbFile, wanted)) return;
  const latest = await tenants.findById(tenant.id);
  if (latest?.dbFile !== wanted) throw new Error(`the database file of tenant "${tenant.id}" changed while it was being renamed`);
}
