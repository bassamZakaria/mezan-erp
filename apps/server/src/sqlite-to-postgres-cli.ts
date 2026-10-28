import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MigrationCommand, migrationEnvFrom, reportJson, runMigration } from "./sqlite-to-postgres.js";

export enum MigrationExit {
  Done = 0,
  Failed = 1,
  Usage = 64,
}

const USAGE = `usage: node apps/server/dist/sqlite-to-postgres-cli.js check --data <data dir> [--report <file>]
       node apps/server/dist/sqlite-to-postgres-cli.js migrate --data <data dir> [--report <file>]

check   works on scratch copies only: proves which audit chain key verifies each book, brings the copies to this
        build's shape, and refuses values Postgres would not take, broken foreign keys and tables with no twin.
migrate does the same, then copies every served company and the platform into empty Postgres schemas, compares
        row counts, row hashes and posted debit/credit per account, and appends MIGRATED_FROM_SQLITE to each audit
        chain. Any difference drops every schema it created. Refuses when Postgres already holds books.

Both read the books through SQLite's backup API and refuse a book a running app holds locked: stop the app, or
point --data at a copy made while it was stopped. The JSON report goes to stdout (and to --report <file> when
given); progress and the verdict go to stderr. Scratch copies go under $TMPDIR.

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
  const report = await runMigration(command, path.resolve(dataDir), migrationEnvFrom(env), (line) => console.error(`${command}: ${line}`));
  const json = reportJson(report);
  console.log(json);
  const reportFile = argOf(args, "--report");
  if (reportFile) writeFileSync(reportFile, `${json}\n`, { mode: 0o600 });
  for (const failure of report.cleanupFailures ?? []) console.error(`${command}: CLEANUP FAILED: ${failure}`);
  console.error(report.ok ? `${command}: OK (${report.books.length} books)` : `${command}: FAILED: ${report.error}`);
  return report.ok ? MigrationExit.Done : MigrationExit.Failed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
