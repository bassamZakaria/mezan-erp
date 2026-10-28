import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import pg from "pg";
import { AuditSeverityCode, AuditStreamName, DocumentStatusCode, TenantStatusCode, tenantSchema, type AuditEvent } from "@mezan/domain";
import { createBackend, createPlatform, ensurePlatformTables } from "@mezan/backend";
import { backupSqliteFile, createAuditSink, ensureTenantSchema, openAuditChainFile, openSqliteConnection, SqlDialect, sqliteDb, type AuditChainVerification, type SqlDb } from "@mezan/persistence";
import { assertCollation, dropTenantSchema, PLATFORM_SCHEMA, schemaKey, SchemaKeyPurpose, TenantDatabases } from "@mezan/persistence-postgres";
import { SECRETS_KEY_FILE, loadSecretBox } from "./secrets-key.js";

export enum MigrationCommand {
  Check = "check",
  Migrate = "migrate",
}

export enum ChainKeySource {
  Env = "env",
  File = "file",
  EmptyChain = "empty-chain",
}

export enum BookKind {
  Platform = "platform",
  Tenant = "tenant",
}

enum ColumnKind {
  Integer = "integer",
  Real = "real",
  Text = "text",
  Blob = "blob",
  Other = "other",
}

enum SqliteType {
  Integer = "integer",
  Real = "real",
  Text = "text",
  Blob = "blob",
  Null = "null",
}

const ACCEPTED_TYPES: Record<ColumnKind, readonly SqliteType[]> = {
  [ColumnKind.Integer]: [SqliteType.Integer, SqliteType.Null],
  [ColumnKind.Real]: [SqliteType.Real, SqliteType.Integer, SqliteType.Null],
  [ColumnKind.Text]: [SqliteType.Text, SqliteType.Null],
  [ColumnKind.Blob]: [SqliteType.Blob, SqliteType.Null],
  [ColumnKind.Other]: [SqliteType.Null],
};

enum SqliteLockCode {
  Busy = "SQLITE_BUSY",
  Locked = "SQLITE_LOCKED",
}

export enum LegacySeparatorColumn {
  IdempotentRequestScope = "idempotent_request.scope",
  SignInAttemptKey = "sign_in_attempt.attempt_key",
}

const LEGACY_SEPARATOR = "\u0000";
const KEY_SEPARATOR = "\u001F";
const LEGACY_SEPARATOR_COLUMNS = new Set<string>(Object.values(LegacySeparatorColumn));

// Tables a SQLite book holds that have no Postgres twin by design.
const SQLITE_ONLY_TABLES: Record<BookKind, readonly string[]> = {
  [BookKind.Platform]: ["schema_meta"],
  [BookKind.Tenant]: ["tenant_binding", "schema_meta"],
};

const LEDGER_STATUSES = [DocumentStatusCode.Posted, DocumentStatusCode.Reversed];
const CHAIN_KEY_FILE = "audit-chain.key";
const KEY_HEX = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PARAMS_PER_INSERT = 30_000;
export const MIGRATED_FROM_SQLITE = "MIGRATED_FROM_SQLITE";

export class MigrationRefusedError extends Error {}

interface ColumnShape {
  readonly name: string;
  readonly kind: ColumnKind;
  readonly identity: boolean;
  readonly primaryKey: boolean;
}

interface TableShape {
  readonly name: string;
  readonly columns: ReadonlyMap<string, ColumnShape>;
}

type Shape = ReadonlyMap<string, TableShape>;

export interface MigrationEnv {
  readonly databaseUrl?: string;
  readonly ownerUrl?: string;
  readonly tenantDbSecret?: string;
  readonly auditChainKey?: string;
  readonly secretsKey?: string;
}

export function migrationEnvFrom(env: Record<string, string | undefined>): MigrationEnv {
  const pick = (name: string) => env[name]?.trim() || undefined;
  return {
    databaseUrl: pick("MEZAN_DATABASE_URL"),
    ownerUrl: pick("MEZAN_MIGRATE_OWNER_URL"),
    tenantDbSecret: pick("MEZAN_TENANT_DB_SECRET"),
    auditChainKey: pick("MEZAN_AUDIT_CHAIN_KEY"),
    secretsKey: pick("MEZAN_SECRETS_KEY"),
  };
}

export interface TableReport {
  readonly table: string;
  readonly sourceRows: number;
  readonly sourceHash: string;
  targetRows?: number;
  targetHash?: string;
  match?: boolean;
}

export interface AccountTotals {
  readonly accounts: number;
  readonly totalDebit: string;
  readonly totalCredit: string;
  mismatches?: string[];
}

