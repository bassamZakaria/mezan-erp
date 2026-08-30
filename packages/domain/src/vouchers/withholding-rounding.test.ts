/**
 * ضريبة الخصم والتحصيل and the TAX_COMPUTATION rounding boundary.
 *
 * The withheld figure is a tax computed from a base and a rate, so it belongs
 * at the TAX_COMPUTATION boundary (money/rounding.ts) and should reach the
 * ledger quantised to the piastre. Nothing in the domain puts it there: the
 * amount arrives on the command, the voucher validates only that it is between
 * zero and the gross, and whatever arrives is posted and filed verbatim.
 */

import { describe, it, expect } from "vitest";
import { Money, roundMoney } from "../money/index.js";
import { runReport } from "../reports/engine.js";
import { createWithholdingTaxReport } from "../reports/withholding-tax.js";
import { voucherDocumentType, voucherNetPaid, type VoucherDocument, type VoucherLine } from "./voucher-document.js";

const TREASURY_GL = "1310";
const PAYABLE = "2105";
const WHT_GL = "2210";

function paymentLine(overrides: Partial<VoucherLine> = {}): VoucherLine {
  return {
    voucherType: "supplier_payment",
    direction: "payment",
    amount: Money.fromMajor("1234.56"),
    currency: "EGP",
    branchId: "BR1",
    paymentMethod: "bank",
    treasuryAccountId: "ta-bank",
    treasuryGlAccountId: TREASURY_GL,
    counterpartyGlAccountId: PAYABLE,
    counterTreasuryAccountId: null,
    counterTreasuryGlAccountId: null,
    customerId: null,
    supplierId: "sup-1",
    referenceNo: null,
    withholdingRatePercent: 3,
    withholdingGlAccountId: WHT_GL,
    ...overrides,
  };
}

function voucher(line: VoucherLine): VoucherDocument {
  return {
    id: "PV-WHT",
    docType: "TREASURY_VOUCHER",
    docNo: "PV-000031",
    date: "2026-03-10",
    memo: "",
    status: "confirmed",
    lines: [line],
    createdAt: "2026-03-10T00:00:00.000Z",
    confirmedAt: "2026-03-10T00:00:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };
}

/** 3% of 1,234.56 = 37.0368 exactly — four decimals, two of them unpayable. */
const RAW_WITHHELD = Money.fromScaled((Money.fromMajor("1234.56").scaled * 3n) / 100n);

describe("what the TAX_COMPUTATION boundary says the withheld figure should be", () => {
  it("is 37.0368 before rounding and 37.04 after, HALF_UP, on a 3% withholding of 1,234.56", () => {
    expect(RAW_WITHHELD.toString()).toBe("37.036800");
    expect(roundMoney(RAW_WITHHELD, 2).toString()).toBe("37.040000");
  });

  it("rounds the correcting entry the same way, away from zero — a reversal must be the exact negative", () => {
    expect(roundMoney(RAW_WITHHELD.negate(), 2).toString()).toBe("-37.040000");
    expect(roundMoney(RAW_WITHHELD, 2).negate().scaled).toBe(roundMoney(RAW_WITHHELD.negate(), 2).scaled);
  });

  it("rounds a withheld figure sitting exactly on the half piastre UP in both signs", () => {
    // 0.5% of 2,001.00 = 10.005 — the exact half.
    const half = Money.fromScaled((Money.fromMajor("2001.00").scaled * 5n) / 1000n);
    expect(half.toString()).toBe("10.005000");
    expect(roundMoney(half, 2).toString()).toBe("10.010000");
    expect(roundMoney(half.negate(), 2).toString()).toBe("-10.010000");
  });
});

describe("LIMITATION: the withheld figure never passes through that boundary", () => {
  it("posts the unrounded 37.0368 to 2210 and pays an unpayable 1,197.5232 out of the bank", () => {
    const doc = voucher(paymentLine({ withholdingAmount: RAW_WITHHELD }));
    expect(() => voucherDocumentType.validate?.(doc)).not.toThrow();

    const posting = voucherDocumentType.buildGlPosting!(doc, undefined)!;
    const byAccount = new Map(posting.lines.map((l) => [l.accountId, l]));

    expect(byAccount.get(PAYABLE)!.debit.toString()).toBe("1234.560000");
    expect(byAccount.get(WHT_GL)!.credit.toString()).toBe("37.036800");
    // Fractions of a piastre no bank transfer can carry.
    expect(byAccount.get(TREASURY_GL)!.credit.toString()).toBe("1197.523200");
    expect(voucherNetPaid(doc.lines[0]!).toString()).toBe("1197.523200");

    // It still BALANCES — the defect is the denomination, not the entry.
    expect(Money.sum(posting.lines.map((l) => l.debit)).scaled).toBe(Money.sum(posting.lines.map((l) => l.credit)).scaled);
  });

  it("accepts the correctly rounded figure just as readily, so nothing distinguishes the two on the books", () => {
    const doc = voucher(paymentLine({ withholdingAmount: roundMoney(RAW_WITHHELD, 2) }));
    const posting = voucherDocumentType.buildGlPosting!(doc, undefined)!;
    const byAccount = new Map(posting.lines.map((l) => [l.accountId, l]));
    expect(byAccount.get(WHT_GL)!.credit.toString()).toBe("37.040000");
    expect(byAccount.get(TREASURY_GL)!.credit.toString()).toBe("1197.520000");
  });

  it("carries the sub-piastre figure straight onto the quarterly filing and into its KPI", () => {
    const outcome = runReport(
      createWithholdingTaxReport("2026-03-01", "2026-03-31"),
      { fromDate: "2026-03-01", toDate: "2026-03-31" },
      {
        rows: [
          {
            voucherId: "PV-WHT",
            voucherNo: "PV-000031",
            date: "2026-03-10",
            partyId: "sup-1",
            partyNameAr: "مورد أ",
            grossAmount: Money.fromMajor("1234.56"),
            ratePercent: 3,
            withheldAmount: RAW_WITHHELD,
          },
        ],
      },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]!.withheldAmount).toBe(37.0368);
    expect(outcome.rows[0]!.netPaidAmount).toBe(1197.5232);
    expect(outcome.kpis.find((k) => k.key === "withheldAmount")!.value).toBe(37.0368);
  });
});
