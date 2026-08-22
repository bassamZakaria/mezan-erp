import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Drizzle SQLite schema. Money is stored as INTEGER at scale 1e-6 (see
 * docs/plan.md §2.3) — never REAL/NUMERIC, which would silently degrade to
 * IEEE-754 double.
 */
export const journalEntry = sqliteTable("journal_entry", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  memo: text("memo").notNull(),
  status: text("status").notNull(),
});

export const journalLine = sqliteTable("journal_line", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entryId: text("entry_id")
    .notNull()
    .references(() => journalEntry.id),
  lineNo: integer("line_no").notNull(),
  accountId: text("account_id").notNull(),
  debit: integer("debit").notNull(),
  credit: integer("credit").notNull(),
});

export const schema = { journalEntry, journalLine };
