import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type PeriodCloseChecklistDTO, type PeriodCloseFindingDTO } from "@mezan/contracts";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 120_000);

afterAll(() => world?.close());

interface RunBody {
  readonly id: string;
  readonly lines: readonly { assetId: string; amount: string }[];
}

async function depreciationCheck(month: string): Promise<{ status: string; failing: PeriodCloseFindingDTO[] }> {
  const res = await world.request("GET", `/period-close/fp-2026-${month}/checks`);
  expect(res.status).toBe(200);
  const check = (res.body as unknown as PeriodCloseChecklistDTO).checks.find((c) => c.code === "depreciation");
  if (!check) throw new Error("the depreciation check is missing from the checklist");
  return { status: check.status, failing: check.findings.filter((f) => !f.passed) };
}

function accumulated(): Map<string, bigint> {
  const rows = world.sqlite.prepare(`SELECT id, accumulated_depreciation AS value FROM asset`).safeIntegers().all() as { id: string; value: bigint }[];
  return new Map(rows.map((r) => [r.id, r.value]));
}

function scaled(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole ?? "0") * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function chargedByEntry(runId: string): bigint {
  const row = world.sqlite.prepare(`SELECT COALESCE(SUM(credit), 0) AS total FROM journal_line WHERE entry_id = ?`).safeIntegers().get(`DEP-JE:${runId}`) as { total: bigint };
  return row.total;
}

describe("a branch depreciation run followed by a company-wide run for the same month", () => {
  let branchRun: RunBody;
  let companyRun: RunBody;
  let before: Map<string, bigint>;

  it("before any run, the check names the assets nobody has charged, per scope", async () => {
    const check = await depreciationCheck("10");
    expect(check.status).toBe("fail");
    expect(check.failing.map((f) => ({ ref: f.ref, state: f.state, count: f.count, items: [...f.items].sort() })).sort((a, b) => a.ref.localeCompare(b.ref))).toEqual([
      { ref: "2026-10:BR-MAIN", state: "missing", count: 3, items: ["2026-10", "AST-0002", "AST-0004", "AST-0101"] },
      { ref: "2026-10:general", state: "missing", count: 4, items: ["2026-10", "AST-0001", "AST-0003", "AST-0005", "AST-0006"] },
    ]);
  });

  it("the company-wide run drafts only the assets the branch run did not charge", async () => {
    before = accumulated();
    const branch = await world.request("POST", "/assets/depreciation/runs", { period: "2026-10", branchId: "BR-MAIN" });
    expect(branch.status).toBe(201);
    branchRun = branch.body as unknown as RunBody;
    expect((await world.request("POST", `/assets/depreciation/runs/${branchRun.id}/post`, {})).status).toBe(200);

    const company = await world.request("POST", "/assets/depreciation/runs", { period: "2026-10" });
    expect(company.status).toBe(201);
    companyRun = company.body as unknown as RunBody;

    const charged = new Set(branchRun.lines.map((l) => l.assetId));
    expect(companyRun.lines.filter((l) => charged.has(l.assetId))).toEqual([]);
    expect([...branchRun.lines, ...companyRun.lines].map((l) => l.assetId).sort()).toEqual([...before.keys()].sort());
  });

  it("after both post, every asset carries one month's charge and the ledger holds that month once", async () => {
    expect((await world.request("POST", `/assets/depreciation/runs/${companyRun.id}/post`, {})).status).toBe(200);

    const after = accumulated();
    const lines = [...branchRun.lines, ...companyRun.lines];
    expect(Object.fromEntries(lines.map((l) => [l.assetId, (after.get(l.assetId) ?? 0n) - (before.get(l.assetId) ?? 0n)]))).toEqual(Object.fromEntries(lines.map((l) => [l.assetId, scaled(l.amount)])));
    const julyCharge = (world.sqlite.prepare(`SELECT total_amount AS total FROM depreciation_run WHERE period = '2026-07' AND status = 'posted'`).safeIntegers().get() as { total: bigint }).total;
    expect(chargedByEntry(branchRun.id) + chargedByEntry(companyRun.id)).toBe(julyCharge);
    expect(julyCharge).toBe(32_959_027_777n);
    expect(await depreciationCheck("10")).toEqual({ status: "pass", failing: [] });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("in the other order — company-wide first — the branch run has nothing left to charge", async () => {
    const company = await world.request("POST", "/assets/depreciation/runs", { period: "2026-11" });
    expect(company.status).toBe(201);
    expect((company.body as unknown as RunBody).lines.length).toBe(before.size);

    const branch = await world.request("POST", "/assets/depreciation/runs", { period: "2026-11", branchId: "BR-MAIN" });

    expect(`${branch.status} ${branch.body.error}`).toBe("422 NO_DEPRECIABLE_ASSETS");
  });
});

describe("an asset already charged for the month", () => {
  const overlapping = (id: string, status: string) =>
    world.sqlite
      .prepare(`INSERT INTO depreciation_run (id, period, branch_id, status, lines, total_amount, journal_entry_id, created_at, posted_at) VALUES (?, '2026-10', 'BR-LEGACY', ?, ?, 5833333333, NULL, '2026-10-31T10:00:00.000Z', NULL)`)
      .run(id, status, JSON.stringify([{ assetId: "ASSET-DEMO-2", amount: "5833.333333", projectId: null, costCategory: null }]));

  it("is not charged again by a draft that predates the rule: the post is refused in Arabic and nothing is written", async () => {
    overlapping("DS-LEGACY-DRAFT", "draft");
    const entries = world.count("journal_entry");
    const before = accumulated().get("ASSET-DEMO-2");

    const refused = await world.request("POST", "/assets/depreciation/runs/DS-LEGACY-DRAFT/post", {});

    expect(refused.status).toBe(422);
    expect(refused.body).toEqual({
      error: "ASSET_ALREADY_DEPRECIATED",
      message: "الأصل AST-0002 حُمِّل إهلاك الفترة \"2026-10\" في تشغيل مرحَّل آخر. ألغِ هذا التشغيل وأنشئ تشغيلاً جديداً للأصول الباقية فقط.",
      messageEn: 'Asset AST-0002 was already charged depreciation for period "2026-10" by another posted run. Discard this run and draft a new one for the remaining assets only.',
    });
    expect(world.count("journal_entry")).toBe(entries);
    expect(accumulated().get("ASSET-DEMO-2")).toBe(before);
    world.sqlite.prepare(`DELETE FROM depreciation_run WHERE id = 'DS-LEGACY-DRAFT'`).run();
  });

  it("fails the month's close check when two posted runs already charged it, naming the asset", async () => {
    overlapping("DS-LEGACY-POSTED", "posted");

    const check = await depreciationCheck("10");

    expect(check.status).toBe("fail");
    expect(check.failing.map((f) => ({ ref: f.ref, state: f.state, count: f.count, items: f.items }))).toEqual([
      { ref: "2026-10:BR-MAIN:double_charged", state: "double_charged", count: 1, items: ["2026-10", "AST-0002"] },
    ]);
  });
});
