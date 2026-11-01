import { AccountStatusCode, AccountTypeCode, VoucherPaymentMethodCode, VoucherTypeCode } from "@mezan/contracts";
import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import { buildTestService } from "./test-helpers/build-test-service.js";
import type { AllocatableInvoice } from "./allocation.js";
import type { CreateVoucherCommand } from "./voucher-service.js";
import { voucherLine, voucherNetPaid } from "./voucher-document.js";
import { allocationStoodOn } from "./allocation.js";
import { transferCommissionApplies } from "./transfer-commission.js";

const AR = "1100";
const BANK = "1310";
const COMMISSION = "5910";

function invoice(id: string, total: string): AllocatableInvoice {
  return { id, invoiceNo: id.toUpperCase(), kind: "sales", partyId: "cust-1", date: "2026-08-10", total: Money.fromMajor(total), allocated: Money.zero() };
}

function collection(o: Partial<CreateVoucherCommand> = {}): CreateVoucherCommand {
  return {
    id: "vc",
    date: "2026-08-22",
    voucherType: "customer_collection",
    amount: Money.fromMajor("1000"),
    branchId: "b1",
    paymentMethod: "bank",
    treasuryAccountId: "ta-bank1",
    treasuryGlAccountId: BANK,
    counterpartyGlAccountId: AR,
    customerId: "cust-1",
    commissionAmount: Money.fromMajor("15"),
    commissionGlAccountId: COMMISSION,
    ...o,
  };
}

async function balance(h: ReturnType<typeof buildTestService>, accountId: string): Promise<string> {
  return (await h.ledger.accountBalance(accountId)).balance.toString();
}

describe("transfer commission on a customer collection (#115)", () => {
  it("posts Dr bank net + Dr commission = Cr AR gross, and the invoice closes on the gross", async () => {
    const h = buildTestService({ invoices: [invoice("inv1", "1000")] });
    await h.seedCashBalance(AR, "1000.00");
    const result = await h.service.createConfirmAndAllocate(collection(), [{ allocationId: "al1", invoiceId: "inv1" }]);

    const entry = await h.ledger.findById("vc");
    expect(entry?.status).toBe("posted");
    const lines = entry!.lines.map((l) => [l.accountId, l.debit.toString(), l.credit.toString()]);
    expect(lines).toEqual([
      [BANK, "985.000000", "0.000000"],
      [COMMISSION, "15.000000", "0.000000"],
      [AR, "0.000000", "1000.000000"],
    ]);
    const debits = entry!.lines.reduce((s, l) => s + l.debit.scaled, 0n);
    const credits = entry!.lines.reduce((s, l) => s + l.credit.scaled, 0n);
    expect(debits).toBe(credits);

    expect(result.allocations.map((a) => a.amount.toString())).toEqual(["1000.000000"]);
    expect((await h.invoices.findById("inv1"))!.allocated.toString()).toBe("1000.000000");
    expect(await balance(h, AR)).toBe("0.000000");
    expect(await balance(h, BANK)).toBe("985.000000");
    expect(voucherNetPaid(voucherLine(result.document)).toString()).toBe("985.000000");
  });

  it("reversal mirrors the commission line and reopens the invoice", async () => {
    const h = buildTestService({ invoices: [invoice("inv1", "1000")] });
    await h.service.createConfirmAndAllocate(collection(), [{ allocationId: "al1", invoiceId: "inv1" }]);
    await h.service.reverseVoucher("vc", { reversalId: "vc-rev" });

    for (const account of [AR, BANK, COMMISSION]) expect(await balance(h, account)).toBe("0.000000");
    expect((await h.invoices.findById("inv1"))!.allocated.toString()).toBe("0.000000");
  });

  it.each([
    ["a commission as large as the collection", { commissionAmount: Money.fromMajor("1000") }, "أقل من قيمة التحصيل"],
    ["a negative commission", { commissionAmount: Money.fromMajor("-1") }, "أكبر من صفر"],
    ["a commission with no expense account", { commissionGlAccountId: null }, "حساب مصروف عمولة التحويل مطلوب"],
    ["a commission on a supplier payment", { voucherType: "supplier_payment", counterpartyGlAccountId: "2100", customerId: null, supplierId: "sup-1" }, "سندات تحصيل العملاء"],
    ["a commission on a cheque collection", { paymentMethod: "cheque" }, "بشيك"],
    ["a commission on a cash collection", { paymentMethod: "cash" }, "نقدي"],
    ["a commission posted to a liability", { commissionGlAccountId: "2100" }, "حساب مصروفات"],
  ] as const)("refuses %s", async (_label, override, message) => {
    const h = buildTestService();
    await expect(
      (async () => {
        await h.service.createVoucher(collection(override as Partial<CreateVoucherCommand>));
        await h.service.confirmVoucher("vc");
      })(),
    ).rejects.toThrow(message);
    expect(await h.ledger.findById("vc")).toBeNull();
  });
});

describe("the commission account is re-checked at confirm (#115)", () => {
  it.each([
    ["deactivated", { status: AccountStatusCode.Inactive }],
    ["turned into a header", { isHeader: true }],
    ["retyped away from expense", { type: AccountTypeCode.Liability }],
  ])("refuses a confirm when the account was %s after the draft", async (_label, change) => {
    const h = buildTestService();
    await h.seedCashBalance(AR, "1000.00");
    await h.service.createVoucher(collection());
    h.accountsById.set(COMMISSION, { ...h.accountsById.get(COMMISSION)!, ...change });
    await expect(h.service.confirmVoucher("vc")).rejects.toThrow("حساب مصروفات فرعياً نشطاً");
    expect(await h.ledger.findById("vc")).toBeNull();
  });
});

describe("where a transfer commission applies (#115)", () => {
  it("is a customer collection by bank, card or wallet only", () => {
    expect(transferCommissionApplies(VoucherTypeCode.CustomerCollection, VoucherPaymentMethodCode.Bank)).toBe(true);
    expect(transferCommissionApplies(VoucherTypeCode.CustomerCollection, VoucherPaymentMethodCode.Wallet)).toBe(true);
    expect(transferCommissionApplies(VoucherTypeCode.CustomerCollection, VoucherPaymentMethodCode.Card)).toBe(true);
    expect(transferCommissionApplies(VoucherTypeCode.CustomerCollection, VoucherPaymentMethodCode.Cash)).toBe(false);
    expect(transferCommissionApplies(VoucherTypeCode.CustomerCollection, VoucherPaymentMethodCode.Cheque)).toBe(false);
    expect(transferCommissionApplies(VoucherTypeCode.SupplierPayment, VoucherPaymentMethodCode.Bank)).toBe(false);
  });
});

describe("an allocation as it stood on a day (#117)", () => {
  const made = { status: "active" as const, date: "2026-08-10", createdAt: "2026-08-10T09:00:00.000Z", reversedOn: null, reversedAt: null };
  it("counts an allocation from the day it took effect", () => {
    expect(allocationStoodOn(made, "2026-08-09")).toBe(false);
    expect(allocationStoodOn(made, "2026-08-10")).toBe(true);
  });
  it("still counts one undone after the day, and not one undone by it", () => {
    const undone = { ...made, status: "reversed" as const, reversedOn: "2026-09-05", reversedAt: "2026-09-05T10:00:00.000Z" };
    expect(allocationStoodOn(undone, "2026-08-31")).toBe(true);
    expect(allocationStoodOn(undone, "2026-09-05")).toBe(false);
  });
});
