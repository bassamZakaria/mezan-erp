import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

describe("a recurring period whose run was reversed", () => {
  it("can be skipped instead of regenerated, and is then neither due nor a close blocker", async () => {
    const run = world.sqlite
      .prepare(`SELECT r.id, r.template_id AS templateId FROM recurring_journal_run r JOIN journal_entry je ON je.id = r.journal_entry_id WHERE r.period = '2026-07' AND je.status = 'posted' ORDER BY r.id LIMIT 1`)
      .get() as { id: string; templateId: string };
    const dueFor = async () => ((await world.request("GET", "/gl/recurring/due?asOfDate=2026-07-31")).body.due as { templateId: string; periods: string[] }[]).find((d) => d.templateId === run.templateId)?.periods ?? [];
    const finding = async () =>
      ((await world.request("GET", "/period-close/fp-2026-07/checks")).body.checks as { findings: { kind: string; ref: string; passed: boolean }[] }[]).flatMap((c) => c.findings).find((f) => f.kind === "recurring_template" && f.ref === `${run.templateId}:2026-07`);

    const standing = await world.request("POST", `/gl/recurring/templates/${run.templateId}/skip`, { period: "2026-07", note: "لا يلزم" });
    expect(`${standing.status} ${String(standing.body.error)}`).toBe("409 RECURRING_JOURNAL_PERIOD_ALREADY_GENERATED");

    expect((await world.request("POST", `/gl/recurring/runs/${encodeURIComponent(run.id)}/reverse`, { date: "2026-10-05" })).status).toBe(201);
    expect(await dueFor()).toContain("2026-07");

    const skipped = await world.request("POST", `/gl/recurring/templates/${run.templateId}/skip`, { period: "2026-07", note: "أُلغي إيجار يوليو" });

    expect(skipped.status, JSON.stringify(skipped.body)).toBe(201);
    expect(await dueFor()).not.toContain("2026-07");
    expect((await finding())?.passed ?? true).toBe(true);
    expect(world.count("recurring_journal_run", `id = '${run.id}'`)).toBe(1);
  });
});
