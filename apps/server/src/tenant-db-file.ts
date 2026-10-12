import { createHash } from "node:crypto";
import { createReadStream, existsSync, renameSync, rmSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { tenantDbFile, type Tenant, type TenantRepository } from "@mezan/domain";

const SQLITE_FILE_SUFFIXES = ["", "-wal", "-shm"] as const;

export class TenantDbFileConflictError extends Error {
  readonly code = "TENANT_DB_FILE_CONFLICT";

  constructor(readonly tenantId: string, readonly file: string) {
    super(`tenant "${tenantId}" has two different database files; "${file}" was left untouched`);
    this.name = "TenantDbFileConflictError";
  }
}

function sha256Of(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function copyVerified(from: string, to: string, tenantId: string): Promise<void> {
  const wanted = await sha256Of(from);
  if (existsSync(to)) {
    if ((await sha256Of(to)) !== wanted) throw new TenantDbFileConflictError(tenantId, to);
    return;
  }
  const staged = `${to}.adopting`;
  await copyFile(from, staged);
  if ((await sha256Of(staged)) !== wanted) {
    rmSync(staged, { force: true });
    throw new Error(`the copy of "${from}" did not match its source`);
  }
  renameSync(staged, to);
}

// REQUIRED ORDERING: copy and verify, then point the platform row at the copy,
// and only then remove the old file. The platform row is the source of truth:
// a crash at any step leaves a file the row names, complete.
export async function settleTenantDbFile(tenants: Pick<TenantRepository, "setDbFile" | "findById">, dataDir: string, tenant: Tenant): Promise<Tenant> {
  const wanted = tenantDbFile(tenant.id);
  if (tenant.dbFile === wanted) return tenant;
  const from = path.join(dataDir, tenant.dbFile);
  const to = path.join(dataDir, wanted);

  if (existsSync(from)) {
    await mkdir(path.dirname(to), { recursive: true });
    for (const suffix of SQLITE_FILE_SUFFIXES) {
      if (existsSync(`${from}${suffix}`)) await copyVerified(`${from}${suffix}`, `${to}${suffix}`, tenant.id);
      else if (existsSync(`${to}${suffix}`)) throw new TenantDbFileConflictError(tenant.id, `${to}${suffix}`);
    }
  }

  if (!(await tenants.setDbFile(tenant.id, tenant.dbFile, wanted))) {
    const latest = await tenants.findById(tenant.id);
    if (latest?.dbFile !== wanted) throw new Error(`the database file of tenant "${tenant.id}" changed while it was being renamed`);
  }
  for (const suffix of SQLITE_FILE_SUFFIXES) rmSync(`${from}${suffix}`, { force: true });
  return { ...tenant, dbFile: wanted };
}
