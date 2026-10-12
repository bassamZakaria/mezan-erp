import { ALL_SCOPE } from "@mezan/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

interface RunRow {
  id: string;
  templateId: string;
  period: string;
  journalEntryId: string;
}

const julyRun = () =>
  world.sqlite
    .prepare(
      `SELECT r.id, r.template_id AS templateId, r.period, r.journal_entry_id AS journalEntryId FROM recurring_journal_run r JOIN journal_entry je ON je.id = r.journal_entry_id WHERE r.period = '2026-07' AND je.status = 'posted' ORDER BY r.id LIMIT 1`,
    )
    .get() as RunRow;
const recurringFindings = async (periodId: string) => {
  const checks = (await world.request("GET", `/period-close/${periodId}/checks`)).body.checks as { findings: { kind: string; ref: string; passed: boolean; state: string }[] }[];
  return checks.flatMap((c) => c.findings).filter((f) => f.kind === "recurring_template");
};
const dueFor = async (templateId: string) =>
  ((await world.request("GET", "/gl/recurring/due?asOfDate=2026-07-31")).body.due as { templateId: string; periods: string[] }[]).find((d) => d.templateId === templateId)?.periods ?? [];

describe("reversing a recurring run", () => {
  it("needs the right to post journals as well as to manage recurring entries", async () => {
    const run = julyRun();
    const token = world.backend.sessions.issue({ userId: "limited", permissions: ["accounting.recurring.reverse", "accounting.recurring.manage", "accounting.recurring.view"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const res = await world.backend.app.fetch(
      new Request(`http://local/gl/recurring/runs/${encodeURIComponent(run.id)}/reverse`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ date: "2026-10-05" }) }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { permission?: string }).permission).toBe("accounting.journal.post");
    expect((world.sqlite.prepare(`SELECT status FROM journal_entry WHERE id = ?`).get(run.journalEntryId) as { status: string }).status).toBe("posted");
  });

  it("finds a run that is not among the two hundred most recent", async () => {
    const run = julyRun();
    const insert = world.sqlite.prepare(
      `INSERT INTO recurring_journal_run (id, template_id, period, journal_entry_id, generated_at, generated_by) VALUES (?, ?, '2099-01', ?, '2099-01-01T00:00:00.000Z', 'test')`,
    );
    for (let i = 0; i < 205; i += 1) insert.run(`RRR-FILL-${i}`, `RRR-TEMPLATE-${i}`, `RRR-ENTRY-${i}`);

    const refused = await world.request("POST", `/gl/recurring/runs/${encodeURIComponent(run.id)}/reverse`, { date: "2026-06-30" });

    expect(`${refused.status} ${String(refused.body.error)}`).toBe("422 REVERSAL_DATE_BEFORE_ORIGINAL");
    world.sqlite.prepare(`DELETE FROM recurring_journal_run WHERE id LIKE 'RRR-FILL-%'`).run();
  });

  it("frees its month: the period is due again, regenerates, and the month's close check passes once the new entry is posted", async () => {
    const run = julyRun();
    expect(await dueFor(run.templateId)).not.toContain("2026-07");

    const reversed = await world.request("POST", `/gl/recurring/runs/${encodeURIComponent(run.id)}/reverse`, { date: "2026-10-05" });
    expect(reversed.status, JSON.stringify(reversed.body)).toBe(201);
    expect((await recurringFindings("fp-2026-07")).find((f) => f.ref === `${run.templateId}:2026-07`)).toMatchObject({ passed: false, state: "reversed" });
    expect(await dueFor(run.templateId)).toContain("2026-07");

    const generated = await world.request("POST", "/gl/recurring/generate-due", { asOfDate: "2026-07-31", templateIds: [run.templateId] });
    expect(generated.status).toBe(201);
    const fresh = (generated.body.generated as { period: string; journalEntryId: string }[]).find((g) => g.period === "2026-07");
    expect(fresh, JSON.stringify(generated.body)).toBeDefined();
    expect(fresh?.journalEntryId).not.toBe(run.journalEntryId);
    expect(await dueFor(run.templateId)).not.toContain("2026-07");

    expect((await recurringFindings("fp-2026-07")).find((f) => f.ref === `${run.templateId}:2026-07`)).toMatchObject({ passed: false, state: "draft" });
    world.sqlite.prepare(`UPDATE fiscal_period SET status = 'open' WHERE id = 'fp-2026-07'`).run();
    const posted = await world.request("POST", `/gl/journal-entries/${encodeURIComponent(String(fresh?.journalEntryId))}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
    expect((await recurringFindings("fp-2026-07")).find((f) => f.ref === `${run.templateId}:2026-07`)).toMatchObject({ passed: true });

    const again = await world.request("POST", "/gl/recurring/generate-due", { asOfDate: "2026-07-31", templateIds: [run.templateId] });
    expect((again.body.generated as unknown[]).length).toBe(0);
    expect(world.count("recurring_journal_run", `template_id = '${run.templateId}' AND period = '2026-07'`)).toBe(2);

    const history = ((await world.request("GET", `/gl/recurring/templates/${encodeURIComponent(run.templateId)}/runs`)).body as unknown as Record<string, unknown>[]).filter((r) => r.period === "2026-07");
    expect(history).toEqual([
      expect.objectContaining({ generation: 2, journalEntryId: fresh?.journalEntryId, entryStatus: "posted", current: true, reversedByEntryId: null, reversedByEntryNo: null, reversedOn: null }),
      expect.objectContaining({ id: run.id, generation: 1, journalEntryId: run.journalEntryId, entryStatus: "reversed", current: false, reversedByEntryId: reversed.body.reversalEntryId, reversedByEntryNo: reversed.body.reversalEntryNo, reversedOn: "2026-10-05" }),
    ]);
    const listed = ((await world.request("GET", "/gl/recurring/runs?limit=500")).body as unknown as Record<string, unknown>[]).filter((r) => r.templateId === run.templateId && r.period === "2026-07");
    expect(listed.map((r) => r.generation).sort()).toEqual([1, 2]);

    const superseded = await world.request("POST", `/gl/recurring/runs/${encodeURIComponent(run.id)}/reverse`, { date: "2026-10-06" });
    expect(`${superseded.status} ${String(superseded.body.error)}`).toBe("409 JOURNAL_ENTRY_ALREADY_REVERSED");
  });

  it("refuses a run whose entry is still a draft, in both languages", async () => {
    const draft = world.sqlite
      .prepare(`SELECT r.id FROM recurring_journal_run r JOIN journal_entry e ON e.id = r.journal_entry_id WHERE e.status = 'draft' LIMIT 1`)
      .get() as { id: string };
    const refused = await world.request("POST", `/gl/recurring/runs/${draft.id}/reverse`, {});
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("409 JOURNAL_ENTRY_NOT_POSTED");
    expect(String(refused.body.message)).toMatch(/[\u0600-\u06FF]/);
    expect(String(refused.body.messageEn)).toContain("not posted");
  });
});
