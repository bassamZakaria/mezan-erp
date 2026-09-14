import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { InvalidDocumentError } from "../documents/errors.js";
import { voucherDocumentType, voucherNetPaid, type VoucherDocument, type VoucherLine } from "./voucher-document.js";
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
    ...(partial.costCenterId === undefined ? {} : { costCenterId: partial.costCenterId }),
    ...(partial.projectId === undefined
      ? def.requiresProject
        ? { projectId: "proj-1" }
        : {}
      : { projectId: partial.projectId }),
    ...(partial.costCategory === undefined ? {} : { costCategory: partial.costCategory }),
    ...(partial.withholdingAmount === undefined ? {} : { withholdingAmount: partial.withholdingAmount }),
    ...(partial.withholdingRatePercent === undefined ? {} : { withholdingRatePercent: partial.withholdingRatePercent }),
    ...(partial.withholdingGlAccountId === undefined ? {} : { withholdingGlAccountId: partial.withholdingGlAccountId }),
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

  it("tags projectId on every line and costCategory only on the counterparty line", () => {
    const posting = voucherDocumentType.buildGlPosting!(
      doc({
        voucherType: "other_expense",
        counterpartyGlAccountId: "5900",
        amount: Money.fromMajor("300"),
        projectId: "proj-1",
        costCategory: "materials",
      }),
    )!;
    expect(posting.lines).toHaveLength(2);
    const counter = posting.lines.find((l) => l.accountId === "5900")!;
    const treasury = posting.lines.find((l) => l.accountId === "1300-1")!;
    expect(counter.projectId).toBe("proj-1");
    expect(counter.costCategory).toBe("materials");
    expect(treasury.projectId).toBe("proj-1");
    expect(treasury.costCategory ?? null).toBeNull();
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

  it("requires a project for a customer advance from a contracting customer — it cannot be recovered from a certificate later without one", () => {
    expect(() =>
      voucherDocumentType.validate!(doc({ voucherType: "customer_advance", projectId: null })),
    ).toThrow(/مشروع/);
  });

  it("accepts a customer advance that names its project", () => {
    expect(() =>
      voucherDocumentType.validate!(doc({ voucherType: "customer_advance", projectId: "proj-1" })),
    ).not.toThrow();
  });

  it("refuses a costCategory with no projectId, on a type that does not otherwise require a project", () => {
    expect(() =>
      voucherDocumentType.validate!(doc({ voucherType: "other_expense", projectId: null, costCategory: "materials" })),
    ).toThrow(/مشروع/);
  });

  it("accepts a costCategory paired with a projectId", () => {
    expect(() =>
      voucherDocumentType.validate!(doc({ voucherType: "other_expense", projectId: "proj-1", costCategory: "materials" })),
    ).not.toThrow();
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

describe("withholding tax on a payment voucher (خصم وتحصيل)", () => {
  const validate = (document: VoucherDocument) => voucherDocumentType.validate?.(document);

  const withheldPayment = (overrides: Partial<VoucherLine> = {}) =>
    doc({
      voucherType: "supplier_payment",
      counterpartyGlAccountId: "2100",
      amount: Money.fromMajor("1000"),
      withholdingAmount: Money.fromMajor("30"),
      withholdingRatePercent: 3,
      withholdingGlAccountId: "2180",
      ...overrides,
    } as Partial<VoucherLine> & { voucherType: VoucherType });

  it("posts three lines: the supplier discharged in full, the treasury paying the net, the tax withheld", () => {
    const posting = voucherDocumentType.buildGlPosting!(withheldPayment())!;

    const byAccount = new Map(posting.lines.map((l) => [l.accountId, l]));
    // The supplier's account is cleared for the WHOLE invoice — the withheld
    // tax discharges the debt just as the cash does.
    expect(byAccount.get("2100")?.debit.toString()).toBe("1000.000000");
    // Only the net actually leaves the treasury.
    expect(byAccount.get("1300-1")?.credit.toString()).toBe("970.000000");
    // The withheld tax becomes a liability owed to the authority.
    expect(byAccount.get("2180")?.credit.toString()).toBe("30.000000");
    expect(posting.lines).toHaveLength(3);
  });

  it("balances to the micro-unit", () => {
    const posting = voucherDocumentType.buildGlPosting!(withheldPayment())!;
    const debit = posting.lines.reduce((sum, l) => sum + l.debit.scaled, 0n);
    const credit = posting.lines.reduce((sum, l) => sum + l.credit.scaled, 0n);
    expect(debit).toBe(credit);
    expect(debit).toBe(1_000_000_000n);
  });

  it("posts the ordinary two lines when nothing is withheld", () => {
    const posting = voucherDocumentType.buildGlPosting!(
      doc({ voucherType: "supplier_payment", counterpartyGlAccountId: "2100", amount: Money.fromMajor("1000") }),
    )!;
    expect(posting.lines).toHaveLength(2);
    expect(posting.lines.some((l) => l.accountId === "2180")).toBe(false);
  });

  it("nets an odd amount exactly, with no piastre lost to the split", () => {
    const posting = voucherDocumentType.buildGlPosting!(
      withheldPayment({ amount: Money.fromMajor("1234.567891"), withholdingAmount: Money.fromMajor("37.037037") }),
    )!;
    const byAccount = new Map(posting.lines.map((l) => [l.accountId, l]));
    expect(byAccount.get("1300-1")?.credit.toString()).toBe("1197.530854");
    expect(
      (byAccount.get("1300-1")?.credit.scaled ?? 0n) + (byAccount.get("2180")?.credit.scaled ?? 0n),
    ).toBe(byAccount.get("2100")?.debit.scaled);
  });

  it("reports what actually leaves the treasury", () => {
    const line = withheldPayment().lines[0] as VoucherLine;
    expect(voucherNetPaid(line).toString()).toBe("970.000000");

    const plain = doc({ voucherType: "supplier_payment", counterpartyGlAccountId: "2100", amount: Money.fromMajor("1000") })
      .lines[0] as VoucherLine;
    expect(voucherNetPaid(plain).toString()).toBe("1000.000000");
  });

  it("refuses withholding on anything but a payment", () => {
    expect(() =>
      validate(
        withheldPayment({ voucherType: "customer_collection", counterpartyGlAccountId: "1100" } as never),
      ),
    ).toThrow(InvalidDocumentError);
  });

  it("refuses a withheld amount that is not smaller than the voucher", () => {
    for (const withholdingAmount of [Money.fromMajor("1000"), Money.fromMajor("1000.000001")]) {
      expect(() => validate(withheldPayment({ withholdingAmount }))).toThrow(
        InvalidDocumentError,
      );
    }
    // One micro-unit under the voucher is the last legal value.
    expect(() =>
      validate(withheldPayment({ withholdingAmount: Money.fromMajor("999.999999") })),
    ).not.toThrow();
  });

  it("refuses a negative withheld amount", () => {
    expect(() =>
      validate(withheldPayment({ withholdingAmount: Money.fromMajor("-1") })),
    ).toThrow(InvalidDocumentError);
  });

  it("refuses withholding with no account to book it to", () => {
    expect(() => validate(withheldPayment({ withholdingGlAccountId: null }))).toThrow(
      InvalidDocumentError,
    );
  });

  it("refuses in Arabic, which is what the voucher screen shows", () => {
    try {
      validate(withheldPayment({ withholdingGlAccountId: null }));
      throw new Error("expected the voucher to be refused");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidDocumentError);
      expect(/[؀-ۿ]/.test((error as Error).message)).toBe(true);
    }
  });

  it("LIMITATION: the rate is decorative — nothing checks the withheld amount against amount × rate", () => {
    // 3% of 1000 is 30.00, but 999.00 is accepted just as readily with the
    // same rate recorded beside it. The rate travels for the certificate and
    // the report; it is not a check.
    const inconsistent = withheldPayment({ withholdingAmount: Money.fromMajor("999"), withholdingRatePercent: 3 });
    expect(() => validate(inconsistent)).not.toThrow();

    const posting = voucherDocumentType.buildGlPosting!(inconsistent)!;
    const byAccount = new Map(posting.lines.map((l) => [l.accountId, l]));
    expect(byAccount.get("2180")?.credit.toString()).toBe("999.000000");
    expect(byAccount.get("1300-1")?.credit.toString()).toBe("1.000000");
  });
});
