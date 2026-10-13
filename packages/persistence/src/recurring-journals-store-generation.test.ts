import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { RecurringJournalRun } from "@mezan/domain";
import { createSqliteRecurringJournalRunRepository } from "./recurring-journals-store.js";

let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

function oldShapeBooks(): string {
  dir = mkdtempSync(path.join(tmpdir(), "mezan-recurring-old-"));
  const file = path.join(dir, "books.db");
  const sqlite = new Database(file);
  sqlite.exec(`
    CREATE TABLE recurring_journal_run (
      id TEXT PRIMARY KEY, template_id TEXT NOT NULL, period TEXT NOT NULL, journal_entry_id TEXT NOT NULL, journal_entry_no TEXT,
      reversal_journal_entry_id TEXT, reversal_journal_entry_no TEXT, generated_at TEXT NOT NULL, generated_by TEXT NOT NULL,
      UNIQUE(template_id, period)
    );
    CREATE INDEX idx_recurring_journal_run_template ON recurring_journal_run(template_id);
    INSERT INTO recurring_journal_run VALUES ('run-jul', 'tpl-rent', '2026-07', 'je-jul', 'JE-000101', NULL, NULL, '2026-07-31T10:00:00.000Z', 'admin');
    INSERT INTO recurring_journal_run VALUES ('run-aug', 'tpl-rent', '2026-08', 'je-aug', 'JE-000140', 'je-aug-rev', 'JE-000141', '2026-08-31T10:00:00.000Z', 'admin');
  `);
  sqlite.close();
  return file;
}

const run = (id: string, period: string, generation: number): RecurringJournalRun => ({
  id, templateId: "tpl-rent", period, generation, journalEntryId: `je-${id}`, journalEntryNo: null, reversalJournalEntryId: null, reversalJournalEntryNo: null, generatedAt: `2026-10-0${generation}T09:00:00.000Z`, generatedBy: "admin",
});

describe("recurring run store — a period keeps every generation of its run", () => {
  it("books written before generations read every run as generation 1, unchanged, however often they are opened", async () => {
    const file = oldShapeBooks();
    for (let opened = 0; opened < 2; opened += 1) {
      const runs = createSqliteRecurringJournalRunRepository(file);
      expect(await runs.listByTemplate("tpl-rent")).toEqual([
        { id: "run-aug", templateId: "tpl-rent", period: "2026-08", generation: 1, journalEntryId: "je-aug", journalEntryNo: "JE-000140", reversalJournalEntryId: "je-aug-rev", reversalJournalEntryNo: "JE-000141", generatedAt: "2026-08-31T10:00:00.000Z", generatedBy: "admin" },
        { id: "run-jul", templateId: "tpl-rent", period: "2026-07", generation: 1, journalEntryId: "je-jul", journalEntryNo: "JE-000101", reversalJournalEntryId: null, reversalJournalEntryNo: null, generatedAt: "2026-07-31T10:00:00.000Z", generatedBy: "admin" },
      ]);
      runs.close();
    }
  });

  it("a regenerated period keeps the run it replaces beside the new one, and the period answers with the newest", async () => {
    const runs = createSqliteRecurringJournalRunRepository(oldShapeBooks());
    expect(await runs.save(run("run-jul-2", "2026-07", 2))).toBe(true);

    expect((await runs.listByTemplate("tpl-rent")).filter((r) => r.period === "2026-07").map((r) => `${r.id}#${r.generation}`)).toEqual(["run-jul-2#2", "run-jul#1"]);
    expect((await runs.findByTemplateAndPeriod("tpl-rent", "2026-07"))?.id).toBe("run-jul-2");
    expect((await runs.findById("run-jul"))?.generation).toBe(1);
    runs.close();
  });

  it("a second claim on the same generation of a period is refused and writes nothing", async () => {
    const runs = createSqliteRecurringJournalRunRepository(oldShapeBooks());
    expect(await runs.save(run("run-jul-again", "2026-07", 1))).toBe(false);
    expect(await runs.save(run("run-jul-2", "2026-07", 2))).toBe(true);
    expect(await runs.save(run("run-jul-2b", "2026-07", 2))).toBe(false);
    expect((await runs.listByTemplate("tpl-rent")).map((r) => r.id)).toEqual(["run-aug", "run-jul-2", "run-jul"]);
    runs.close();
  });
});
