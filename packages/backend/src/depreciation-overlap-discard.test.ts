import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

interface RunBody {
  id: string;
  status: string;
  totalAmount: string;
  journalEntryId: string | null;
  lines: { assetId: string; amount: string }[];
  skippedLines: { assetId: string; assetCode: string; amount: string }[];
}

const draft = (period: string, branchId?: string) => world.request("POST", "/assets/depreciation/runs", { period, ...(branchId ? { branchId } : {}) });
const post = (id: string) => world.request("POST", `/assets/depreciation/runs/${id}/post`, {});
const discard = (id: string) => world.request("POST", `/assets/depreciation/runs/${id}/discard`, {});
const accumulated = (assetId: string) => (world.sqlite.prepare(`SELECT accumulated_depreciation AS a FROM asset WHERE id = ?`).safeIntegers().get(assetId) as { a: bigint }).a;
const setStatus = (assetId: string, status: string) => world.sqlite.prepare(`UPDATE asset SET status = ? WHERE id = ?`).run(status, assetId);
const entryTotal = (entryId: string) => (world.sqlite.prepare(`SELECT COALESCE(SUM(debit), 0) AS d FROM journal_line WHERE entry_id = ?`).safeIntegers().get(entryId) as { d: bigint }).d;

function addLineToDraft(runId: string, assetId: string, amount: string) {
  const row = world.sqlite.prepare(`SELECT lines FROM depreciation_run WHERE id = ?`).get(runId) as { lines: string };
  const lines = [...(JSON.parse(row.lines) as unknown[]), { assetId, amount, projectId: null, costCategory: null }];
  world.sqlite.prepare(`UPDATE depreciation_run SET lines = ? WHERE id = ?`).run(JSON.stringify(lines), runId);
}

describe("two drafts for one month that share an asset", () => {
  let branchRun: RunBody;
  let companyRun: RunBody;

  it("the second to post charges only the assets not yet charged, and names what it skipped", async () => {
    branchRun = (await draft("2026-10", "BR-MAIN")).body as unknown as RunBody;
    companyRun = (await draft("2026-10")).body as unknown as RunBody;
    expect(companyRun.lines.map((l) => l.assetId)).toEqual(["ASSET-DEMO-1"]);
    const shared = branchRun.lines.find((l) => l.assetId === "ASSET-DEMO-2")!;
    addLineToDraft(companyRun.id, "ASSET-DEMO-2", shared.amount);
    const before = accumulated("ASSET-DEMO-2");

    expect((await post(branchRun.id)).status).toBe(200);
    const afterFirst = accumulated("ASSET-DEMO-2");
    const second = await post(companyRun.id);

    expect(second.status).toBe(200);
    const posted = second.body as unknown as RunBody;
    expect(posted.status).toBe("posted");
    expect(posted.lines.map((l) => l.assetId)).toEqual(["ASSET-DEMO-1"]);
    expect(posted.skippedLines).toEqual([{ assetId: "ASSET-DEMO-2", assetCode: "AST-0002", amount: shared.amount }]);
    expect(posted.totalAmount).toBe(companyRun.lines[0]!.amount);
    expect(entryTotal(posted.journalEntryId!)).toBe(BigInt(companyRun.lines[0]!.amount.replace(".", "")));
    expect(afterFirst).toBeGreaterThan(before);
    expect(accumulated("ASSET-DEMO-2")).toBe(afterFirst);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const reread = (await world.request("GET", `/assets/depreciation/runs/${posted.id}`)).body as unknown as RunBody;
    expect(reread.skippedLines).toEqual(posted.skippedLines);
  });

  it("a draft whose every asset was charged elsewhere posts nothing and says to discard it; discarding it is recorded and frees the month", async () => {
    world.sqlite
      .prepare(`INSERT INTO depreciation_run (id, period, branch_id, status, lines, total_amount, journal_entry_id, created_at, posted_at) VALUES ('STALE-DRAFT', '2026-10', 'BR-STALE', 'draft', ?, 2700000000, NULL, '2026-10-01T00:00:00.000Z', NULL)`)
      .run(JSON.stringify([{ assetId: "ASSET-DEMO-1", amount: "2700.000000", projectId: null, costCategory: null }]));

    const refused = await post("STALE-DRAFT");
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      error: "ASSET_ALREADY_DEPRECIATED",
      message: 'الأصل AST-0001 حُمِّل إهلاك الفترة "2026-10" في تشغيل مرحَّل آخر، ولم يبقَ في هذه المسودة ما يُرحَّل. استبعد المسودة من قائمة تشغيلات الإهلاك.',
    });

    const discarded = await discard("STALE-DRAFT");
    expect(`${discarded.status} ${String(discarded.body.status)}`).toBe("200 cancelled");
    expect(world.count("audit_event", "entity_id = 'STALE-DRAFT' AND action = 'DISCARD'")).toBe(1);

    const again = await discard("STALE-DRAFT");
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: "DEPRECIATION_RUN_NOT_DRAFT", message: 'لا يمكن استبعاد تشغيل الإهلاك "STALE-DRAFT" لأن حالته «ملغى» وليست مسودة.' });
  });

  it("a posted run is not discarded: it is reversed", async () => {
    const refused = await discard(branchRun.id);
    expect(refused.status).toBe(409);
    expect(String(refused.body.message)).toContain("«مُرحَّل»");
  });
});

describe("an asset left out of a month's posted run", () => {
  it("gets a supplementary run for the same month and scope, holding only what is still uncharged", async () => {
    setStatus("ASSET-DEMO-6", "disposed");
    const first = (await draft("2026-11")).body as unknown as RunBody;
    expect(first.lines.map((l) => l.assetId)).not.toContain("ASSET-DEMO-6");
    expect((await post(first.id)).status).toBe(200);
    setStatus("ASSET-DEMO-6", "active");

    const supplementary = await draft("2026-11");

    expect(supplementary.status).toBe(201);
    const run = supplementary.body as unknown as RunBody;
    expect(run.lines.map((l) => l.assetId)).toEqual(["ASSET-DEMO-6"]);
    expect((await post(run.id)).status).toBe(200);

    const none = await draft("2026-11");
    expect(`${none.status} ${String(none.body.error)}`).toBe("422 NO_DEPRECIABLE_ASSETS");
  });

  it("a draft still open for the month and scope is finished or discarded before another is drafted", async () => {
    expect((await draft("2026-12", "BR-MAIN")).status).toBe(201);
    const second = await draft("2026-12", "BR-MAIN");
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: "DUPLICATE_DEPRECIATION_PERIOD", message: 'يوجد تشغيل إهلاك مسودة للفترة "2026-12" للفرع "BR-MAIN". رحِّله أو استبعده قبل إنشاء تشغيل آخر.' });
  });
});

describe("an asset under maintenance", () => {
  it("is drafted like any asset in use: maintenance does not pause depreciation, and the close check already counts it", async () => {
    setStatus("ASSET-DEMO-5", "under_maintenance");
    const run = (await draft("2026-08")).body as unknown as RunBody;
    expect(run.lines.map((l) => l.assetId)).toContain("ASSET-DEMO-5");
  });
});
