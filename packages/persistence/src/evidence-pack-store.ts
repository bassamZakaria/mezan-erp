import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import type Database from "better-sqlite3";
import { Money } from "@mezan/domain";

const CREATE_REGISTER = `
CREATE TABLE IF NOT EXISTS evidence_pack (
  id                TEXT PRIMARY KEY,
  period_from       TEXT NOT NULL,
  period_to         TEXT NOT NULL,
  built_by          TEXT NOT NULL,
  built_by_name     TEXT NOT NULL,
  built_at          TEXT NOT NULL,
  manifest_sha256   TEXT NOT NULL,
  key_id            TEXT NOT NULL,
  file_count        INTEGER NOT NULL,
  total_bytes       INTEGER NOT NULL,
  audit_chain_ok    INTEGER NOT NULL CHECK (audit_chain_ok IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_evidence_pack_built_at ON evidence_pack(built_at);
CREATE TRIGGER IF NOT EXISTS evidence_pack_no_update BEFORE UPDATE ON evidence_pack
BEGIN SELECT RAISE(ABORT, 'evidence_pack is append-only'); END;
CREATE TRIGGER IF NOT EXISTS evidence_pack_no_delete BEFORE DELETE ON evidence_pack
BEGIN SELECT RAISE(ABORT, 'evidence_pack is append-only'); END;
`;

const SEED_HEX = /^[0-9a-f]{64}$/;
const processSeeds = new WeakMap<Database.Database, string>();
const EVIDENCE_KEY_VERSION = "mezan-evidence-key-v1";
const NUMBER_COLUMNS = ["doc_no", "number", "entry_no", "count_no", "trip_no"] as const;
const DATE_COLUMNS = ["date", "doc_date", "issue_date", "execution_date", "start_date", "period_start", "created_at"] as const;
// INVARIANT: these tables carry ANOTHER document's number in their number column; reading them would report every such number twice.
const REFERENCING_TABLES: ReadonlySet<string> = new Set(["pricing_guard_override"]);
const VOIDED_STATUSES: ReadonlySet<string> = new Set(["void", "voided", "cancelled", "canceled", "reversed", "rejected"]);
const COUNTER_ADJUSTED_ACTION = "SEQUENCE_COUNTER_ADJUSTED";
const SEQUENCE_ENTITY = "SEQUENCE";
const DELETE_ACTION_PATTERN = "%DELETE%";

export interface EvidencePackRecord {
  readonly id: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly builtBy: string;
  readonly builtByName: string;
  readonly builtAt: string;
  readonly manifestSha256: string;
  readonly keyId: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly auditChainOk: boolean;
}

export interface EvidenceNumberedDocumentRow {
  readonly number: string;
  readonly date: string;
  readonly status: string;
  readonly voided: boolean;
  readonly source: string;
}

export interface EvidenceCounterAdjustmentRow {
  readonly code: string;
  readonly from: number;
  readonly to: number;
  readonly at: string;
  readonly actor: string;
}

export interface EvidenceDeletedNumberRow {
  readonly candidates: readonly string[];
  readonly at: string;
  readonly actor: string;
}

export interface EvidenceGlLineRow {
  readonly date: string;
  readonly entryNo: string | null;
  readonly entryId: string;
  readonly status: string;
  readonly source: string;
  readonly sourceDocType: string | null;
  readonly sourceDocNumber: string | null;
  readonly lineNo: number;
  readonly accountId: string;
  readonly debit: string;
  readonly credit: string;
  readonly memo: string | null;
  readonly lineMemo: string | null;
  readonly branchId: string | null;
  readonly costCenterId: string | null;
  readonly projectId: string | null;
  readonly partyId: string | null;
  readonly currency: string | null;
  readonly fxRate: string | null;
  readonly taxRatePercent: number | null;
}

export interface EvidenceAuditRow {
  readonly id: number;
  readonly timestamp: string;
  readonly stream: string;
  readonly module: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly action: string;
  readonly actor: string;
  readonly branchId: string | null;
  readonly severity: string;
  readonly details: Record<string, unknown> | null;
  readonly rowHash: string | null;
}

export interface EvidencePackStore {
  record(pack: EvidencePackRecord): void;
  list(limit: number): readonly EvidencePackRecord[];
  numberedDocuments(): readonly EvidenceNumberedDocumentRow[];
  counterAdjustments(): readonly EvidenceCounterAdjustmentRow[];
  deletedNumbers(): readonly EvidenceDeletedNumberRow[];
  glLines(from: string, to: string): IterableIterator<EvidenceGlLineRow>;
  auditEvents(from: string, to: string): IterableIterator<EvidenceAuditRow>;
}

