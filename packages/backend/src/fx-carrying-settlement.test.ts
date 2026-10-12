import { afterEach, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

afterEach(() => world?.close());

const major = (scaled: bigint) => {
  const sign = scaled < 0n ? "-" : "";
  const abs = scaled < 0n ? -scaled : scaled;
  return `${sign}${abs / 1_000_000n}.${String(abs % 1_000_000n).padStart(6, "0")}`;
};

async function ok(method: string, url: string, body?: unknown, status = 201): Promise<Record<string, unknown>> {
  const res = await world.request(method, url, body);
  expect(`${res.status} ${method} ${url}`, JSON.stringify(res.body)).toBe(`${status} ${method} ${url}`);
  return res.body;
}

async function rate(id: string, value: string, effectiveDate: string) {
  await ok("POST", "/exchange-rates", { id, currency: "USD", rate: value, effectiveDate, rateType: "standard", source: "manual" });
  await ok("POST", `/exchange-rates/${id}/approve`, {}, 200);
}

async function books() {
  world = await seededWorld({ seedDemoData: false });
  await rate("fx-booked", "48.00", "2026-08-01");
  const settings = (await world.request("GET", "/settings")).body;
  await ok("PUT", "/settings", { ...settings, multiCurrencyEnabled: true }, 200);
  await ok("POST", "/treasury-accounts", { id: "ta-cash", code: "TA-CASH", name: "الخزينة", branchId: "BR-MAIN", glAccountId: "1300-1", openingBalance: "0" });
  await ok("POST", "/vouchers", { id: "v-fund", date: "2026-08-01", voucherType: "capital_injection", amount: "500000", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "3100" });
  await ok("POST", "/vouchers/v-fund/confirm", {}, 200);
}

async function receivable() {
  await ok("POST", "/customers", { id: "cust-usd", code: "cust-usd", nameAr: "عميل بالدولار", paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
  await ok("POST", "/items", { id: "SVC-1", code: "SVC-1", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" });
  await ok("POST", "/sales-invoices", {
    id: "inv-usd", date: "2026-08-22", dueDate: "2026-09-21", customerId: "cust-usd", customerNameAr: "عميل بالدولار", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200", currency: "USD",
    lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "1000", taxRatePercent: 0, revenueAccountId: "4100" }],
  });
  await ok("POST", "/sales-invoices/inv-usd/confirm", {}, 200);
}

async function payable() {
  await ok("POST", "/suppliers", { id: "sup-usd", code: "sup-usd", nameAr: "مورد بالدولار", currency: "USD", openingBalance: "0" });
  await ok("POST", "/purchases/invoices", {
    id: "pi-usd", supplierId: "sup-usd", date: "2026-08-22", dueDate: "2026-09-21", branchId: "BR-MAIN", warehouseId: "WH-MAIN", currency: "USD",
    lines: [{ description: "خدمة بالدولار", kind: "expense", qty: "1", unitCost: "1000", taxRatePercent: 0 }],
  });
  await ok("POST", "/purchases/invoices/pi-usd/confirm", {}, 200);
}

async function revalue(closing: string) {
  await rate("fx-closing", closing, "2026-08-31");
  return String((await ok("POST", "/revaluation/post", { date: "2026-08-31", currencies: ["USD"], autoReverse: false })).entryId);
}

async function collect(id: string, amount: string, allocationId = `al-${id}`) {
  await ok("POST", "/vouchers", { id, date: "2026-09-10", voucherType: "customer_collection", amount, branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "1105", customerId: "cust-usd" });
  await ok("POST", `/vouchers/${id}/confirm`, {}, 200);
  await ok("POST", `/vouchers/${id}/allocations`, { allocationId, invoiceId: "inv-usd", amount });
}

async function pay(id: string, amount: string, allocationId = `al-${id}`) {
  await ok("POST", "/vouchers", { id, date: "2026-09-10", voucherType: "supplier_payment", amount, branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "2100", supplierId: "sup-usd" });
  await ok("POST", `/vouchers/${id}/confirm`, {}, 200);
  await ok("POST", `/vouchers/${id}/allocations`, { allocationId, invoiceId: "pi-usd", amount });
}

const fx = () => ({
  control1105: major(world.balance("1105")),
  control2100: major(world.balance("2100")),
  unrealised: major(-(world.balance("4940") + world.balance("5940"))),
  realised: major(-(world.balance("4920") + world.balance("5920"))),
});

describe("a foreign invoice settled after a revaluation that does not reverse itself", () => {
  it("receivable, gain: USD 1,000 at 48.00, restated +450, collected at 48.70 — 450 unrealised and 250 realised, 700 in all", async () => {
    await books();
    await receivable();
    await revalue("48.45");
    expect(fx()).toEqual({ control1105: "48450.000000", control2100: "0.000000", unrealised: "450.000000", realised: "0.000000" });
    await rate("fx-settle", "48.70", "2026-09-10");

    await collect("v-all", "48700");

    expect(fx()).toEqual({ control1105: "0.000000", control2100: "0.000000", unrealised: "450.000000", realised: "250.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
    const { allocations } = (await world.request("GET", "/vouchers/v-all/allocations")).body as { allocations: Record<string, unknown>[] };
    expect(allocations).toEqual([expect.objectContaining({ amount: "48700.000000", invoiceAmount: "48000.000000", revaluationShare: "450.000000", carryingAmount: "48450.000000", fxDifference: "250.000000" })]);
  });

  it("receivable, loss: restated −450 and collected at 47.30 — 450 unrealised loss and 250 realised loss", async () => {
    await books();
    await receivable();
    await revalue("47.55");
    await rate("fx-settle", "47.30", "2026-09-10");

    await collect("v-all", "47300");

    expect(fx()).toEqual({ control1105: "0.000000", control2100: "0.000000", unrealised: "-450.000000", realised: "-250.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("payable, gain: a USD 1,000 bill restated down by 450 and paid at 47.30 — 450 unrealised and 250 realised", async () => {
    await books();
    await payable();
    await revalue("47.55");
    expect(fx()).toMatchObject({ control2100: "-47550.000000", unrealised: "450.000000" });
    await rate("fx-settle", "47.30", "2026-09-10");

    await pay("v-all", "47300");

    expect(fx()).toEqual({ control1105: "0.000000", control2100: "0.000000", unrealised: "450.000000", realised: "250.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("payable, loss: restated up by 450 and paid at 48.70 — 450 unrealised loss and 250 realised loss", async () => {
    await books();
    await payable();
    await revalue("48.45");
    await rate("fx-settle", "48.70", "2026-09-10");

    await pay("v-all", "48700");

    expect(fx()).toEqual({ control1105: "0.000000", control2100: "0.000000", unrealised: "-450.000000", realised: "-250.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("in two parts: USD 400 realises 100 and leaves the item carried at 29,070; the other USD 600 realises 150 and leaves nothing", async () => {
    await books();
    await receivable();
    await revalue("48.45");
    await rate("fx-settle", "48.70", "2026-09-10");

    await collect("v-400", "19480");

    expect(fx()).toMatchObject({ control1105: "29070.000000", realised: "100.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    await collect("v-600", "29220");

    expect(fx()).toEqual({ control1105: "0.000000", control2100: "0.000000", unrealised: "450.000000", realised: "250.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("a restated invoice that is voided, and a restated bill that is cancelled, take their restatement off the control account as a realised difference the other way", async () => {
    await books();
    await receivable();
    await payable();
    await revalue("48.45");
    expect(fx()).toEqual({ control1105: "48450.000000", control2100: "-48450.000000", unrealised: "0.000000", realised: "0.000000" });

    await ok("POST", "/sales-invoices/inv-usd/void", {}, 200);
    await ok("POST", "/purchases/invoices/pi-usd/cancel", {}, 200);

    expect(fx()).toEqual({ control1105: "0.000000", control2100: "0.000000", unrealised: "0.000000", realised: "0.000000" });
    expect(world.balance("5920")).toBe(450_000_000n);
    expect(world.balance("4920")).toBe(-450_000_000n);
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });

  it("undoing the settlement puts the restatement back on the item, and settling again consumes it again", async () => {
    await books();
    await receivable();
    const runId = await revalue("48.45");
    await rate("fx-settle", "48.70", "2026-09-10");
    await collect("v-all", "48700", "al-1");

    const refused = await world.request("POST", `/revaluation/runs/${runId}/reverse`, { memo: "سبب العكس" });
    expect(`${refused.status} ${String(refused.body.error)}`).toBe("409 FX_REVALUATION_SHARE_CONSUMED");
    expect(String(refused.body.message)).toMatch(/[؀-ۿ]/);

    await ok("POST", "/allocations/al-1/reverse", {}, 200);

    expect(fx()).toEqual({ control1105: "-250.000000", control2100: "0.000000", unrealised: "450.000000", realised: "0.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);

    await ok("POST", "/vouchers/v-all/allocations", { allocationId: "al-2", invoiceId: "inv-usd", amount: "48700" });

    expect(fx()).toEqual({ control1105: "0.000000", control2100: "0.000000", unrealised: "450.000000", realised: "250.000000" });
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