export interface BookReport {
  readonly kind: BookKind;
  readonly schema: string;
  readonly label: string;
  readonly sourceFile: string;
  readonly sourceSha256: string;
  readonly chainKeySource: ChainKeySource;
  readonly sourceChain: AuditChainVerification & { readonly headRowId: number | null; readonly headHash: string | null };
  readonly tables: TableReport[];
  readonly droppedColumns: string[];
  readonly translatedSeparators: Partial<Record<LegacySeparatorColumn, number>>;
  targetOnlyTables?: string[];
  readonly accounts: AccountTotals | null;
  targetAudit?: AuditChainVerification;
  problems: string[];
}

export interface MigrationReport {
  readonly command: MigrationCommand;
  readonly dataDir: string;
  readonly startedAt: string;
  finishedAt?: string;
  ok: boolean;
  readonly books: BookReport[];
  readonly skippedTenants: { id: string; code: string; status: string }[];
  error?: string;
  cleanupFailures?: string[];
}

interface PreparedBook {
  readonly kind: BookKind;
  readonly schema: string;
  readonly label: string;
  readonly copy: string;
  readonly report: BookReport;
}

function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new MigrationRefusedError(`"${name}" is not a plain identifier`);
  return `"${name}"`;
}

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function kindOfDeclared(declared: string): ColumnKind {
  const type = declared.toUpperCase();
  if (type.includes("INT")) return ColumnKind.Integer;
  if (type.includes("CHAR") || type.includes("CLOB") || type.includes("TEXT")) return ColumnKind.Text;
  if (type.includes("BLOB")) return ColumnKind.Blob;
  if (type.includes("REAL") || type.includes("FLOA") || type.includes("DOUB")) return ColumnKind.Real;
  return ColumnKind.Other;
}

function kindOfPostgres(dataType: string): ColumnKind {
  switch (dataType) {
    case "bigint":
      return ColumnKind.Integer;
    case "double precision":
      return ColumnKind.Real;
    case "text":
      return ColumnKind.Text;
    case "bytea":
      return ColumnKind.Blob;
    default:
      return ColumnKind.Other;
  }
}

function sqliteTables(sqlite: Database.Database): string[] {
  return (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
}

function sqliteShape(sqlite: Database.Database): Shape {
  const shape = new Map<string, TableShape>();
  for (const table of sqliteTables(sqlite)) {
    const info = sqlite.prepare(`PRAGMA table_info(${ident(table)})`).all() as { name: string; type: string; pk: number }[];
    const singlePk = info.filter((column) => column.pk > 0).length === 1;
    const columns = new Map<string, ColumnShape>();
    for (const column of info) {
      const kind = kindOfDeclared(column.type);
      columns.set(column.name.toLowerCase(), { name: column.name, kind, identity: singlePk && column.pk === 1 && kind === ColumnKind.Integer, primaryKey: column.pk > 0 });
    }
    shape.set(table.toLowerCase(), { name: table, columns });
  }
  return shape;
}

async function templateShape(kind: BookKind): Promise<Shape> {
  const sqlite = openSqliteConnection(":memory:").sqlite;
  try {
    const db = sqliteDb(sqlite);
    if (kind === BookKind.Platform) await ensurePlatformTables(db);
    else await ensureTenantSchema(db);
    return sqliteShape(sqlite);
  } finally {
    sqlite.close();
  }
}

async function postgresShape(owner: pg.Pool, schema: string): Promise<Shape> {
  const { rows } = await owner.query<{ table_name: string; column_name: string; data_type: string; is_identity: string }>(
    "SELECT table_name, column_name, data_type, is_identity FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, ordinal_position",
    [schema],
  );
  const shape = new Map<string, { name: string; columns: Map<string, ColumnShape> }>();
  for (const row of rows) {
    let table = shape.get(row.table_name);
    if (!table) shape.set(row.table_name, (table = { name: row.table_name, columns: new Map() }));
    table.columns.set(row.column_name, { name: row.column_name, kind: kindOfPostgres(row.data_type), identity: row.is_identity === "YES", primaryKey: false });
  }
  return shape;
}

interface PairedColumn {
  readonly source: string;
  readonly target: ColumnShape;
  readonly primaryKey: boolean;
  readonly legacySeparator: LegacySeparatorColumn | null;
}

interface TablePair {
  readonly source: string;
  readonly target: TableShape;
  readonly rowid: boolean;
  readonly columns: readonly PairedColumn[];
}

function legacySeparatorOf(table: string, column: string): LegacySeparatorColumn | null {
  const name = `${table}.${column}`.toLowerCase();
  return LEGACY_SEPARATOR_COLUMNS.has(name) ? (name as LegacySeparatorColumn) : null;
}

function hasRowid(sqlite: Database.Database, table: string): boolean {
  const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string | null } | undefined;
  return !/WITHOUT\s+ROWID/i.test(row?.sql ?? "");
}

