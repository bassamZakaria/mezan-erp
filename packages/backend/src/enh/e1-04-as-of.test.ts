import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { PeriodCloseCheckStatusDTO, type PeriodCloseChecklistDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle } from "../create-backend.js";

type Sqlite = ReturnType<typeof openSqliteConnection>["sqlite"];

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;
const TIED = { inventory: "0.000000", ar: "0.000000", ap: "0.000000" };

let dir: string;
let backend: BackendHandle;
let sqlite: Sqlite;
let headers: Record<string, string>;

async function request(method: string, url: string, body?: unknown): Promise<Response> {
  return backend.app.fetch(new Request(`http://local${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
}

async function ok(method: string, url: string, body: unknown, status: number): Promise<Record<string, unknown>> {
  const res = await request(method, url, body);
  const text = await res.text();
  expect(`${res.status} ${res.status === status ? "" : text}`.trim()).toBe(String(status));
  return JSON.parse(text) as Record<string, unknown>;
}

async function differencesAt(month: string): Promise<Record<string, string>> {
  const res = await request("GET", `/period-close/fp-2026-${month}/checks`);
  expect(res.status).toBe(200);
  const ties = ((await res.json()) as PeriodCloseChecklistDTO).checks.find((c) => c.code === "subledger_ties");
  if (!ties) throw new Error("subledger_ties is missing from the checklist");
  expect(ties.status).not.toBe(PeriodCloseCheckStatusDTO.Unavailable);
  return Object.fromEntries(ties.findings.filter((f) => f.ref in TIED).map((f) => [f.ref, f.amount ?? "0.000000"]));
}

async function liveDifferences(): Promise<Record<string, string>> {
  const body = (await (await request("GET", "/reconciliation")).json()) as { rows: { key: string; difference: string }[] };
  return Object.fromEntries(body.rows.filter((r) => r.key in TIED).map((r) => [r.key, r.difference]));
}

async function expectTiedEverywhere(months: readonly string[]): Promise<void> {
  for (const month of months) expect({ month, ...(await differencesAt(month)) }).toEqual({ month, ...TIED });
  expect(await liveDifferences()).toEqual(TIED);
}

function controlBalanceAt(accountId: string, asOfDate: string): bigint {
  const row = sqlite
    .prepare(
      `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS net FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id
        WHERE jl.account_id = ? AND je.status IN ('posted', 'reversed') AND substr(je.date, 1, 10) <= ?`,
    )
    .safeIntegers()
    .get(accountId, asOfDate) as { net: bigint };
  return row.net;
}

function entryEffect(entryId: string): Record<string, string | bigint> {
  const entry = sqlite.prepare(`SELECT date FROM journal_entry WHERE id = ?`).get(entryId) as { date: string } | undefined;
  if (!entry) throw new Error(`journal entry ${entryId} was not posted`);
  const lines = sqlite
    .prepare(`SELECT account_id AS account, SUM(debit - credit) AS net FROM journal_line WHERE entry_id = ? AND account_id IN ('1105', '2100', '1200') GROUP BY account_id`)
    .safeIntegers()
    .all(entryId) as { account: string; net: bigint }[];
  return { date: entry.date, ...Object.fromEntries(lines.map((l) => [l.account, l.net])) };
}

function periodStatus(month: string): string {
  return (sqlite.prepare(`SELECT status FROM fiscal_period WHERE id = ?`).get(`fp-2026-${month}`) as { status: string }).status;
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "mezan-e1-04-asof-"));
  const dbPath = path.join(dir, "books.db");
  backend = await createBackend({
    dbPath,
    seedDemoData: true,
    resolveEntitlements: () => createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: {}, seats: 50, expiresAt: null }),
  });
  sqlite = openSqliteConnection(dbPath).sqlite;
  const token = backend.sessions.issue({ userId: "admin", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
}, 120_000);

afterAll(() => {
  sqlite?.close();
  backend?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const OVERRIDDEN_EVERY_MONTH = { failed: ["bank_statements", "drafts", "recurring_journals"], named: "المستندات غير المرحَّلة، كشوف البنوك، القيود المتكررة المستحقة" };
// May's VAT return is filed, so the plant asset registered after May's run can no longer be charged in May: its depreciation is overridden, and said so.
const OVERRIDDEN: Readonly<Record<string, { failed: string[]; named: string }>> = {
  "01": OVERRIDDEN_EVERY_MONTH,
  "02": OVERRIDDEN_EVERY_MONTH,
  "03": OVERRIDDEN_EVERY_MONTH,
  "04": OVERRIDDEN_EVERY_MONTH,
  "05": { failed: ["bank_statements", "depreciation", "drafts", "recurring_journals"], named: `${OVERRIDDEN_EVERY_MONTH.named}، تشغيل الإهلاك` },
};

interface SummaryRow {
  readonly overrideReason: string | null;
  readonly failedChecks: readonly string[];
  readonly sealValid: boolean;
}

async function summariesOf(month: string): Promise<SummaryRow[]> {
  const res = await request("GET", `/period-close/fp-2026-${month}/summaries`);
  expect(res.status).toBe(200);
  return (await res.json()) as SummaryRow[];
}

describe("the demo shows a guided close that works, and one that refuses for a real reason (ENH-E1-04)", () => {
  it("June and July were closed clean — every check passing, no override on the summary or in the audit trail", async () => {
    for (const month of ["06", "07"]) {
      expect(periodStatus(month)).toBe("closed");
      const res = await request("GET", `/period-close/fp-2026-${month}/checks`);
      const checklist = (await res.json()) as PeriodCloseChecklistDTO;
      expect({ month, blocking: checklist.blocking, unavailable: checklist.checks.filter((c) => c.status === PeriodCloseCheckStatusDTO.Unavailable).map((c) => c.code) }).toEqual({ month, blocking: [], unavailable: [] });
      const summaries = await summariesOf(month);
      expect(summaries.map((summary) => [summary.overrideReason, summary.failedChecks, summary.sealValid])).toEqual([[null, [], true]]);
      const audited = sqlite
        .prepare(`SELECT json_extract(details, '$.overridden') AS overridden, json_extract(details, '$.reason') AS reason FROM audit_event WHERE entity_type = 'FISCAL_PERIOD' AND entity_id = ? AND action = 'CLOSE'`)
        .all(`fp-2026-${month}`);
      expect(audited).toEqual([{ overridden: 0, reason: null }]);
    }
  });

  it("each clean month has its recurring entry posted, a depreciation run covering every asset once, and a bank statement finalized without force", () => {
    for (const month of ["06", "07"]) {
      const from = `2026-${month}-01`;
      const to = `2026-${month}-31`;
      expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM journal_entry WHERE status = 'draft' AND date BETWEEN ? AND ?`).get(from, to) as { n: number }).n).toBe(0);
      const runs = sqlite.prepare(`SELECT status, lines FROM depreciation_run WHERE period = ?`).all(`2026-${month}`) as { status: string; lines: string }[];
      const depreciated = runs.flatMap((run) => (JSON.parse(run.lines) as { assetId: string }[]).map((line) => line.assetId));
      expect(runs.map((run) => run.status)).toEqual(["posted"]);
      expect(new Set(depreciated).size).toBe(depreciated.length);
      const statements = sqlite
        .prepare(`SELECT period_start, period_end, status, finalize_override_reason, COALESCE(unmatched_at_finalize, 0) AS unmatched FROM bank_statement WHERE treasury_account_id = 'TR-DEMO-BANK' AND period_start = ?`)
        .all(from);
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatchObject({ status: "completed", finalize_override_reason: null, unmatched: 0 });
      const lines = sqlite
        .prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN l.status = 'matched' THEN 1 ELSE 0 END) AS matched FROM statement_line l JOIN bank_statement s ON s.id = l.statement_id WHERE s.treasury_account_id = 'TR-DEMO-BANK' AND s.period_start = ?`)
        .get(from) as { n: number; matched: number };
      expect(lines.n).toBeGreaterThan(0);
      expect(lines.matched).toBe(lines.n);
    }
  });

  it("January to May were closed by override, each with its stated Arabic reason and the checks it overrode", async () => {
    for (const month of ["01", "02", "03", "04", "05"]) {
      expect(periodStatus(month)).toBe("closed");
      const [latest] = await summariesOf(month);
      const expected = OVERRIDDEN[month];
      expect({ month, failed: [...(latest?.failedChecks ?? [])].sort() }).toEqual({ month, failed: expected?.failed });
      expect(latest?.overrideReason).toBe(`إقفال بتجاوز الفحوص الآتية: ${expected?.named} — بموافقة المدير المالي.`);
      expect(latest?.sealValid).toBe(true);
    }
  });

  it("July's bank statement carries a bank charge the books did not know: it was booked from the statement line, not matched to an entry written to fit it", () => {
    const created = sqlite
      .prepare(
        `SELECT l.description, l.amount, l.status, l.matched_entry_id AS entryId FROM statement_line l
          WHERE l.statement_id = 'BSTMT-DEMO-2026-07' AND l.match_source = 'created_entry'`,
      )
      .safeIntegers()
      .all() as { description: string; amount: bigint; status: string; entryId: string }[];
    expect(created.map((line) => [line.description, line.amount, line.status])).toEqual([["مصاريف خدمات بنكية", -75_000_000n, "matched"]]);
    const entry = sqlite
      .prepare(`SELECT jl.account_id AS account, jl.debit - jl.credit AS net FROM journal_line jl WHERE jl.entry_id = ? ORDER BY jl.account_id`)
      .safeIntegers()
      .all(created[0]?.entryId);
    expect(entry).toEqual([
      { account: "1310", net: -75_000_000n },
      { account: "5910", net: 75_000_000n },
    ]);
  });

  it("August is open and is refused on its real blockers; the refusal names them and leaves it open", async () => {
    expect(periodStatus("08")).toBe("open");
    const refused = await request("POST", "/fiscal-periods/fp-2026-08/close", {});
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as { error: string; message: string; failedChecks: string[] };
    expect(body.error).toBe("PERIOD_CLOSE_BLOCKED");
    expect(body.message).toContain("أغسطس 2026");
    expect([...body.failedChecks].sort()).toEqual(["bank_statements", "depreciation", "drafts", "fx_revaluation", "recurring_journals"]);
    expect(periodStatus("08")).toBe("open");
    expect(await summariesOf("08")).toEqual([]);
  });

  it("the employee who left before the first payroll run of the year is owed nothing by June's or July's run", () => {
    expect(sqlite.prepare(`SELECT status, terminated_at FROM hr_employee WHERE id = 'EMP-DEMO-9'`).get()).toEqual({ status: "terminated", terminated_at: "2026-05-31" });
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM hr_payslip WHERE employee_id = 'EMP-DEMO-9'`).get() as { n: number }).n).toBe(0);
  });
});

