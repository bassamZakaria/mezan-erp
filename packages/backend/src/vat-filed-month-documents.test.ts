import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type Answer, type SeededWorld } from "./test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
  expect((await world.request("POST", "/fiscal-periods/fp-2026-05/reopen", {})).status).toBe(200);
}, 120_000);

afterAll(() => world?.close());

const DAY = "2026-05-20";
const refusedAsFiled = (answer: Answer) => `${answer.status} ${String(answer.body.error)} ${typeof answer.body.messageEn === "string" ? "en" : "no-en"}`;
const FILED = "422 VAT_PERIOD_ALREADY_FILED en";

async function voucher(id: string, body: Record<string, unknown>) {
  const created = await world.request("POST", "/vouchers", { id, date: DAY, branchId: "BR-MAIN", memo: "اختبار", amount: "1.00", paymentMethod: "cash", treasuryAccountId: "TR-DEMO-CASH", treasuryGlAccountId: "1300-1", ...body });
  if (created.status !== 201) return created;
  return world.request("POST", `/vouchers/${id}/confirm`, {});
}

describe("a month whose VAT return is filed takes no new posting, whatever the document — even while the month is open", () => {
  it("May is open and its return is filed", () => {
    expect((world.sqlite.prepare(`SELECT status FROM fiscal_period WHERE id = 'fp-2026-05'`).get() as { status: string }).status).toBe("open");
  });

  it.each([
    ["other_expense", { voucherType: "other_expense", counterpartyGlAccountId: "5910" }],
    ["other_income", { voucherType: "other_income", counterpartyGlAccountId: "4910" }],
    ["customer_collection", { voucherType: "customer_collection", customerId: "CUST-DEMO-1", counterpartyGlAccountId: "1105" }],
    ["supplier_payment", { voucherType: "supplier_payment", supplierId: "SUPP-DEMO-1", counterpartyGlAccountId: "2100" }],
    ["inter_treasury_transfer", { voucherType: "inter_treasury_transfer", counterTreasuryAccountId: "TR-DEMO-BANK", counterTreasuryGlAccountId: "1310" }],
  ])("a %s voucher", async (type, body) => {
    const before = world.count("journal_entry");
    expect(refusedAsFiled(await voucher(`VATF-${type}`, body))).toBe(FILED);
    expect(world.count("journal_entry")).toBe(before);
    expect((world.sqlite.prepare(`SELECT status FROM voucher WHERE id = ?`).get(`VATF-${type}`) as { status: string }).status).toBe("draft");
  });

  it("a manual journal", async () => {
    expect(refusedAsFiled(await world.request("POST", "/gl/journal-entries", { id: "VATF-J", date: DAY, memo: "x", lines: [{ accountId: "5910", debit: "1", credit: "0" }, { accountId: "2190", debit: "0", credit: "1" }] }))).toBe(FILED);
  });

  it("a purchase invoice", async () => {
    await world.request("POST", "/purchases/invoices", { id: "VATF-PI", supplierId: "SUPP-DEMO-1", date: DAY, dueDate: "2026-11-05", branchId: "BR-MAIN", warehouseId: "WH-MAIN", lines: [{ itemId: null, description: "خدمة", kind: "expense", qty: "1", unitCost: "5", taxRatePercent: 14 }] });
    expect(refusedAsFiled(await world.request("POST", "/purchases/invoices/VATF-PI/confirm", {}))).toBe(FILED);
  });

  it("a sales invoice", async () => {
    await world.request("POST", "/sales-invoices", {
      id: "VATF-SI", date: DAY, dueDate: "2026-11-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "L1", itemId: "ITEM-DEMO-1", itemNameAr: "صنف", isStock: true, qty: "1", unitPrice: "100", taxRatePercent: 14, revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200" }],
    });
    expect(refusedAsFiled(await world.request("POST", "/sales-invoices/VATF-SI/confirm", {}))).toBe(FILED);
  });

  it("a cheque", async () => {
    expect(refusedAsFiled(await world.request("POST", "/cheques", { id: "VATF-CH", direction: "incoming", chequeNumber: "N-VATF", bankName: "بنك", issueDate: DAY, dueDate: DAY, branchId: "BR-MAIN", partyId: "CUST-DEMO-1", counterpartyGlAccountId: "1105", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" }, amount: "5.00" }))).toBe(FILED);
  });

  it("and the books are as they were", async () => {
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
