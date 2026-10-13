import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootBackendKit, type BackendKit } from "./test-helpers/backend-kit.js";

const ARABIC = /[؀-ۿ]/;
const TODAY = "2026-08-24";
const CASHIER = ["treasury.cash_voucher.create", "treasury.cash_voucher.view", "treasury.allocation.manage", "treasury.allocation.view"];
const WRITER_ONLY = ["treasury.cash_voucher.create", "treasury.cash_voucher.view"];
const SUPERVISOR = ["treasury.cash_voucher.confirm", "treasury.cash_voucher.view"];

let kit: BackendKit;
let drawerId: string;

async function confirmedSale(id: string): Promise<void> {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId: "CUST-DEMO-1", customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
    arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId: "ITEM-DEMO-2", itemNameAr: "صنف", isStock: true, qty: "2", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect((await kit.call("POST", `/sales-invoices/${id}/confirm`, {})).status).toBe(200);
}

const draftBody = (id: string, extra: Record<string, unknown> = {}) => ({
  id, date: TODAY, voucherType: "customer_collection", amount: "100.00", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: drawerId, customerId: "CUST-DEMO-1", referenceNo: null, memo: "تحصيل الفاتورة", ...extra,
});

const remaining = async (invoiceId: string): Promise<string> => (await kit.call("GET", `/sales-invoices/${invoiceId}`)).body.remainingBalance;

beforeAll(async () => {
  kit = await bootBackendKit();
  const drawers = (await kit.call("GET", "/treasury-accounts")).body as { id: string; type: string; currency: string; status: string; branchId: string | null; glAccountId: string | null }[];
  const drawer = drawers.find((account) => account.type === "cash" && account.currency === "EGP" && account.status === "active" && account.glAccountId);
  expect(drawer, "the demo tenant has an active EGP drawer").toBeDefined();
  drawerId = drawer!.id;
  await confirmedSale("CDA-INV-1");
  await confirmedSale("CDA-INV-2");
}, 900_000);

afterAll(() => kit?.close());

describe("a draft collection that names the invoice it is for", () => {
  it("is saved carrying the intended allocation, moves no money and settles nothing yet", async () => {
    const before = await remaining("CDA-INV-1");
    const drafted = await kit.call("POST", "/vouchers", draftBody("CDA-V-1", { allocations: [{ invoiceId: "CDA-INV-1", amount: "100.00" }] }), CASHIER);

    expect(drafted.status, JSON.stringify(drafted.body).slice(0, 300)).toBe(201);
    expect(drafted.body.status).toBe("draft");
    expect(drafted.body.journalEntryId).toBeNull();
    expect(drafted.body.heldAllocations).toEqual([{ allocationId: "CDA-V-1:A1", invoiceId: "CDA-INV-1", amount: "100.000000" }]);
    expect(await remaining("CDA-INV-1")).toBe(before);
  });

  it("is applied to that invoice by whoever confirms the draft, in the same act as the posting", async () => {
    const before = BigInt((await remaining("CDA-INV-1")).replace(".", ""));
    const confirmed = await kit.call("POST", "/vouchers/CDA-V-1/confirm", {}, SUPERVISOR);

    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 300)).toBe(200);
    const voucher = (await kit.call("GET", "/vouchers/CDA-V-1")).body;
    expect(voucher.status).toBe("confirmed");
    expect(voucher.heldAllocations).toEqual([]);
    expect(BigInt((await remaining("CDA-INV-1")).replace(".", ""))).toBe(before - 100_000_000n);
    const allocations = (await kit.call("GET", "/vouchers/CDA-V-1/allocations")).body.allocations as { invoiceId: string; amount: string; status: string }[];
    expect(allocations.map((a) => [a.invoiceId, a.amount, a.status])).toEqual([["CDA-INV-1", "100.000000", "active"]]);
    const { tb, ar } = await kit.invariants();
    expect([tb, ar]).toEqual([0n, 0n]);
  });

  it("is refused to a session that may write the voucher but not allocate, and nothing is written", async () => {
    const refused = await kit.call("POST", "/vouchers", draftBody("CDA-V-2", { allocations: [{ invoiceId: "CDA-INV-2", amount: "100.00" }] }), WRITER_ONLY);

    expect(refused.status).toBe(403);
    expect(refused.body.permission).toBe("treasury.allocation.manage");
    expect(refused.body.message).toMatch(ARABIC);
    expect((await kit.call("GET", "/vouchers/CDA-V-2")).status).toBe(404);
  });

  it("is refused when it names more than the invoice still owes, in Arabic with an English twin, and nothing is written", async () => {
    const refused = await kit.call("POST", "/vouchers", draftBody("CDA-V-3", { amount: "500.00", allocations: [{ invoiceId: "CDA-INV-2", amount: "500.00" }] }), CASHIER);

    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(ARABIC);
    expect(refused.body.messageEn).toMatch(/[a-z]/);
    expect((await kit.call("GET", "/vouchers/CDA-V-3")).status).toBe(404);
  });

  it("is refused on a voucher type that settles no invoice", async () => {
    const refused = await kit.call("POST", "/vouchers", draftBody("CDA-V-4", { voucherType: "other_income", customerId: null, counterpartyGlAccountId: "4100", allocations: [{ invoiceId: "CDA-INV-2", amount: "100.00" }] }), ["*"]);

    expect(refused.status).toBe(422);
    expect((await kit.call("GET", "/vouchers/CDA-V-4")).status).toBe(404);
  });

  it("a draft that names no invoice is saved exactly as before", async () => {
    const drafted = await kit.call("POST", "/vouchers", draftBody("CDA-V-5"), WRITER_ONLY);

    expect(drafted.status).toBe(201);
    expect(drafted.body.heldAllocations).toEqual([]);
  });
});
