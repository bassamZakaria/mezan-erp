import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const WAREHOUSE = "WH-MAIN";
const SUPPLIER = "SUPP-DEMO-1";
const PRICE_VARIANCE_ACCOUNT = "5080";
const TODAY = new Date().toISOString().slice(0, 10);

interface Dates {
  readonly count: number;
  readonly rows: { docId: string; movedOn: string; postedOn: string[] }[];
}

const dates = async () => (await world.request("GET", "/reconciliation")).body.stockLedgerDates as unknown as Dates;

async function datedFindings(periodId: string) {
  const checks = (await world.request("GET", `/period-close/${periodId}/checks`)).body.checks as { code: string; findings: { kind: string }[] }[];
  return checks.find((check) => check.code === "subledger_ties")!.findings.filter((finding) => finding.kind === "stock_ledger_date");
}

async function ok(method: string, url: string, body: unknown, status: number): Promise<Record<string, unknown>> {
  const answer = await world.request(method, url, body);
  expect(answer.status, `${method} ${url} ${JSON.stringify(answer.body).slice(0, 300)}`).toBe(status);
  return answer.body;
}

async function item(id: string): Promise<void> {
  await ok("POST", "/items", { id, code: id, nameAr: `صنف ${id}`, type: "stock", baseUnitCode: "PCS", trackInventory: true, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }, 201);
}

async function receive(id: string, itemId: string, qty: string, unitCost: string, date: string): Promise<void> {
  await ok("POST", "/purchases/receipts", { id, supplierId: SUPPLIER, warehouseId: WAREHOUSE, date, lines: [{ itemId, qty, unitCost }] }, 201);
  await ok("POST", `/purchases/receipts/${id}/confirm`, {}, 200);
}

async function adjustOut(id: string, itemId: string, qty: string, date: string): Promise<void> {
  await ok("POST", "/inventory/stock-adjustments/draft", { id, date, lines: [{ itemId, warehouseId: WAREHOUSE, reason: "DAMAGE", direction: "OUT", qty }] }, 201);
  await ok("POST", `/inventory/stock-adjustments/${id}/confirm`, {}, 200);
}

async function bill(id: string, receiptId: string, itemId: string, qty: string, unitCost: string, date: string): Promise<void> {
  await ok("POST", "/purchases/invoices", { id, supplierId: SUPPLIER, date, dueDate: "2026-09-30", branchId: "BR-MAIN", warehouseId: WAREHOUSE, receiptId, lines: [{ itemId, kind: "inventory", qty, unitCost, taxRateId: "VAT14" }] }, 201);
  await ok("POST", `/purchases/invoices/${id}/confirm`, {}, 200);
}

const movementsOf = (docId: string) =>
  world.sqlite.prepare(`SELECT substr(occurred_at, 1, 10) AS day, value, value_delta AS valueDelta FROM stock_movement WHERE source_doc_id = ? ORDER BY occurred_at`).all(docId) as { day: string; value: number; valueDelta: number | null }[];

const postedTo = (docId: string, accountId: string) =>
  world.sqlite
    .prepare(`SELECT je.id, substr(je.date, 1, 10) AS day, jl.debit - jl.credit AS net FROM journal_line jl JOIN journal_entry je ON je.id = jl.entry_id WHERE (je.id = ? OR je.source_doc_id = ?) AND jl.account_id = ? ORDER BY je.id`)
    .all(docId, docId, accountId) as { id: string; day: string; net: number }[];