function pairTables(sqlite: Database.Database, kind: BookKind, target: Shape, report: BookReport): TablePair[] {
  const pairs: TablePair[] = [];
  const missing: string[] = [];
  const source = sqliteShape(sqlite);
  for (const table of source.values()) {
    if (SQLITE_ONLY_TABLES[kind].includes(table.name)) continue;
    const twin = target.get(table.name.toLowerCase());
    if (!twin) {
      missing.push(table.name);
      continue;
    }
    const columns: PairedColumn[] = [];
    for (const column of table.columns.values()) {
      const targetColumn = twin.columns.get(column.name.toLowerCase());
      if (targetColumn) columns.push({ source: column.name, target: targetColumn, primaryKey: column.primaryKey, legacySeparator: legacySeparatorOf(table.name, column.name) });
      else {
        const held = (sqlite.prepare(`SELECT count(*) AS n FROM ${ident(table.name)} WHERE ${ident(column.name)} IS NOT NULL`).get() as { n: number }).n;
        if (held > 0) report.problems.push(`${table.name}.${column.name} has no Postgres column and holds ${held} non-null values`);
        else report.droppedColumns.push(`${table.name}.${column.name}`);
      }
    }
    pairs.push({ source: table.name, target: twin, rowid: hasRowid(sqlite, table.name), columns });
  }
  if (missing.length > 0) report.problems.push(`tables with no Postgres twin: ${missing.join(", ")}`);
  return pairs;
}

function preCheck(sqlite: Database.Database, pairs: readonly TablePair[], report: BookReport): void {
  const quick = sqlite.prepare("PRAGMA quick_check").pluck().all() as string[];
  if (quick.length !== 1 || quick[0] !== "ok") report.problems.push(`quick_check: ${quick.slice(0, 5).join("; ")}`);
  const orphans = sqlite.prepare("PRAGMA foreign_key_check").all() as { table: string; rowid: number; parent: string }[];
  if (orphans.length > 0) {
    report.problems.push(`${orphans.length} rows break a foreign key, e.g. ${orphans.slice(0, 5).map((o) => `${o.table} rowid ${o.rowid} -> ${o.parent}`).join(", ")}`);
  }
  for (const pair of pairs) {
    for (const { source, target, legacySeparator } of pair.columns) {
      const accepted = ACCEPTED_TYPES[target.kind];
      const list = accepted.map((type) => `'${type}'`).join(", ");
      const wrong = (sqlite.prepare(`SELECT count(*) AS n FROM ${ident(pair.source)} WHERE typeof(${ident(source)}) NOT IN (${list})`).get() as { n: number }).n;
      if (wrong > 0) report.problems.push(`${pair.source}.${source}: ${wrong} values are not ${target.kind}`);
      if (target.kind !== ColumnKind.Text) continue;
      const nul = (sqlite.prepare(`SELECT count(*) AS n FROM ${ident(pair.source)} WHERE instr(${ident(source)}, char(0)) > 0 OR ${ident(source)} LIKE '%\\u0000%'`).get() as { n: number }).n;
      if (nul === 0) continue;
      if (legacySeparator) report.translatedSeparators[legacySeparator] = nul;
      else report.problems.push(`${pair.source}.${source}: ${nul} values hold a NUL character`);
    }
    if (!pair.columns.some((column) => column.legacySeparator)) continue;
    const keys = pair.columns.filter((column) => column.primaryKey);
    if (keys.length === 0) continue;
    const seen = new Set<string>();
    let clashes = 0;
    const select = sqlite.prepare(`SELECT ${keys.map((column) => ident(column.source)).join(", ")} FROM ${ident(pair.source)}`).safeIntegers(true).raw(true);
    for (const row of select.iterate() as IterableIterator<unknown[]>) {
      const key = JSON.stringify(row.map((value, at) => `${typeof value}:${String(translated(value, keys[at]!))}`));
      if (seen.has(key)) clashes += 1;
      else seen.add(key);
    }
    if (clashes > 0) report.problems.push(`${pair.source}: ${clashes} rows collide with another key once the legacy NUL separator becomes U+001F; remove the stale rows first`);
  }
}

function translated(value: unknown, column: { readonly legacySeparator: LegacySeparatorColumn | null }): unknown {
  return column.legacySeparator && typeof value === "string" ? value.replaceAll(LEGACY_SEPARATOR, KEY_SEPARATOR) : value;
}

