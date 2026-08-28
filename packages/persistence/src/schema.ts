import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Drizzle SQLite schema. Money is stored as INTEGER at scale 1e-6 (see
 * docs/plan.md §2.3) — never REAL/NUMERIC, which would silently degrade to
 * IEEE-754 double.
 */
/**
 * NOTE: these two tables back ONLY the legacy `postJournalEntrySpike` /
 * `uow.journal` code path (the original "journal-posting spike"), which is
 * unrelated to the real GL engine's ledger tables (packages/persistence/src/
 * ledger-store.ts's own `journal_entry`/`journal_line`, with a much richer
 * schema — entry_no, cost_center_id, etc). Both stores can open a connection
 * to the SAME on-disk file (packages/backend/src/create-backend.ts), so these
 * are named `uow_*` to avoid colliding with the ledger store's tables of the
 * same logical name — `CREATE TABLE IF NOT EXISTS` silently no-ops on an
 * existing same-named table, which previously produced "no such column"
 * errors on the ledger store's `CREATE INDEX` once a real file path put both
 * stores' bootstrap SQL against one file.
 */
export const journalEntry = sqliteTable("uow_journal_entry", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  memo: text("memo").notNull(),
  status: text("status").notNull(),
});

export const journalLine = sqliteTable("uow_journal_line", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entryId: text("entry_id")
    .notNull()
    .references(() => journalEntry.id),
  lineNo: integer("line_no").notNull(),
  accountId: text("account_id").notNull(),
  debit: integer("debit").notNull(),
  credit: integer("credit").notNull(),
});

/**
 * Numbering counter (docs/plan.md §2.3 rule 5). One row per (code, period);
 * `period` is "" for a never-resetting sequence or the calendar year for an
 * annual-reset one. Bumped under BEGIN IMMEDIATE so numbers have no gaps/dupes.
 */
export const sequenceCounter = sqliteTable("sequence_counter", {
  code: text("code").notNull(),
  period: text("period").notNull(),
  value: integer("value").notNull(),
});

/**
 * Append-only audit trail (docs/plan.md §5.7). BEFORE UPDATE/DELETE triggers in
 * the store enforce append-only at the storage layer; `details` is JSON text.
 */
export const auditEvent = sqliteTable("audit_event", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stream: text("stream").notNull(),
  module: text("module").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  timestamp: text("timestamp").notNull(),
  severity: text("severity").notNull(),
  details: text("details"),
});

/**
 * Custom role — permission grants stored as a JSON array of raw (pre
 * dependency-resolution) permission codes (docs/plan.md §5.2 / roles/role.ts).
 */
export const role = sqliteTable("role", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  permissions: text("permissions").notNull(), // JSON string[]
  isSystem: integer("is_system", { mode: "boolean" }).notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Tenant user account. `branchScope`/`warehouseScope` are JSON: either the
 * `"*"` sentinel or a string array of ids (permissions/auth-context.ts
 * `ScopeSelection`).
 */
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  /** Login identifier, stored already normalised (trimmed, lower-case). Unique. */
  username: text("username").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  pinHash: text("pin_hash"),
  roleId: text("role_id").references(() => role.id),
  isCompanyAdmin: integer("is_company_admin", { mode: "boolean" }).notNull(),
  employeeId: text("employee_id"),
  branchScope: text("branch_scope").notNull(), // JSON
  warehouseScope: text("warehouse_scope").notNull(), // JSON
  status: text("status").notNull(),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull(),
});

export const schema = {
  journalEntry,
  journalLine,
  sequenceCounter,
  auditEvent,
  role,
  user,
};
