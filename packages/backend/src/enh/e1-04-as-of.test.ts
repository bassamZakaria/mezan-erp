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

describe("the sub-ledgers are read as of the month end, like the ledger they are tied to (ENH-E1-04)", () => {
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