function normalized(value: unknown, kind: ColumnKind): unknown {
  if (value === null || value === undefined) return null;
  switch (kind) {
    case ColumnKind.Integer:
      return `i${String(value)}`;
    case ColumnKind.Real:
      return Number(value);
    case ColumnKind.Blob:
      return `b${Buffer.from(value as Uint8Array).toString("hex")}`;
    default:
      return `s${String(value)}`;
  }
}

interface DigestColumn {
  readonly name: string;
  readonly kind: ColumnKind;
  readonly legacySeparator: LegacySeparatorColumn | null;
}

async function tableDigest(db: SqlDb, table: string, columns: readonly DigestColumn[]): Promise<{ rows: number; hash: string }> {
  const rows = await db.all<Record<string, unknown>>(`SELECT ${columns.map((c) => ident(c.name)).join(", ")} FROM ${ident(table)}`);
  const rowHashes = rows
    .map((row) => createHash("sha256").update(JSON.stringify(columns.map((c) => normalized(translated(row[c.name], c), c.kind)))).digest("hex"))
    .sort();
  return { rows: rows.length, hash: createHash("sha256").update(rowHashes.join("\n")).digest("hex") };
}

async function accountTotals(db: SqlDb): Promise<Map<string, { debit: bigint; credit: bigint }> | null> {
  const present = (await tableNames(db)).filter((name) => name === "journal_entry" || name === "journal_line");
  if (present.length < 2) return null;
  const rows = await db.all<{ account_id: string; debit: bigint | null; credit: bigint | null }>(
    "SELECT jl.account_id AS account_id, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id WHERE je.status IN (?, ?) GROUP BY jl.account_id",
    LEDGER_STATUSES,
  );
  return new Map(rows.map((row) => [row.account_id, { debit: BigInt(row.debit ?? 0n), credit: BigInt(row.credit ?? 0n) }]));
}

async function tableNames(db: SqlDb): Promise<string[]> {
  const sql = db.dialect === SqlDialect.Sqlite ? "SELECT name FROM sqlite_master WHERE type = 'table'" : "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()";
  return (await db.all<{ name: string }>(sql)).map((row) => row.name);
}

function totalsOf(map: Map<string, { debit: bigint; credit: bigint }>): AccountTotals {
  let debit = 0n;
  let credit = 0n;
  for (const sums of map.values()) {
    debit += sums.debit;
    credit += sums.credit;
  }
  return { accounts: map.size, totalDebit: debit.toString(), totalCredit: credit.toString() };
}

async function copyBook(original: string, scratchFile: string): Promise<void> {
  mkdirSync(path.dirname(scratchFile), { recursive: true });
  try {
    await backupSqliteFile(original, scratchFile);
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code.startsWith(SqliteLockCode.Busy) || code.startsWith(SqliteLockCode.Locked)) {
      throw new MigrationRefusedError(`${original} is locked by a running app: stop it, or point --data at a copy made while it was stopped`);
    }
    throw error;
  }
}

function chainKeyCandidates(original: string, env: MigrationEnv): { source: ChainKeySource; material: string }[] {
  const candidates: { source: ChainKeySource; material: string }[] = [];
  if (env.auditChainKey) candidates.push({ source: ChainKeySource.Env, material: env.auditChainKey });
  const keyFile = path.join(path.dirname(original), CHAIN_KEY_FILE);
  if (existsSync(keyFile)) {
    const material = readFileSync(keyFile, "utf8").trim();
    if (KEY_HEX.test(material)) candidates.push({ source: ChainKeySource.File, material });
  }
  return candidates;
}

async function verifyChain(copy: string, material: string): Promise<{ verification: AuditChainVerification; head: { rowId: number; rowHash: string } | null }> {
  const reader = openAuditChainFile(copy, { chainKey: material });
  try {
    return { verification: await reader.verify(), head: reader.head() };
  } finally {
    reader.close();
  }
}

// The old chain key is proven, never assumed: the first candidate whose head MAC verifies the copy's chain.
async function proveChainKey(original: string, copy: string, env: MigrationEnv): Promise<{ source: ChainKeySource; material: string }> {
  const candidates = chainKeyCandidates(original, env);
  for (const candidate of candidates) {
    const { verification, head } = await verifyChain(copy, candidate.material);
    if (head === null && verification.checked === 0 && verification.ok) return { source: ChainKeySource.EmptyChain, material: candidate.material };
    if (verification.ok) return candidate;
  }
  const probeKey = candidates[0]?.material ?? randomBytes(32).toString("hex");
  const probe = await verifyChain(copy, probeKey);
  if (probe.head === null && probe.verification.checked === 0 && probe.verification.unchained === 0) return { source: ChainKeySource.EmptyChain, material: probeKey };
  throw new MigrationRefusedError(
    `${path.basename(original)}: no audit chain key verifies its chain (tried ${candidates.map((c) => c.source).join(", ") || "none: set MEZAN_AUDIT_CHAIN_KEY or keep audit-chain.key beside it"})`,
  );
}

