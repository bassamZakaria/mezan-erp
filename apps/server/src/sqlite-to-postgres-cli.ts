import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MigrationCommand, migrationEnvFrom, reportJson, runMigration } from "./sqlite-to-postgres.js";

export enum MigrationExit {
  Done = 0,
  Failed = 1,
  Usage = 64,
}

const USAGE = `usage: node --import tsx apps/server/src/sqlite-to-postgres-cli.ts check --data <data dir> [--report <file>]
       node --import tsx apps/server/src/sqlite-to-postgres-cli.ts migrate --data <data dir> [--report <file>]

check   works on scratch copies only: proves which audit chain key verifies each book, brings the copies to this
        build's shape, and refuses values Postgres would not take, broken foreign keys and tables with no twin.
migrate does the same, then copies every served company and the platform into empty Postgres schemas, compares
        row counts, row hashes and posted debit/credit per account, and appends MIGRATED_FROM_SQLITE to each audit
        chain. Any difference drops every schema it created. Refuses when Postgres already holds books.
        Writes its report to <data dir>/sqlite-to-postgres-report.json unless --report is given.

Env: MEZAN_AUDIT_CHAIN_KEY (old and new chain key), MEZAN_SECRETS_KEY (or secrets.key in the data dir);
for migrate also MEZAN_DATABASE_URL (the app role), MEZAN_TENANT_DB_SECRET, MEZAN_MIGRATE_OWNER_URL (a superuser).
Exit: 0 done, 1 refused or failed (the report says why), 64 usage.`;

function argOf(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

export async function main(args: readonly string[], env: Record<string, string | undefined>): Promise<MigrationExit> {
  const command = Object.values(MigrationCommand).find((value) => value === args[0]);
  const dataDir = argOf(args, "--data");
  if (!command || !dataDir) {
    console.error(USAGE);
    return MigrationExit.Usage;
  }
  const report = await runMigration(command, path.resolve(dataDir), migrationEnvFrom(env));
  const json = reportJson(report);
  console.log(json);
  const reportFile = argOf(args, "--report") ?? (command === MigrationCommand.Migrate ? path.join(dataDir, "sqlite-to-postgres-report.json") : undefined);
  if (reportFile) writeFileSync(reportFile, `${json}\n`, { mode: 0o600 });
  console.error(report.ok ? `${command}: OK (${report.books.length} books)` : `${command}: FAILED: ${report.error}`);
  return report.ok ? MigrationExit.Done : MigrationExit.Failed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
