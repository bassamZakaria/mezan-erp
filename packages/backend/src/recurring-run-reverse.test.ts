import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

interface Run {
  id: string;
  templateId: string;
  period: string;
  journalEntryId: string | null;
}
const septemberRun = async () => ((await world.request("GET", "/gl/recurring/runs")).body as unknown as Run[]).find((run) => run.templateId === "RJT-DEMO-1" && run.period === "2026-09")!;
const entryStatus = (id: string) => (world.sqlite.prepare(`SELECT status FROM journal_entry WHERE id = ?`).get(id) as { status: string }).status;
const recurringState = async () => {
  const checks = (await world.request("GET", "/period-close/fp-2026-09/checks")).body.checks as { code: string; findings: { ref: string; state: string }[] }[];
  return checks.find((c) => c.code === "recurring_journals")?.findings.find((f) => f.ref === "RJT-DEMO-1:2026-09")?.state;
};

describe("reversing the entry a recurring run generated", () => {
  it("is refused from the journal, which names the run's own screen as the place to do it", async () => {
    const run = await septemberRun();
    expect((await world.request("POST", `/gl/journal-entries/${encodeURIComponent(run.journalEntryId!)}/post`, {})).status).toBe(200);

    const refused = await world.request("POST", `/gl/journal-entries/${encodeURIComponent(run.journalEntryId!)}/reverse`, {});

    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("JOURNAL_ENTRY_OWNED_BY_DOCUMENT");
    expect(entryStatus(run.journalEntryId!)).toBe("posted");
  });

  it("goes through the run: the entry is reversed on the stated day and the month's close reads the run as reversed", async () => {
    const run = await septemberRun();
    const early = await world.request("POST", `/gl/recurring/runs/${encodeURIComponent(run.id)}/reverse`, { date: "2026-08-15" });
    expect(`${early.status} ${String(early.body.error)}`).toBe("422 REVERSAL_DATE_BEFORE_ORIGINAL");

    const reversed = await world.request("POST", `/gl/recurring/runs/${encodeURIComponent(run.id)}/reverse`, { date: "2026-09-20" });

    expect(reversed.status).toBe(201);
    expect(reversed.body).toMatchObject({ runId: run.id, journalEntryId: run.journalEntryId, entryStatus: "reversed" });
    expect(world.sqlite.prepare(`SELECT date FROM journal_entry WHERE reverses_entry_id = ?`).all(run.journalEntryId)).toEqual([{ date: "2026-09-20" }]);
    expect(await recurringState()).toBe("reversed");

    const again = await world.request("POST", `/gl/recurring/runs/${encodeURIComponent(run.id)}/reverse`, { date: "2026-09-21" });
    expect(again.status).toBe(409);
  });

  it("a run that does not exist is a 404", async () => {
    expect((await world.request("POST", "/gl/recurring/runs/NOPE/reverse", {})).status).toBe(404);
  });
});