interface RegisterRow {
  id: string;
  period_from: string;
  period_to: string;
  built_by: string;
  built_by_name: string;
  built_at: string;
  manifest_sha256: string;
  key_id: string;
  file_count: number;
  total_bytes: number;
  audit_chain_ok: number;
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function stringsIn(value: unknown, out: string[], depth = 0): void {
  if (depth > 4) return;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, out, depth + 1);
  else if (value !== null && typeof value === "object") for (const item of Object.values(value)) stringsIn(item, out, depth + 1);
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface NumberedSource {
  readonly table: string;
  readonly numberColumn: string;
  readonly dateColumn: string | null;
  readonly hasStatus: boolean;
  readonly hasDocType: boolean;
}

function numberedSources(sqlite: Database.Database): NumberedSource[] {
  const tables = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[];
  const sources: NumberedSource[] = [];
  for (const { name } of tables) {
    if (REFERENCING_TABLES.has(name)) continue;
    const columns = new Set((sqlite.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all() as { name: string }[]).map((c) => c.name));
    const numberColumn = NUMBER_COLUMNS.find((c) => columns.has(c));
    if (!numberColumn) continue;
    sources.push({
      table: name,
      numberColumn,
      dateColumn: DATE_COLUMNS.find((c) => columns.has(c)) ?? null,
      hasStatus: columns.has("status"),
      hasDocType: columns.has("doc_type"),
    });
  }
  return sources;
}

/**
 * The per-install seed that signs evidence packs.
 *
 * SECURITY: it must not live in the database an auditor is handed or an attacker
 * holds. With a database key (desktop: sealed in the OS keychain) it is derived
 * from that key; without one (a server edition) it is a 0600 file beside THIS
 * database file, so each cloud tenant has its own; an in-memory database gets a
 * per-process seed, because nothing it signs can outlive the process anyway.
 */
export function resolveEvidenceSigningSeed(sqlite: Database.Database, databaseKey?: string): string {
  if (databaseKey) return createHash("sha256").update(`${EVIDENCE_KEY_VERSION}:db-key`, "utf8").update(databaseKey, "utf8").digest("hex");
  const dbFile = sqlite.name;
  if (!dbFile || dbFile === ":memory:" || dbFile === "") {
    const held = processSeeds.get(sqlite) ?? randomBytes(32).toString("hex");
    processSeeds.set(sqlite, held);
    return held;
  }
  const resolved = path.resolve(dbFile);
  const keyFile = path.join(path.dirname(resolved), `${path.basename(resolved)}.evidence-signing.key`);
  try {
    const existing = readFileSync(keyFile, "utf8").trim();
    if (SEED_HEX.test(existing)) return existing;
  } catch {
    // Falls through to minting one on first use.
  }
  const minted = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(keyFile), { recursive: true });
  try {
    writeFileSync(keyFile, `${minted}\n`, { mode: 0o600, flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const raced = readFileSync(keyFile, "utf8").trim();
    if (!SEED_HEX.test(raced)) throw new Error(`the evidence signing key file ${keyFile} is unreadable; restore it from backup rather than replacing it`);
    return raced;
  }
  chmodSync(keyFile, 0o600);
  return minted;
}

export function createSqliteEvidencePackStore(sqlite: Database.Database): EvidencePackStore {
  sqlite.exec(CREATE_REGISTER);
  const insert = sqlite.prepare(
    `INSERT INTO evidence_pack (id, period_from, period_to, built_by, built_by_name, built_at, manifest_sha256, key_id, file_count, total_bytes, audit_chain_ok)
     VALUES (@id, @period_from, @period_to, @built_by, @built_by_name, @built_at, @manifest_sha256, @key_id, @file_count, @total_bytes, @audit_chain_ok)`,
  );
  const listStatement = sqlite.prepare(`SELECT * FROM evidence_pack ORDER BY built_at DESC, id DESC LIMIT ?`);

  return {
    record(pack) {
      insert.run({
        id: pack.id,
        period_from: pack.periodFrom,
        period_to: pack.periodTo,
        built_by: pack.builtBy,
        built_by_name: pack.builtByName,
        built_at: pack.builtAt,
        manifest_sha256: pack.manifestSha256,
        key_id: pack.keyId,
        file_count: pack.fileCount,
        total_bytes: pack.totalBytes,
        audit_chain_ok: pack.auditChainOk ? 1 : 0,
      });
    },

    list(limit) {
      return (listStatement.all(limit) as RegisterRow[]).map((row) => ({
        id: row.id,
        periodFrom: row.period_from,
        periodTo: row.period_to,
        builtBy: row.built_by,
        builtByName: row.built_by_name,
        builtAt: row.built_at,
        manifestSha256: row.manifest_sha256,
        keyId: row.key_id,
        fileCount: row.file_count,
        totalBytes: row.total_bytes,
        auditChainOk: row.audit_chain_ok === 1,
      }));
    },

    numberedDocuments() {
      const out: EvidenceNumberedDocumentRow[] = [];
      for (const source of numberedSources(sqlite)) {
        const number = quoteIdent(source.numberColumn);
        const date = source.dateColumn ? `substr(${quoteIdent(source.dateColumn)}, 1, 10)` : "''";
        const status = source.hasStatus ? "status" : "''";
        const docType = source.hasDocType ? "doc_type" : "NULL";
        const rows = sqlite
          .prepare(`SELECT ${number} AS number, ${date} AS date, ${status} AS status, ${docType} AS doc_type FROM ${quoteIdent(source.table)} WHERE ${number} IS NOT NULL AND ${number} <> ''`)
          .iterate() as IterableIterator<{ number: string; date: string | null; status: string | null; doc_type: string | null }>;
        for (const row of rows) {
          const state = String(row.status ?? "").toLowerCase();
          out.push({
            number: String(row.number),
            date: row.date ?? "",
            status: state,
            voided: VOIDED_STATUSES.has(state),
            source: row.doc_type ? `${source.table}:${row.doc_type}` : source.table,
          });
        }
      }
      return out;
    },

    counterAdjustments() {
      const rows = sqlite
        .prepare(`SELECT timestamp, actor, details FROM audit_event WHERE entity_type = ? AND action = ? ORDER BY id`)
        .all(SEQUENCE_ENTITY, COUNTER_ADJUSTED_ACTION) as { timestamp: string; actor: string; details: string | null }[];
      const out: EvidenceCounterAdjustmentRow[] = [];
      for (const row of rows) {
        const details = parseObject(row.details);
        const code = details?.["code"];
        const from = details?.["from"];
        const to = details?.["to"];
        if (typeof code === "string" && typeof from === "number" && typeof to === "number") out.push({ code, from, to, at: row.timestamp, actor: row.actor });
      }
      return out;
    },

    deletedNumbers() {
      const rows = sqlite
        .prepare(`SELECT timestamp, actor, entity_id, details FROM audit_event WHERE action LIKE ? ORDER BY id`)
        .all(DELETE_ACTION_PATTERN) as { timestamp: string; actor: string; entity_id: string | null; details: string | null }[];
      return rows.map((row) => {
        const candidates: string[] = [];
        if (row.entity_id) candidates.push(row.entity_id);
        stringsIn(parseObject(row.details), candidates);
        return { candidates, at: row.timestamp, actor: row.actor };
      });
    },

    *glLines(from, to) {
      const statement = sqlite
        .prepare(
          `SELECT e.date, e.entry_no, e.id AS entry_id, e.status, e.source, e.source_doc_type, e.source_doc_number, e.memo,
                  l.line_no, l.account_id, l.debit, l.credit, l.memo AS line_memo, l.branch_id, l.cost_center_id, l.project_id,
                  l.party_id, l.currency, l.fx_rate, l.tax_rate_percent
             FROM journal_entry e JOIN journal_line l ON l.entry_id = e.id
            WHERE e.status IN ('posted', 'reversed') AND e.date >= ? AND e.date < ?
            ORDER BY e.date, e.entry_no, e.id, l.line_no`,
        )
        .safeIntegers(true);
      for (const raw of statement.iterate(from, nextDay(to)) as IterableIterator<Record<string, unknown>>) {
        yield {
          date: String(raw["date"]).slice(0, 10),
          entryNo: raw["entry_no"] === null ? null : String(raw["entry_no"]),
          entryId: String(raw["entry_id"]),
          status: String(raw["status"]),
          source: String(raw["source"]),
          sourceDocType: raw["source_doc_type"] === null ? null : String(raw["source_doc_type"]),
          sourceDocNumber: raw["source_doc_number"] === null ? null : String(raw["source_doc_number"]),
          lineNo: Number(raw["line_no"]),
          accountId: String(raw["account_id"]),
          debit: Money.fromScaled(raw["debit"] as bigint).toString(),
          credit: Money.fromScaled(raw["credit"] as bigint).toString(),
          memo: raw["memo"] === null ? null : String(raw["memo"]),
          lineMemo: raw["line_memo"] === null ? null : String(raw["line_memo"]),
          branchId: raw["branch_id"] === null ? null : String(raw["branch_id"]),
          costCenterId: raw["cost_center_id"] === null ? null : String(raw["cost_center_id"]),
          projectId: raw["project_id"] === null ? null : String(raw["project_id"]),
          partyId: raw["party_id"] === null ? null : String(raw["party_id"]),
          currency: raw["currency"] === null ? null : String(raw["currency"]),
          fxRate: raw["fx_rate"] === null ? null : String(raw["fx_rate"]),
          taxRatePercent: raw["tax_rate_percent"] === null ? null : Number(raw["tax_rate_percent"]),
        };
      }
    },

    *auditEvents(from, to) {
      const statement = sqlite.prepare(
        `SELECT id, timestamp, stream, module, entity_type, entity_id, action, actor, branch_id, severity, details, row_hash
           FROM audit_event WHERE timestamp >= ? AND timestamp < ? ORDER BY id`,
      );
      for (const row of statement.iterate(from, nextDay(to)) as IterableIterator<Record<string, unknown>>) {
        yield {
          id: Number(row["id"]),
          timestamp: String(row["timestamp"]),
          stream: String(row["stream"]),
          module: String(row["module"]),
          entityType: String(row["entity_type"]),
          entityId: row["entity_id"] === null ? null : String(row["entity_id"]),
          action: String(row["action"]),
          actor: String(row["actor"]),
          branchId: row["branch_id"] === null ? null : String(row["branch_id"]),
          severity: String(row["severity"]),
          details: parseObject(row["details"] === null ? null : String(row["details"])),
          rowHash: row["row_hash"] === null ? null : String(row["row_hash"]),
        };
      }
    },
  };
}
