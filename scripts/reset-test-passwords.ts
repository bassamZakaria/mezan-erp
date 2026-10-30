import { TenantStatusCode, tenantSchema } from "@mezan/domain";
import { createScryptHasher } from "@mezan/persistence";
import { PLATFORM_SCHEMA, TenantDatabases } from "@mezan/persistence-postgres";
import { SEED_ADMIN_PASSWORD } from "../packages/backend/src/seed.js";

const CONFIRM_FLAG = "--i-know-these-are-test-tenants";
const ONLY_FLAG = "--only=";
const ACTIVE_STATUS = "active";

interface TenantRow {
  readonly id: string;
  readonly code: string;
  readonly status: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes(CONFIRM_FLAG)) {
    console.error(`Refusing to run: this sets EVERY active user's password to the shared test password in every tenant it reaches.\nPass ${CONFIRM_FLAG} only against staging/test tenants. Optional: ${ONLY_FLAG}code1,code2 limits it to those tenant codes.`);
    process.exit(2);
  }
  const url = process.env["MEZAN_DATABASE_URL"];
  const secret = process.env["MEZAN_TENANT_DB_SECRET"];
  if (!url || !secret) {
    console.error("Set MEZAN_DATABASE_URL and MEZAN_TENANT_DB_SECRET (the same values the server runs with). Only Postgres-backed installs are supported.");
    process.exit(2);
  }
  const only = args.find((arg) => arg.startsWith(ONLY_FLAG))?.slice(ONLY_FLAG.length).split(",").filter(Boolean);

  const databases = new TenantDatabases({ connectionString: url, secret });
  try {
    const tenants = await databases.get(PLATFORM_SCHEMA).db.all<TenantRow>(`SELECT id, code, status FROM tenant ORDER BY code`);
    const targets = tenants.filter(
      (tenant) => tenant.status !== TenantStatusCode.Archived && tenant.status !== TenantStatusCode.Provisioning && (!only || only.includes(tenant.code)),
    );
    const unknown = (only ?? []).filter((code) => !tenants.some((tenant) => tenant.code === code));
    if (unknown.length > 0) throw new Error(`no such tenant code: ${unknown.join(", ")}`);

    const hasher = createScryptHasher();
    for (const tenant of targets) {
      const { db } = databases.get(tenantSchema(tenant.id));
      const hash = await hasher.hash(SEED_ADMIN_PASSWORD);
      const { changes } = await db.run(`UPDATE "user" SET password_hash = ?, must_change_password = 0 WHERE status = ?`, [hash, ACTIVE_STATUS]);
      console.log(`${tenant.code}: ${changes} active user(s) now sign in with the test password`);
    }
    console.log(`${targets.length} tenant(s) updated. Existing sessions stay valid; the password is the repo's SEED_ADMIN_PASSWORD.`);
  } finally {
    await databases.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