describe("a price difference billed after the received goods have left stock", () => {
  it("writes no stock movement — the whole difference is the invoice's own entry on the invoice's day, and both months still close", async () => {
    await item("PVG-A");
    await receive("PVG-A-GRN", "PVG-A", "1", "4.44", "2026-08-21");
    await adjustOut("PVG-A-ADJ", "PVG-A", "1", "2026-08-23");
    await bill("PVG-A-BILL", "PVG-A-GRN", "PVG-A", "0.25", "33.333333", "2026-08-22");

    expect(movementsOf("PVG-A-BILL")).toEqual([]);
    expect(postedTo("PVG-A-BILL", PRICE_VARIANCE_ACCOUNT).map(({ day, net }) => ({ day, net }))).toEqual([{ day: "2026-08-22", net: 7_223_333 }]);
    expect(await dates()).toEqual({ count: 0, rows: [] });
    expect(await datedFindings("fp-2026-08")).toEqual([]);
    expect(await datedFindings(`fp-${TODAY.slice(0, 7)}`)).toEqual([]);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("cannot be cancelled once the goods are gone — refused in Arabic, and the refusal writes nothing", async () => {
    const refused = await world.request("POST", "/purchases/invoices/PVG-A-BILL/cancel", {});

    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("PURCHASE_ITEMS_ALREADY_CONSUMED");
    expect(String(refused.body.message)).toMatch(/[\u0600-\u06FF]/);
    expect(world.sqlite.prepare(`SELECT COUNT(*) AS n FROM stock_movement WHERE item_id = 'PVG-A' AND qty = 0`).get()).toEqual({ n: 0 });
    expect(await dates()).toEqual({ count: 0, rows: [] });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("when part of the goods is still there, the share put on stock is a movement dated the day its own entry is", async () => {
    await item("PVG-B");
    await receive("PVG-B-GRN", "PVG-B", "2", "4.44", "2026-08-21");
    await adjustOut("PVG-B-ADJ", "PVG-B", "1", "2026-08-23");
    await bill("PVG-B-BILL", "PVG-B-GRN", "PVG-B", "2", "10", "2026-08-22");

    const moved = movementsOf("PVG-B-BILL");
    expect(moved).toHaveLength(1);
    expect(moved[0]!.value).toBeGreaterThan(0);
    expect(postedTo("PVG-B-BILL", "1200").map((line) => line.day)).toContain(moved[0]!.day);
    expect(await dates()).toEqual({ count: 0, rows: [] });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a difference put on stock that moved later is cancelled with its movement and its entry reversed on one day", async () => {
    await item("PVG-D");
    await receive("PVG-D-GRN", "PVG-D", "2", "4.44", "2026-08-21");
    await receive("PVG-D-GRN-2", "PVG-D", "1", "5", "2026-08-23");
    await bill("PVG-D-BILL", "PVG-D-GRN", "PVG-D", "2", "10", "2026-08-22");

    const moved = movementsOf("PVG-D-BILL");
    expect(moved).toHaveLength(1);
    expect(postedTo("PVG-D-BILL", "1200").map((line) => line.day)).toContain(moved[0]!.day);
    expect(await dates()).toEqual({ count: 0, rows: [] });

    await ok("POST", "/purchases/invoices/PVG-D-BILL/cancel", {}, 200);

    expect(await dates()).toEqual({ count: 0, rows: [] });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
    const position = (await world.request("GET", "/inventory/balance?itemId=PVG-D&warehouseId=WH-MAIN")).body;
    expect(position.totalValue).toBe("13.880000");
  });
});

describe("a landed cost confirmed after the goods it lands on have left stock", () => {
  it("puts nothing on stock, writes no movement, and its reversal leaves every control tied", async () => {
    await item("PVG-C");
    await receive("PVG-C-GRN", "PVG-C", "1", "4.44", "2026-08-21");
    await adjustOut("PVG-C-ADJ", "PVG-C", "1", "2026-08-22");
    const landedCost = { id: "PVG-C-LC", date: "2026-08-24", memo: "", distributionMethod: "BY_VALUE", costItems: [{ costType: "SHIPPING", description: "نقل", amount: "10" }], targets: [{ itemId: "PVG-C", warehouseId: WAREHOUSE, sourceInvoiceId: "PVG-C-GRN", sourceInvoiceNumber: null, qty: "1", unitCost: "4.44" }] };
    await ok("POST", "/landed-costs", landedCost, 201);
    await ok("POST", "/landed-costs/PVG-C-LC/confirm", {}, 200);

    expect(movementsOf("PVG-C-LC")).toEqual([]);
    expect(await dates()).toEqual({ count: 0, rows: [] });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    const reversed = await world.request("POST", "/landed-costs/PVG-C-LC/reverse", { reason: "مراجعة", memo: "مراجعة" });
    expect(reversed.status, JSON.stringify(reversed.body)).toBeLessThan(300);
    expect(await dates()).toEqual({ count: 0, rows: [] });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
