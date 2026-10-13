import { expect } from "vitest";
import type { SeededWorld } from "../test-helpers/seeded-world.js";

export interface EntryRow {
  readonly id: string;
  readonly status: string;
  readonly date: string;
  readonly reversedBy: string | null;
}

export function entry(world: SeededWorld, id: string): EntryRow {
  return world.sqlite.prepare(`SELECT id, status, substr(date, 1, 10) AS date, reversed_by_entry_id AS reversedBy FROM journal_entry WHERE id = ?`).get(id) as EntryRow;
}

export function auditRows(world: SeededWorld, entityType: string, entityId: string, action: string): number {
  return world.count("audit_event", `entity_type = '${entityType}' AND entity_id = '${entityId}' AND action = '${action}'`);
}

export async function expectJournalRouteClosed(world: SeededWorld, entryId: string): Promise<void> {
  const res = await world.request("POST", `/gl/journal-entries/${encodeURIComponent(entryId)}/reverse`, {});
  expect(`${res.status} ${String(res.body.error)}`).toBe("422 JOURNAL_ENTRY_OWNED_BY_DOCUMENT");
}

export async function expectRefusedInClosedPeriod(world: SeededWorld, periodId: string, attempt: (lastDayOfPeriod: string) => Promise<{ status: number; body: Record<string, unknown> }>): Promise<void> {
  const period = world.sqlite.prepare(`SELECT status, end_date AS endDate FROM fiscal_period WHERE id = ?`).get(periodId) as { status: string; endDate: string };
  world.sqlite.prepare(`UPDATE fiscal_period SET status = 'closed' WHERE id = ?`).run(periodId);
  try {
    const res = await attempt(period.endDate);
    expect(`${res.status} ${String(res.body.error)}`, JSON.stringify(res.body)).toBe("422 PERIOD_NOT_OPEN_FOR_POSTING");
    expect(String(res.body.message)).toMatch(/[؀-ۿ]/);
    expect(typeof res.body.messageEn).toBe("string");
  } finally {
    world.sqlite.prepare(`UPDATE fiscal_period SET status = ? WHERE id = ?`).run(period.status, periodId);
  }
}
