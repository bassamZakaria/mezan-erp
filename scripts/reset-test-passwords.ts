import { TenantStatusCode, UserStatusCode, tenantSchema } from "@mezan/domain";
import { createScryptHasher } from "@mezan/persistence";
import { PLATFORM_SCHEMA, TenantDatabases } from "@mezan/persistence-postgres";
import { SEED_ADMIN_PASSWORD } from "../packages/backend/src/seed.js";

const CONFIRM_FLAG = "--i-know-these-are-test-tenants";
const ONLY_FLAG = "--only=";
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

interface TenantRow {
  readonly id: string;
  readonly code: string;
  readonly status: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes(CONFIRM_FLAG)) {
    console.error(`Refusing to run: this sets EVERY active user's password to the shared test password in every tenant it reaches.\nPass ${CONFIRM_FLAG} only against staging/test tenants. Also required: ${ONLY_FLAG}code1,code2 naming the tenants.`);
    process.exit(2);
  }
  const url = process.env["MEZAN_DATABASE_URL"];
  const secret = process.env["MEZAN_TENANT_DB_SECRET"];
  if (!url || !secret) {
    console.error("Set MEZAN_DATABASE_URL and MEZAN_TENANT_DB_SECRET (the same values the server runs with). Only Postgres-backed installs are supported.");
    process.exit(2);
  }
  const only = (args.find((arg) => arg.startsWith(ONLY_FLAG))?.slice(ONLY_FLAG.length) ?? "").split(",").filter(Boolean);
  if (only.length === 0) {
    console.error(`${ONLY_FLAG}code1,code2 is required: there is no all-tenants mode.`);
    process.exit(2);
  }
  if (!LOOPBACK_HOSTS.has(new URL(url).hostname)) {
    console.error("Refusing: MEZAN_DATABASE_URL must point at localhost (an SSH tunnel to the staging Postgres), never straight at a remote host.");
    process.exit(2);
  }

  const databases = new TenantDatabases({ connectionString: url, secret });
  try {
    const tenants = await databases.get(PLATFORM_SCHEMA).db.all<TenantRow>(`SELECT id, code, status FROM tenant ORDER BY code`);
    const targets = tenants.filter(
      (tenant) => tenant.status !== TenantStatusCode.Archived && tenant.status !== TenantStatusCode.Provisioning && only.includes(tenant.code),
    );
    const unknown = only.filter((code) => !tenants.some((tenant) => tenant.code === code));
    if (unknown.length > 0) throw new Error(`no such tenant code: ${unknown.join(", ")}`);
    const skipped = only.filter((code) => !targets.some((tenant) => tenant.code === code));
    if (skipped.length > 0) throw new Error(`archived or still provisioning, nothing changed: ${skipped.join(", ")}`);

    const hasher = createScryptHasher();
    for (const tenant of targets) {
      const { db } = databases.get(tenantSchema(tenant.id));
      const hash = await hasher.hash(SEED_ADMIN_PASSWORD);
      const { changes, revoked } = await db.transaction(async () => {
        const updated = await db.run(`UPDATE "user" SET password_hash = ?, must_change_password = 0 WHERE status = ?`, [hash, UserStatusCode.Active]);
        const deleted = await db.run(`DELETE FROM auth_session WHERE user_id IN (SELECT id FROM "user" WHERE status = ?)`, [UserStatusCode.Active]);
        return { changes: updated.changes, revoked: deleted.changes };
      });
      console.log(`${tenant.code}: ${changes} active user(s) now sign in with the test password; ${revoked} session(s) revoked`);
    }
    console.log(`${targets.length} tenant(s) updated. Sessions of those users were revoked; the password is the repo's SEED_ADMIN_PASSWORD.`);
  } finally {
    await databases.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