async function withChainKey<T>(material: string, work: () => Promise<T>): Promise<T> {
  const before = process.env["MEZAN_AUDIT_CHAIN_KEY"];
  process.env["MEZAN_AUDIT_CHAIN_KEY"] = material;
  try {
    return await work();
  } finally {
    if (before === undefined) delete process.env["MEZAN_AUDIT_CHAIN_KEY"];
    else process.env["MEZAN_AUDIT_CHAIN_KEY"] = before;
  }
}

interface PrepareInput {
  readonly kind: BookKind;
  readonly schema: string;
  readonly label: string;
  readonly original: string;
  readonly copy: string;
  readonly env: MigrationEnv;
  readonly upgrade: () => Promise<void>;
}

async function prepareBook(input: PrepareInput): Promise<PreparedBook> {
  await copyBook(input.original, input.copy);
  const sourceSha256 = sha256File(input.copy);
  const key = await proveChainKey(input.original, input.copy, input.env);
  // REQUIRED ORDERING: the copy is brought to this build's shape under the proven old key, so an upgrade step that appends to the chain keeps it verifiable.
  await withChainKey(key.material, input.upgrade);
  const after = await verifyChain(input.copy, key.material);
  const report: BookReport = {
    kind: input.kind,
    schema: input.schema,
    label: input.label,
    sourceFile: input.original,
    sourceSha256,
    chainKeySource: key.source,
    sourceChain: { ...after.verification, headRowId: after.head?.rowId ?? null, headHash: after.head?.rowHash ?? null },
    tables: [],
    droppedColumns: [],
    translatedSeparators: {},
    accounts: null,
    problems: [],
  };
  if (!after.verification.ok) report.problems.push(`the source audit chain does not verify after the upgrade: ${after.verification.reason}`);
  const sqlite = openSqliteConnection(input.copy, { fileMustExist: true }).sqlite;
  try {
    const pairs = pairTables(sqlite, input.kind, await templateShape(input.kind), report);
    preCheck(sqlite, pairs, report);
    const db = sqliteDb(sqlite);
    for (const pair of pairs) {
      const digest = await tableDigest(db, pair.source, pair.columns.map((c) => ({ name: c.source, kind: c.target.kind, legacySeparator: c.legacySeparator })));
      report.tables.push({ table: pair.source, sourceRows: digest.rows, sourceHash: digest.hash });
    }
    const totals = await accountTotals(db);
    return { kind: input.kind, schema: input.schema, label: input.label, copy: input.copy, report: { ...report, accounts: totals ? totalsOf(totals) : null } };
  } finally {
    sqlite.close();
  }
}

interface ServedTenant {
  readonly id: string;
  readonly code: string;
  readonly dbFile: string;
}

function tenantsOf(platformCopy: string, report: MigrationReport): ServedTenant[] {
  const sqlite = openSqliteConnection(platformCopy, { fileMustExist: true }).sqlite;
  try {
    const rows = sqlite.prepare("SELECT id, code, status, db_file FROM tenant ORDER BY id").all() as { id: string; code: string; status: string; db_file: string }[];
    const provisioning = rows.filter((row) => row.status === TenantStatusCode.Provisioning);
    if (provisioning.length > 0) {
      throw new MigrationRefusedError(
        `companies still provisioning: ${provisioning.map((row) => `"${row.code}" (${row.id})`).join(", ")}; let each finish or remove it before migrating`,
      );
    }
    const served: ServedTenant[] = [];
    for (const row of rows) {
      if (row.status === TenantStatusCode.Archived) report.skippedTenants.push({ id: row.id, code: row.code, status: row.status });
      else served.push({ id: row.id, code: row.code, dbFile: row.db_file });
    }
    return served;
  } finally {
    sqlite.close();
  }
}

type Progress = (line: string) => void;

