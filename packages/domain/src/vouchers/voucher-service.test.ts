import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import { voucherLine } from "./voucher-document.js";

describe("VoucherService — confirm posts GL via the document framework", () => {
  it("customer collection: draft → confirmed, stamps CV- number + posts a balanced JE", async () => {
    const h = buildTestService();
    const draft = await h.service.createVoucher({
      id: "v1",
      date: "2026-08-22",
      voucherType: "customer_collection",
      amount: Money.fromMajor("250"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "1100",
      customerId: "cust-1",
    });
    expect(draft.status).toBe("draft");
    expect(draft.docNo).toBeNull();

    const { document, held } = await h.service.confirmVoucher("v1");
    expect(held).toBe(false);
    expect(document.status).toBe("confirmed");
    expect(document.docNo).toBe("CV-000001");
    expect(document.journalEntryId).not.toBeNull();

    // The cash GL account received the money.
    const bal = await h.ledger.accountBalance("1300-1");
    expect(bal.balance.toString()).toBe("250.000000");
    const ar = await h.ledger.accountBalance("1100");
    expect(ar.balance.toString()).toBe("-250.000000"); // credited
  });

  it("supplier payment (funded): debits AP, credits cash", async () => {
    const h = buildTestService();
    await h.seedCashBalance("1300-1", "1000");
    await h.service.createVoucher({
      id: "v2",
      date: "2026-08-22",
      voucherType: "supplier_payment",
      amount: Money.fromMajor("400"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "2100",
      supplierId: "sup-1",
    });
    await h.service.confirmVoucher("v2");
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("600.000000"); // 1000 - 400
    expect((await h.ledger.accountBalance("2100")).balance.toString()).toBe("400.000000"); // debited
  });

  it("inter-treasury transfer: moves balance from source to destination, net liquidity unchanged", async () => {
    const h = buildTestService();
    await h.seedCashBalance("1300-1", "500");
    await h.service.createVoucher({
      id: "v3",
      date: "2026-08-22",
      voucherType: "inter_treasury_transfer",
      amount: Money.fromMajor("60"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterTreasuryAccountId: "ta-cash2",
      counterTreasuryGlAccountId: "1300-2",
    });
    await h.service.confirmVoucher("v3");
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("440.000000");
    expect((await h.ledger.accountBalance("1300-2")).balance.toString()).toBe("60.000000");
  });

  it("gap-free CV- numbering across two confirmed vouchers", async () => {
    const h = buildTestService();
    for (const id of ["a", "b"]) {
      await h.service.createVoucher({
        id,
        date: "2026-08-22",
        voucherType: "other_income",
        amount: Money.fromMajor("10"),
        branchId: "b1",
        paymentMethod: "cash",
        treasuryAccountId: "ta-cash1",
        treasuryGlAccountId: "1300-1",
        counterpartyGlAccountId: "4900",
      });
      await h.service.confirmVoucher(id);
    }
    expect((await h.service.findById("a"))!.docNo).toBe("CV-000001");
    expect((await h.service.findById("b"))!.docNo).toBe("CV-000002");
  });

  it("reversing a confirmed voucher posts a mirror JE and marks it reversed", async () => {
    const h = buildTestService();
    await h.service.createVoucher({
      id: "v4",
      date: "2026-08-22",
      voucherType: "other_income",
      amount: Money.fromMajor("100"),
      branchId: "b1",
      paymentMethod: "cash",
      treasuryAccountId: "ta-cash1",
      treasuryGlAccountId: "1300-1",
      counterpartyGlAccountId: "4900",
    });
    await h.service.confirmVoucher("v4");
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("100.000000");

    const { original } = await h.service.reverseVoucher("v4", { reversalId: "v4-rev" });
    expect(original.status).toBe("reversed");
    // The reversing JE nets the cash account back to zero.
    expect((await h.ledger.accountBalance("1300-1")).balance.toString()).toBe("0.000000");
  });
});
