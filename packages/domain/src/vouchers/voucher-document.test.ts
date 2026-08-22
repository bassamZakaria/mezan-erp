import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InvalidDocumentError } from "../documents/errors.js";
import { voucherDocumentType, type VoucherDocument, type VoucherLine } from "./voucher-document.js";
import { getVoucherTypeDefinition, type VoucherType } from "./voucher-types.js";

function doc(partial: Partial<VoucherLine> & { voucherType: VoucherType }): VoucherDocument {
  const def = getVoucherTypeDefinition(partial.voucherType);
  const line: VoucherLine = {
    voucherType: partial.voucherType,
    direction: def.direction,
    amount: partial.amount ?? Money.fromMajor("100"),
    currency: "EGP",
    branchId: "b1",
    paymentMethod: "cash",
    treasuryAccountId: partial.treasuryAccountId ?? "ta-cash1",
    treasuryGlAccountId: partial.treasuryGlAccountId ?? "1300-1",
    counterpartyGlAccountId: partial.counterpartyGlAccountId ?? (def.direction === "transfer" ? null : "1100"),
    counterTreasuryAccountId: partial.counterTreasuryAccountId ?? (def.direction === "transfer" ? "ta-cash2" : null),
    counterTreasuryGlAccountId: partial.counterTreasuryGlAccountId ?? (def.direction === "transfer" ? "1300-2" : null),
    customerId: "customerId" in partial ? (partial.customerId ?? null) : def.requiresCustomer ? "cust-1" : null,
    supplierId: "supplierId" in partial ? (partial.supplierId ?? null) : def.requiresSupplier ? "sup-1" : null,
    referenceNo: null,
  };
  return {
    id: "v1",
    docType: "TREASURY_VOUCHER",
    docNo: "CV-000001",
    date: "2026-08-22",
    memo: "test",
    status: "draft",
    lines: [line],
    createdAt: "2026-08-22T10:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };
}

describe("voucherDocumentType.buildGlPosting", () => {
  it("receipt (customer collection): Dr treasury / Cr counterparty (AR)", () => {
    const posting = voucherDocumentType.buildGlPosting!(doc({ voucherType: "customer_collection", amount: Money.fromMajor("250") }))!;
    expect(posting.lines).toHaveLength(2);
    expect(posting.lines[0]).toMatchObject({ accountId: "1300-1" });
    expect(posting.lines[0]!.debit.toString()).toBe("250.000000");
    expect(posting.lines[1]).toMatchObject({ accountId: "1100" });
    expect(posting.lines[1]!.credit.toString()).toBe("250.000000");
  });

  it("payment (supplier payment): Dr counterparty (AP) / Cr treasury", () => {
    const posting = voucherDocumentType.buildGlPosting!(doc({ voucherType: "supplier_payment", counterpartyGlAccountId: "2100", amount: Money.fromMajor("400") }))!;
    expect(posting.lines[0]).toMatchObject({ accountId: "2100" });
    expect(posting.lines[0]!.debit.toString()).toBe("400.000000");
    expect(posting.lines[1]).toMatchObject({ accountId: "1300-1" });
    expect(posting.lines[1]!.credit.toString()).toBe("400.000000");
  });

  it("transfer: Dr destination treasury / Cr source treasury", () => {
    const posting = voucherDocumentType.buildGlPosting!(doc({ voucherType: "inter_treasury_transfer", amount: Money.fromMajor("60") }))!;
    expect(posting.lines[0]).toMatchObject({ accountId: "1300-2" });
    expect(posting.lines[0]!.debit.toString()).toBe("60.000000");
    expect(posting.lines[1]).toMatchObject({ accountId: "1300-1" });
    expect(posting.lines[1]!.credit.toString()).toBe("60.000000");
  });

  it("other income: Dr treasury / Cr income account", () => {
    const posting = voucherDocumentType.buildGlPosting!(doc({ voucherType: "other_income", counterpartyGlAccountId: "4900" }))!;
    expect(posting.lines[0]!.accountId).toBe("1300-1");
    expect(posting.lines[1]!.accountId).toBe("4900");
  });

  it("every voucher type produces a balanced 2-line posting", () => {
    for (const def of [
      "customer_collection", "supplier_payment", "customer_refund", "customer_advance",
      "supplier_refund", "other_income", "other_expense", "capital_injection",
      "capital_withdrawal", "tax_payment", "inter_treasury_transfer",
    ] as VoucherType[]) {
      const posting = voucherDocumentType.buildGlPosting!(doc({ voucherType: def }))!;
      const debit = Money.sum(posting.lines.map((l) => l.debit));
      const credit = Money.sum(posting.lines.map((l) => l.credit));
      expect(debit.equals(credit), `${def} balanced`).toBe(true);
      expect(debit.toString()).toBe("100.000000");
    }
  });
});

describe("voucherDocumentType.validate", () => {
  it("rejects a non-positive amount", () => {
    expect(() => voucherDocumentType.validate!(doc({ voucherType: "other_income", amount: Money.zero() }))).toThrow(InvalidDocumentError);
  });

  it("requires a customer for a customer collection", () => {
    expect(() => voucherDocumentType.validate!(doc({ voucherType: "customer_collection", customerId: null }))).toThrow(/عميل/);
  });

  it("requires a supplier for a supplier payment", () => {
    expect(() => voucherDocumentType.validate!(doc({ voucherType: "supplier_payment", supplierId: null }))).toThrow(/مورّد/);
  });

  it("rejects a transfer to the same treasury", () => {
    expect(() =>
      voucherDocumentType.validate!(doc({ voucherType: "inter_treasury_transfer", counterTreasuryAccountId: "ta-cash1", counterTreasuryGlAccountId: "1300-1" })),
    ).toThrow(/نفس الخزينة/);
  });

  it("accepts a valid voucher", () => {
    expect(() => voucherDocumentType.validate!(doc({ voucherType: "customer_collection" }))).not.toThrow();
  });
});

describe("voucherDocumentType.describeEffects", () => {
  it("is never blocked and reports the amount on both sides", () => {
    const effects = voucherDocumentType.describeEffects(doc({ voucherType: "other_income", amount: Money.fromMajor("100") }));
    expect(effects.blocked).toBe(false);
    expect(effects.balanced).toBe(true);
    expect(effects.effects.length).toBeGreaterThanOrEqual(2);
  });
});