async function prepareAll(dataDir: string, scratch: string, env: MigrationEnv, report: MigrationReport, progress: Progress): Promise<PreparedBook[]> {
  const platformFile = path.join(dataDir, "platform.db");
  if (!existsSync(platformFile)) throw new MigrationRefusedError(`${platformFile} does not exist`);
  const secretsFile = path.join(dataDir, SECRETS_KEY_FILE);
  if (!env.secretsKey && !existsSync(secretsFile)) {
    throw new MigrationRefusedError(`set MEZAN_SECRETS_KEY or keep ${SECRETS_KEY_FILE} in ${dataDir}: a new key would seal stored SMTP and webhook secrets with a key nobody keeps`);
  }
  if (existsSync(secretsFile)) copyFileSync(secretsFile, path.join(scratch, SECRETS_KEY_FILE));
  const secrets = loadSecretBox(env.secretsKey, scratch);
  progress(`preparing ${PLATFORM_SCHEMA}`);
  const platformCopy = path.join(scratch, "platform.db");
  const platform = await prepareBook({
    kind: BookKind.Platform,
    schema: PLATFORM_SCHEMA,
    label: PLATFORM_SCHEMA,
    original: platformFile,
    copy: platformCopy,
    env,
    upgrade: async () => (await createPlatform({ dbPath: platformCopy })).close(),
  });
  const books: PreparedBook[] = [];
  for (const tenant of tenantsOf(platformCopy, report)) {
    progress(`preparing "${tenant.code}" (${tenant.id})`);
    const original = path.join(dataDir, tenant.dbFile);
    if (!existsSync(original)) throw new MigrationRefusedError(`company "${tenant.code}" (${tenant.id}) is served but ${original} does not exist`);
    const copy = path.join(scratch, "tenants", `${tenant.id}.db`);
    books.push(
      await prepareBook({
        kind: BookKind.Tenant,
        schema: tenantSchema(tenant.id),
        label: tenant.code,
        original,
        copy,
        env,
        upgrade: async () => {
          const backend = await createBackend({ dbPath: copy, seedWhenEmpty: false, scheduledJobs: false, tenantBinding: tenant.id, secrets });
          try {
            await backend.drain();
          } finally {
            backend.close();
          }
        },
      }),
    );
  }
  books.push(platform);
  return books;
}

async function copyRows(client: pg.PoolClient, schema: string, sqlite: Database.Database, pair: TablePair): Promise<void> {
  const target = `${ident(schema)}.${ident(pair.target.name)}`;
  await client.query(`DELETE FROM ${target}`);
  if (pair.columns.length === 0) return;
  const columns = pair.columns.map((c) => ident(c.target.name)).join(", ");
  const perBatch = Math.max(1, Math.floor(PARAMS_PER_INSERT / pair.columns.length));
  const flush = async (batch: unknown[][]) => {
    if (batch.length === 0) return;
    let n = 0;
    const values = batch.map((row) => `(${row.map(() => `$${++n}`).join(", ")})`).join(", ");
    await client.query(`INSERT INTO ${target} (${columns}) VALUES ${values}`, batch.flat());
  };
  const order = pair.rowid ? " ORDER BY rowid" : "";
  const select = sqlite.prepare(`SELECT ${pair.columns.map((c) => ident(c.source)).join(", ")} FROM ${ident(pair.source)}${order}`).safeIntegers(true).raw(true);
  let batch: unknown[][] = [];
  for (const row of select.iterate() as IterableIterator<unknown[]>) {
    batch.push(row.map((value, at) => translated(value, pair.columns[at]!)));
    if (batch.length >= perBatch) {
      await flush(batch);
      batch = [];
    }
  }
  await flush(batch);
}

async function advanceIdentities(client: pg.PoolClient, schema: string, sqlite: Database.Database, pairs: readonly TablePair[]): Promise<void> {
  const hasSequence = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").get() !== undefined;
  const seqOf = (table: string): bigint => {
    if (!hasSequence) return 0n;
    const row = sqlite.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").safeIntegers(true).get(table) as { seq: bigint } | undefined;
    return row?.seq ?? 0n;
  };
  for (const pair of pairs) {
    for (const column of pair.target.columns.values()) {
      if (!column.identity) continue;
      const qualified = `${ident(schema)}.${ident(pair.target.name)}`;
      const { rows } = await client.query<{ max: string | null }>(`SELECT max(${ident(column.name)})::text AS max FROM ${qualified}`);
      const max = BigInt(rows[0]?.max ?? "0");
      const next = max > seqOf(pair.source) ? max : seqOf(pair.source);
      const sequence = `pg_get_serial_sequence('${schema}.${pair.target.name}', '${column.name}')`;
      if (next > 0n) await client.query(`SELECT setval(${sequence}, $1::bigint, true)`, [next.toString()]);
      else await client.query(`SELECT setval(${sequence}, 1, false)`);
    }
  }
}

interface PostgresContext {
  readonly owner: pg.Pool;
  readonly appAdmin: pg.Pool;
  readonly databases: TenantDatabases;
  readonly masterKey: string;
  readonly created: string[];
}