describe("the sub-ledgers are read as of the month end, like the ledger they are tied to (ENH-E1-04)", () => {
  beforeAll(async () => {
    for (const month of ["06", "07"]) await ok("POST", `/fiscal-periods/fp-2026-${month}/reopen`, {}, 200);
  });

  it("the demo books tie on inventory, receivables and payables at every month end of the year", async () => {
    await expectTiedEverywhere(MONTHS);
  });

  it("no stock movement of a dated document is stamped later than the day its journal entry is dated", () => {
    const late = sqlite
      .prepare(
        `SELECT m.source_doc_type AS type, m.source_doc_id AS id, substr(m.occurred_at, 1, 10) AS moved, d.date AS dated
           FROM stock_movement m JOIN framework_document d ON d.id = m.source_doc_id
          WHERE d.doc_type IN ('SALES_RETURN', 'PURCHASE_RETURN', 'LANDED_COST') AND substr(m.occurred_at, 1, 7) > substr(d.date, 1, 7)`,
      )
      .all();
    expect(late).toEqual([]);
  });

  it("a June collection reversed in July still counts at the end of June and is gone from July on", async () => {
    const voucher = sqlite
      .prepare(
        `SELECT v.id FROM voucher v
          WHERE v.status = 'confirmed' AND v.date BETWEEN '2026-06-01' AND '2026-06-30' AND v.id LIKE 'COLL:%' ORDER BY v.doc_no LIMIT 1`,
      )
      .get() as { id: string };
    const arJuneBefore = controlBalanceAt("1105", "2026-06-30");
    const arJulyBefore = controlBalanceAt("1105", "2026-07-31");

    const reversed = await ok("POST", `/vouchers/${encodeURIComponent(voucher.id)}/reverse`, { date: "2026-07-10" }, 201);
    const amount = arJulyBefore - controlBalanceAt("1105", "2026-07-31");

    expect((reversed.original as { status: string }).status).toBe("reversed");
    expect(amount).not.toBe(0n);
    expect(controlBalanceAt("1105", "2026-06-30")).toBe(arJuneBefore);
    expect(controlBalanceAt("1105", "2026-07-31")).toBe(arJulyBefore - amount);
    await expectTiedEverywhere(["06", "07", "08", "09"]);
    expect(periodStatus("06")).toBe("open");
  });

  it("a June purchase invoice cancelled in July still counts in payables and in stock at the end of June, and in neither from July on", async () => {
    await ok("POST", "/items", { id: "ASOF-ITEM-P", code: "ASOF-P", nameAr: "صنف اختبار الشراء", type: "stock", baseUnitCode: "PCS" }, 201);
    await ok(
      "POST",
      "/purchases/invoices",
      {
        id: "ASOF-PI-1", supplierId: "SUPP-DEMO-1", date: "2026-06-10", dueDate: "2026-07-10", branchId: "BR-MAIN", warehouseId: "WH-MAIN",
        lines: [{ itemId: "ASOF-ITEM-P", kind: "inventory", qty: "5", unitCost: "80", taxRatePercent: 14 }],
      },
      201,
    );
    await ok("POST", "/purchases/invoices/ASOF-PI-1/confirm", {}, 200);
    const apJune = controlBalanceAt("2100", "2026-06-30");
    const stockJune = controlBalanceAt("1200", "2026-06-30");
    await expectTiedEverywhere(["06", "07"]);

    const cancelled = await ok("POST", "/purchases/invoices/ASOF-PI-1/cancel", { date: "2026-07-10" }, 200);

    expect(cancelled.status).toBe("cancelled");
    expect(controlBalanceAt("2100", "2026-06-30")).toBe(apJune);
    expect(controlBalanceAt("1200", "2026-06-30")).toBe(stockJune);
    expect(entryEffect("ASOF-PI-1:cancel")).toEqual({ date: "2026-07-10", "2100": 456_000_000n, "1200": -400_000_000n });
    expect(sqlite.prepare(`SELECT substr(occurred_at, 1, 10) AS day, direction FROM stock_movement WHERE source_doc_id LIKE 'ASOF-PI-1%' ORDER BY seq`).all()).toEqual([
      { day: "2026-06-10", direction: "IN" },
      { day: "2026-07-10", direction: "OUT" },
    ]);
    await expectTiedEverywhere(["06", "07", "08", "09"]);
  });

  it("a June sale voided in July still counts in receivables and stays out of stock at the end of June, and is undone from July on", async () => {
    await ok("POST", "/items", { id: "ASOF-ITEM-S", code: "ASOF-S", nameAr: "صنف اختبار البيع", type: "stock", baseUnitCode: "PCS" }, 201);
    await ok(
      "POST",
      "/purchases/invoices",
      {
        id: "ASOF-PI-2", supplierId: "SUPP-DEMO-1", date: "2026-06-08", dueDate: "2026-07-08", branchId: "BR-MAIN", warehouseId: "WH-MAIN",
        lines: [{ itemId: "ASOF-ITEM-S", kind: "inventory", qty: "10", unitCost: "50", taxRatePercent: 14 }],
      },
      201,
    );
    await ok("POST", "/purchases/invoices/ASOF-PI-2/confirm", {}, 200);
    await ok(
      "POST",
      "/sales-invoices",
      {
        id: "ASOF-INV-1", date: "2026-06-12", dueDate: "2026-07-12", customerId: "CUST-DEMO-1", customerNameAr: "شركة الأمل للتجارة", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
        arAccountId: "1105", taxAccountId: "2200",
        lines: [{ lineId: "L1", itemId: "ASOF-ITEM-S", itemNameAr: "صنف اختبار البيع", isStock: true, qty: "2", unitPrice: "90.00", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }],
      },
      201,
    );
    await ok("POST", "/sales-invoices/ASOF-INV-1/confirm", {}, 200);
    const arJune = controlBalanceAt("1105", "2026-06-30");
    const stockJune = controlBalanceAt("1200", "2026-06-30");
    await expectTiedEverywhere(["06", "07"]);

    const voided = await ok("POST", "/sales-invoices/ASOF-INV-1/void", { date: "2026-07-15" }, 200);

    expect(voided.status).toBe("reversed");
    expect(controlBalanceAt("1105", "2026-06-30")).toBe(arJune);
    expect(controlBalanceAt("1200", "2026-06-30")).toBe(stockJune);
    expect(entryEffect("ASOF-INV-1:void")).toEqual({ date: "2026-07-15", "1105": -205_200_000n, "1200": 100_000_000n });
    expect(sqlite.prepare(`SELECT substr(occurred_at, 1, 10) AS day, direction FROM stock_movement WHERE source_doc_id LIKE 'ASOF-INV-1%' ORDER BY seq`).all()).toEqual([
      { day: "2026-06-12", direction: "OUT" },
      { day: "2026-07-15", direction: "IN" },
    ]);
    await expectTiedEverywhere(["06", "07", "08", "09"]);
  });

  it("a purchase invoice whose goods have already been issued is not cancelled: nothing is posted and the books still tie", async () => {
    const sold = sqlite
      .prepare(
        `SELECT pi.id FROM purchase_invoice pi
          WHERE pi.status = 'confirmed' AND pi.receipt_id IS NULL
            AND EXISTS (SELECT 1 FROM stock_movement m WHERE m.source_doc_id = pi.id)
            AND NOT EXISTS (SELECT 1 FROM cost_layer l WHERE l.source_doc_id = pi.id)
            AND NOT EXISTS (SELECT 1 FROM voucher_allocation a WHERE a.invoice_id = pi.id AND a.status = 'active')
          ORDER BY pi.id LIMIT 1`,
      )
      .get() as { id: string };
    const entriesBefore = (sqlite.prepare(`SELECT COUNT(*) AS n FROM journal_entry`).get() as { n: number }).n;

    const refused = await request("POST", `/purchases/invoices/${sold.id}/cancel`, {});

    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: string }).error).toBe("PURCHASE_ITEMS_ALREADY_CONSUMED");
    expect((sqlite.prepare(`SELECT status FROM purchase_invoice WHERE id = ?`).get(sold.id) as { status: string }).status).toBe("confirmed");
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM journal_entry`).get() as { n: number }).n).toBe(entriesBefore);
    expect(await liveDifferences()).toEqual(TIED);
  });
});

describe("a shut month takes no posting and no stock movement, whichever document asks (ENH-E1-04)", () => {
  const AUGUST_DRAFTS = [
    { name: "journal entry", table: "journal_entry", where: "", confirm: (id: string) => `/gl/journal-entries/${id}/post` },
    { name: "voucher", table: "voucher", where: "", confirm: (id: string) => `/vouchers/${id}/confirm` },
    { name: "goods receipt", table: "goods_receipt", where: "", confirm: (id: string) => `/purchases/receipts/${id}/confirm` },
    { name: "sales return", table: "framework_document", where: " AND doc_type = 'SALES_RETURN'", confirm: (id: string) => `/sales-returns/${id}/confirm` },
    { name: "purchase return", table: "framework_document", where: " AND doc_type = 'PURCHASE_RETURN'", confirm: (id: string) => `/purchase-returns/${id}/confirm` },
    { name: "landed cost", table: "framework_document", where: " AND doc_type = 'LANDED_COST'", confirm: (id: string) => `/landed-costs/${id}/confirm` },
    { name: "stock transfer", table: "stock_transfer_document", where: "", confirm: (id: string) => `/inventory/stock-transfers/${id}/confirm` },
    { name: "stock adjustment", table: "stock_adjustment_document", where: "", confirm: (id: string) => `/inventory/stock-adjustments/${id}/confirm` },
  ] as const;
  const REASON = { overrideReason: "إقفال تجريبي لاختبار منع الترحيل في الفترة" };
  const count = (table: string): number => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it.each(["closed", "locked"] as const)("no August draft confirms once August is %s, and nothing is written", async (status) => {
    if (status === "closed") {
      await ok(
        "POST",
        "/inventory/stock-adjustments/draft",
        { id: "ASOF-ADJ-AUG", date: "2026-08-20", memo: "تسوية اختبار", lines: [{ itemId: "ITEM-DEMO-1", warehouseId: "WH-MAIN", reason: "DAMAGE", direction: "OUT", qty: "1" }] },
        201,
      );
      await ok("POST", "/fiscal-periods/fp-2026-08/close", REASON, 200);
    } else {
      const controller = backend.sessions.issue({ userId: "controller", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
      const res = await backend.app.fetch(
        new Request("http://local/fiscal-periods/fp-2026-08/lock", { method: "POST", headers: { authorization: `Bearer ${controller}`, "content-type": "application/json" }, body: JSON.stringify(REASON) }),
      );
      expect(res.status).toBe(200);
    }
    expect(periodStatus("08")).toBe(status);
    const before = { movements: count("stock_movement"), entries: (sqlite.prepare(`SELECT COUNT(*) AS n FROM journal_entry WHERE status <> 'draft'`).get() as { n: number }).n };

    const answers: Record<string, unknown>[] = [];
    for (const draft of AUGUST_DRAFTS) {
      const rows = sqlite.prepare(`SELECT id FROM ${draft.table} WHERE status = 'draft' AND date BETWEEN '2026-08-01' AND '2026-08-31'${draft.where}`).all() as { id: string }[];
      expect({ name: draft.name, drafts: rows.length > 0 }).toEqual({ name: draft.name, drafts: true });
      for (const row of rows) {
        const res = await request("POST", draft.confirm(encodeURIComponent(row.id)), {});
        const body = (await res.json()) as { error?: string; message?: string; messageEn?: string };
        answers.push({ name: draft.name, status: res.status, error: body.error, arabic: body.message?.includes("أغسطس 2026") ?? false, english: body.messageEn?.includes("August 2026") ?? false });
        expect((sqlite.prepare(`SELECT status FROM ${draft.table} WHERE id = ?`).get(row.id) as { status: string }).status).toBe("draft");
      }
    }
    expect(answers.filter((a) => a.status !== 422 || a.error !== "PERIOD_NOT_OPEN_FOR_POSTING" || !a.arabic || !a.english)).toEqual([]);

    const runsBefore = count("depreciation_run");
    const run = await request("POST", "/assets/depreciation/runs", { period: "2026-08" });
    expect(run.status).toBe(422);
    expect(((await run.json()) as { error: string }).error).toBe("PERIOD_NOT_OPEN_FOR_POSTING");
    expect(count("depreciation_run")).toBe(runsBefore);

    expect(count("stock_movement")).toBe(before.movements);
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM journal_entry WHERE status <> 'draft'`).get() as { n: number }).n).toBe(before.entries);
    expect(await liveDifferences()).toEqual(TIED);
  });
});