async function migrateBook(book: PreparedBook, ctx: PostgresContext): Promise<void> {
  const { report, schema } = book;
  const { rows: present } = await ctx.owner.query("SELECT 1 FROM pg_namespace WHERE nspname = $1", [schema]);
  if (present.length > 0) throw new MigrationRefusedError(`${schema} appeared in Postgres during the migration; something else is writing books`);
  ctx.created.push(schema);
  await ctx.databases.provision(schema);
  const target = ctx.databases.get(schema).db;
  if (book.kind === BookKind.Platform) await ensurePlatformTables(target);
  else await ensureTenantSchema(target);
  const pgShape = await postgresShape(ctx.owner, schema);
  const sqlite = openSqliteConnection(book.copy, { fileMustExist: true }).sqlite;
  try {
    const checked: BookReport = { ...report, tables: [], droppedColumns: [], translatedSeparators: {}, problems: [] };
    const pairs = pairTables(sqlite, book.kind, pgShape, checked);
    preCheck(sqlite, pairs, checked);
    report.droppedColumns.length = 0;
    report.droppedColumns.push(...checked.droppedColumns);
    if (checked.problems.length > 0) {
      report.problems.push(...checked.problems);
      throw new MigrationRefusedError(`${schema}: ${checked.problems.join("; ")}`);
    }
    const copied = new Set(pairs.map((pair) => pair.target.name));
    report.targetOnlyTables = [...pgShape.values()].map((table) => table.name).filter((name) => !copied.has(name));
    const client = await ctx.owner.connect();
    try {
      await client.query("BEGIN");
      // Integrity was proven on the source (PRAGMA foreign_key_check); replica lets rows land in any table order.
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query("SET LOCAL statement_timeout = 0");
      for (const pair of pairs) await copyRows(client, schema, sqlite, pair);
      await advanceIdentities(client, schema, sqlite, pairs);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    for (const pair of pairs) {
      const digest = await tableDigest(target, pair.target.name, pair.columns.map((c) => ({ name: c.target.name, kind: c.target.kind, legacySeparator: null })));
      const row = report.tables.find((t) => t.table === pair.source);
      if (!row) {
        report.problems.push(`${pair.source}: no source digest`);
        continue;
      }
      row.targetRows = digest.rows;
      row.targetHash = digest.hash;
      row.match = digest.rows === row.sourceRows && digest.hash === row.sourceHash;
      if (!row.match) report.problems.push(`${pair.source}: ${row.sourceRows} rows / ${row.sourceHash.slice(0, 12)} on SQLite, ${digest.rows} / ${digest.hash.slice(0, 12)} on Postgres`);
    }
    const sourceTotals = await accountTotals(sqliteDb(sqlite));
    const targetTotals = await accountTotals(target);
    if (sourceTotals && report.accounts) {
      const mismatches: string[] = [];
      for (const account of new Set([...sourceTotals.keys(), ...(targetTotals?.keys() ?? [])])) {
        const a = sourceTotals.get(account);
        const b = targetTotals?.get(account);
        if (a?.debit !== b?.debit || a?.credit !== b?.credit) mismatches.push(`${account}: ${a?.debit ?? "-"}/${a?.credit ?? "-"} vs ${b?.debit ?? "-"}/${b?.credit ?? "-"}`);
      }
      report.accounts.mismatches = mismatches;
      if (mismatches.length > 0) report.problems.push(`${mismatches.length} accounts' posted debit/credit differ`);
    }
    if (report.problems.length > 0) throw new MigrationRefusedError(`${schema}: ${report.problems.join("; ")}`);

    const sink = createAuditSink(target, { chainKey: schemaKey(ctx.masterKey, SchemaKeyPurpose.Audit, schema) });
    const event: AuditEvent = {
      stream: AuditStreamName.Security,
      module: "platform",
      entityType: "DATABASE",
      entityId: schema,
      action: MIGRATED_FROM_SQLITE,
      actor: "system",
      branchId: null,
      timestamp: new Date().toISOString(),
      severity: AuditSeverityCode.Warning,
      details: {
        sourceFile: path.basename(report.sourceFile),
        sourceSha256: report.sourceSha256,
        oldChainKey: report.chainKeySource,
        oldHeadRowId: report.sourceChain.headRowId,
        oldHeadHash: report.sourceChain.headHash,
        rowCounts: Object.fromEntries(report.tables.map((t) => [t.table, t.sourceRows])),
      },
    };
    await sink.append(event);
    report.targetAudit = await sink.verifyChain();
    if (!report.targetAudit.ok) {
      report.problems.push(`the Postgres audit chain does not verify: ${report.targetAudit.reason}`);
      throw new MigrationRefusedError(`${schema}: the Postgres audit chain does not verify (${report.targetAudit.reason})`);
    }
  } finally {
    sqlite.close();
  }
}

async function existingBookSchemas(owner: pg.Pool): Promise<string[]> {
  const { rows } = await owner.query<{ nspname: string }>("SELECT nspname FROM pg_namespace WHERE nspname = $1 OR nspname ~ '^t_[a-z0-9_]+$' ORDER BY 1", [PLATFORM_SCHEMA]);
  return rows.map((row) => row.nspname);
}

function requireEnv(env: MigrationEnv): Required<Pick<MigrationEnv, "databaseUrl" | "ownerUrl" | "tenantDbSecret" | "auditChainKey">> {
  const missing = [
    ["MEZAN_DATABASE_URL", env.databaseUrl],
    ["MEZAN_MIGRATE_OWNER_URL", env.ownerUrl],
    ["MEZAN_TENANT_DB_SECRET", env.tenantDbSecret],
    ["MEZAN_AUDIT_CHAIN_KEY", env.auditChainKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) throw new MigrationRefusedError(`set ${missing.join(", ")}`);
  if (!KEY_HEX.test(env.auditChainKey!)) throw new MigrationRefusedError("MEZAN_AUDIT_CHAIN_KEY must be 64 lower-case hex characters");
  return { databaseUrl: env.databaseUrl!, ownerUrl: env.ownerUrl!, tenantDbSecret: env.tenantDbSecret!, auditChainKey: env.auditChainKey! };
}

function manualCleanupSql(schema: string): string {
  return `DROP OWNED BY ${schema} CASCADE; SET ROLE mezan_app; REVOKE ALL ON DATABASE mezan FROM ${schema}; RESET ROLE; DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${schema};`;
}

async function dropCreated(ctx: PostgresContext, report: MigrationReport): Promise<void> {
  const failures: string[] = [];
  for (const schema of ctx.created) {
    try {
      await dropTenantSchema(ctx.appAdmin, schema);
    } catch (error) {
      failures.push(`${schema}: ${error instanceof Error ? error.message : String(error)}; drop it as the superuser with: ${manualCleanupSql(schema)}`);
    }
  }
  if (failures.length > 0) report.cleanupFailures = failures;
}

export async function runMigration(command: MigrationCommand, dataDir: string, env: MigrationEnv, progress: Progress = () => undefined): Promise<MigrationReport> {
  const report: MigrationReport = { command, dataDir, startedAt: new Date().toISOString(), ok: false, books: [], skippedTenants: [] };
  mkdirSync(tmpdir(), { recursive: true });
  const scratch = mkdtempSync(path.join(tmpdir(), "mezan-sqlite-to-pg-"));
  let pgContext: PostgresContext | null = null;
  try {
    const required = command === MigrationCommand.Migrate ? requireEnv(env) : null;
    if (required) {
      const owner = new pg.Pool({ connectionString: required.ownerUrl, max: 2 });
      pgContext = {
        owner,
        appAdmin: new pg.Pool({ connectionString: required.databaseUrl, max: 2 }),
        databases: new TenantDatabases({ connectionString: required.databaseUrl, secret: required.tenantDbSecret }),
        masterKey: required.auditChainKey,
        created: [],
      };
      const { rows } = await owner.query<{ rolsuper: boolean }>("SELECT rolsuper FROM pg_roles WHERE rolname = current_user");
      if (!rows[0]?.rolsuper) throw new MigrationRefusedError("MEZAN_MIGRATE_OWNER_URL must connect as a superuser (session_replication_role)");
      await assertCollation(owner);
      const existing = await existingBookSchemas(owner);
      if (existing.length > 0) throw new MigrationRefusedError(`Postgres already holds books (${existing.join(", ")}); the migration runs only on an empty database`);
    }
    const books = await prepareAll(dataDir, scratch, env, report, progress);
    report.books.push(...books.map((book) => book.report));
    const problems = books.flatMap((book) => book.report.problems.map((problem) => `${book.schema}: ${problem}`));
    if (problems.length > 0) throw new MigrationRefusedError(problems.join("\n"));
    if (pgContext) {
      try {
        // REQUIRED ORDERING: platform last; it is the directory of the companies the boot opens.
        for (const book of books) {
          progress(`copying "${book.label}" into ${book.schema}`);
          await migrateBook(book, pgContext);
        }
      } catch (error) {
        progress("dropping every schema this run created");
        await pgContext.databases.close().catch(() => undefined);
        await dropCreated(pgContext, report);
        throw error;
      }
    }
    report.ok = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    report.finishedAt = new Date().toISOString();
    if (pgContext) {
      await pgContext.databases.close().catch(() => undefined);
      await pgContext.appAdmin.end().catch(() => undefined);
      await pgContext.owner.end().catch(() => undefined);
    }
    rmSync(scratch, { recursive: true, force: true });
  }
  return report;
}

export function reportJson(report: MigrationReport): string {
  return JSON.stringify(report, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value), 2);
}
