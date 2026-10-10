/**
 * الإقرار الضريبي — can this system produce a VAT return you could actually
 * file, and does it tie back to the ledger?
 *
 * Everything below starts from a REAL sales invoice or a REAL credit note and
 * ends at the return, through the same posting builders the confirm path uses.
 * Nothing here hand-writes a journal entry that flatters the report.
 *
 * Three things a filed return has to survive an inspection:
 *   1. the per-rate split is the rate CHARGED, per line, never a blended average;
 *   2. the period figure is the MOVEMENT on the VAT control account over the
 *      period, not its closing balance, which carries the prior period in;
 *   3. a credit note (إشعار خصم) lands in the period it was ISSUED — netting it
 *      against the original month would restate a return already filed.
 */

import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import type { JournalEntry, JournalLine } from "../journal.js";
import { assertBalanced } from "../gl/post.js";
import { runReport } from "../reports/engine.js";
import { createVatReturnReport, vatNetPayable, type VatReturnContext, type VatReturnRow } from "../reports/vat-return.js";
import { computeInvoiceTotals } from "../sales-invoices/totals.js";
import { buildSalesInvoiceGlPosting } from "../sales-invoices/gl.js";
import type { SalesInvoice, SalesInvoiceLine } from "../sales-invoices/sales-invoice.js";
import { buildInvoicePosting } from "../purchasing/purchase-invoice.js";
import { createSalesReturnDocumentType, type SalesReturnLine } from "../sales-returns/sales-return-document.js";
import type { FrameworkDocument } from "../documents/document.js";
import type { DocumentGlPosting } from "../documents/hooks.js";

const AR = "1105";
const CASH = "1100";
const INPUT_VAT = "1400";
const AP = "2100";
const OUTPUT_VAT = "2200";
const REVENUE = "4100";
const PURCHASES = "5100";

function account(id: string, nameAr: string, type: Account["type"]): Account {
  return {
    id,
    code: id,
    nameAr,
    nameEn: id,
    type,
    naturalBalance: type === "asset" || type === "expense" ? "debit" : "credit",
    parentId: null,
    isHeader: false,
    status: "active",
  };
}

const accounts: Account[] = [
  account(CASH, "النقدية", "asset"),
  account(AR, "المدينون", "asset"),
  account(INPUT_VAT, "ض.ق.م مدخلات", "asset"),
  account(AP, "الموردون", "liability"),
  account(OUTPUT_VAT, "ض.ق.م مخرجات", "liability"),
  account(REVENUE, "المبيعات", "revenue"),
  account(PURCHASES, "مشتريات", "expense"),
];

function invoiceLine(
  lineId: string,
  qty: string,
  unitPrice: string,
  taxRatePercent: number,
): SalesInvoiceLine {
  return {
    lineId,
    itemId: lineId,
    itemNameAr: lineId,
    isStock: false,
    qty: Qty.fromMajor(qty),
    unitCode: "",
    unitFactor: 1,
    baseQty: Qty.fromMajor(qty),
    unitPrice: Money.fromMajor(unitPrice),
    discountType: "percent",
    discountPercent: 0,
    discountAmount: Money.zero(),
    taxRatePercent,
    revenueAccountId: REVENUE,
    cogsAccountId: null,
    inventoryAccountId: null,
    taxRateId: null,
    costCenterId: null,
    unitCost: null,
  };
}

function invoice(
  id: string,
  date: string,
  lines: readonly SalesInvoiceLine[],
  opts: { taxExempt?: boolean; taxInclusive?: boolean } = {},
): SalesInvoice {
  return {
    id,
    docType: "SALES_INVOICE",
    docNo: id,
    status: "confirmed",
    date,
    dueDate: date,
    customerId: "CUST-1",
    customerNameAr: "عميل",
    customerTaxExempt: opts.taxExempt ?? false,
    taxInclusive: opts.taxInclusive ?? false,
    warehouseId: "WH1",
    branchId: "BR1",
    salespersonId: null,
    salespersonNameAr: null,
    projectId: null,
    couponCode: null,
    appliedPromotion: null,
    currency: "EGP",
    notes: null,
    internalNotes: null,
    discount: { type: "percent", percent: 0 },
    arAccountId: AR,
    taxAccountId: OUTPUT_VAT,
    lines,
    amountPaid: Money.zero(),
    createdAt: `${date}T00:00:00.000Z`,
    confirmedAt: `${date}T00:00:00.000Z`,
    journalEntryId: null,
    workflowRequestId: null,
    reversesInvoiceId: null,
    reversedByInvoiceId: null,
  };
}

function postingToEntry(id: string, posting: DocumentGlPosting): JournalEntry {
  const lines: JournalLine[] = posting.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.debit,
    credit: l.credit,
    taxRatePercent: l.taxRatePercent ?? null,
  }));
  assertBalanced(lines);
  return { id, date: posting.date, memo: posting.memo, status: "posted", lines };
}

function movement(entries: readonly JournalEntry[], accountId: string, from: string, to: string): Money {
  let net = Money.zero();
  for (const entry of entries) {
    if (entry.date < from || entry.date > to) continue;
    for (const line of entry.lines) {
      if (line.accountId !== accountId) continue;
      net = net.add(line.credit).add(line.debit.negate());
    }
  }
  return net;
}

function rows(entries: readonly JournalEntry[], periodFrom: string, periodTo: string): VatReturnRow[] {
  const ctx: VatReturnContext = {
    accounts,
    journalEntries: [...entries],
    outputVatAccountId: OUTPUT_VAT,
    inputVatAccountId: INPUT_VAT,
  };
  const outcome = runReport(createVatReturnReport({ periodFrom, periodTo }), { periodFrom, periodTo }, ctx);
  if (!outcome.ok) throw new Error("the VAT return refused its own parameters");
  return [...outcome.rows];
}

function row(all: readonly VatReturnRow[], side: "output" | "input", rate: number): VatReturnRow | undefined {
  return all.find((r) => r.side === side && r.rate === rate);
}

const FEBRUARY = invoice("INV-FEB", "2026-02-20", [invoiceLine("F1", "1", "1000.00", 14)]);
const MARCH = invoice("INV-MAR", "2026-03-12", [
  invoiceLine("M1", "3", "1250.00", 14),
  invoiceLine("M2", "2", "400.00", 5),
  invoiceLine("M3", "10", "25.50", 0),
]);

function salesEntry(id: string, inv: SalesInvoice): JournalEntry {
  const totals = computeInvoiceTotals(inv.lines, inv.discount, {
    taxExempt: inv.customerTaxExempt,
    taxInclusive: inv.taxInclusive,
  });
  return postingToEntry(id, buildSalesInvoiceGlPosting(inv, totals, []));
}

function purchaseEntry(id: string, date: string, unitCost: string, taxRatePercent: number): JournalEntry {
  const posting = buildInvoicePosting(
    {
      id,
      number: id,
      supplierId: "SUP-1",
      date,
      dueDate: null,
      supplierInvoiceNumber: null,
      branchId: "BR1",
      warehouseId: "WH1",
      currency: "EGP",
      notes: null,
      receiptId: null,
      status: "confirmed",
      createdBy: "u1",
      createdAt: `${date}T00:00:00.000Z`,
      lines: [
        {
          itemId: null,
          description: "بضاعة",
          kind: "expense",
          qty: Qty.fromMajor("1"),
          unitCost: Money.fromMajor(unitCost),
          taxRatePercent,
        },
      ],
    },
    { inventoryAccountId: PURCHASES, payableAccountId: AP, taxAccountId: INPUT_VAT, expenseAccountId: PURCHASES },
  );
  return postingToEntry(id, { ...posting, sourceDocType: "PURCHASE_INVOICE" } as DocumentGlPosting);
}

function creditNoteEntry(id: string, date: string, qty: string, unitPrice: string, tax: string, rate: number): JournalEntry {
  const line: SalesReturnLine = {
    itemId: "M1",
    warehouseId: "WH1",
    customerId: "CUST-1",
    sourceInvoiceId: "INV-MAR",
    sourceInvoiceNumber: "INV-MAR",
    reason: "DEFECTIVE",
    availableQty: Qty.fromMajor("3"),
    qty: Qty.fromMajor(qty),
    unitPrice: Money.fromMajor(unitPrice),
    unitCost: Money.zero(),
    taxAmount: Money.fromMajor(tax),
    taxRatePercent: rate,
  };
  const doc: FrameworkDocument<SalesReturnLine> = {
    id,
    docType: "SALES_RETURN",
    docNo: id,
    date,
    memo: "",
    status: "confirmed",
    lines: [line],
    createdAt: `${date}T00:00:00.000Z`,
    confirmedAt: `${date}T00:00:00.000Z`,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
  };
  const type = createSalesReturnDocumentType({
    accountsReceivableId: AR,
    salesReturnsAccountId: REVENUE,
    outputTaxPayableAccountId: OUTPUT_VAT,
    inventoryAccountId: "1200",
    cogsAccountId: "5000",
  });
  type.validate?.(doc);
  return postingToEntry(id, type.buildGlPosting!(doc, undefined)!);
}

const LEDGER: JournalEntry[] = [
  salesEntry("JE-FEB", FEBRUARY),
  salesEntry("JE-MAR", MARCH),
  purchaseEntry("PI-MAR", "2026-03-18", "2000.00", 14),
  creditNoteEntry("SR-APR", "2026-04-05", "1", "1250.00", "175.00", 14),
];

describe("a filed month: the return splits by the rate CHARGED, per line", () => {
  const march = rows(LEDGER, "2026-03-01", "2026-03-31");

  it("reports one output row per rate the invoice actually charged", () => {
    expect(march.filter((r) => r.side === "output").map((r) => r.rate)).toEqual([14, 5, 0]);
    expect(row(march, "output", 14)!.base).toBe(3750);
    expect(row(march, "output", 14)!.tax).toBe(525);
    expect(row(march, "output", 5)!.base).toBe(800);
    expect(row(march, "output", 5)!.tax).toBe(40);
  });

  it("keeps a ZERO-RATED line as its own row with a real base and no tax, not folded into 14%", () => {
    const zero = row(march, "output", 0);
    expect(zero).toBeDefined();
    expect(zero!.base).toBe(255);
    expect(zero!.tax).toBe(0);
    expect(row(march, "output", 14)!.base).toBe(3750);
  });

  it("nets output against input to the figure that goes on the return", () => {
    expect(vatNetPayable(march)).toBe(285);
  });
});

describe("tying the return back to the GL VAT control accounts, at a NON-ZERO opening", () => {
  it("the output-tax side equals the periods MOVEMENT on 2200, not its closing balance", () => {
    const opening = movement(LEDGER, OUTPUT_VAT, "0000-01-01", "2026-02-28");
    const marchMovement = movement(LEDGER, OUTPUT_VAT, "2026-03-01", "2026-03-31");
    const closing = movement(LEDGER, OUTPUT_VAT, "0000-01-01", "2026-03-31");

    expect(opening.toString()).toBe("140.000000");
    expect(marchMovement.toString()).toBe("565.000000");
    expect(closing.toString()).toBe("705.000000");

    const march = rows(LEDGER, "2026-03-01", "2026-03-31");
    const outputTax = march.filter((r) => r.side === "output").reduce((sum, r) => sum + r.tax, 0);
    expect(Money.fromMajor(outputTax.toFixed(2)).toString()).toBe(marchMovement.toString());
    expect(Money.fromMajor(outputTax.toFixed(2)).toString()).not.toBe(closing.toString());
  });

  it("the input-tax side equals the periods movement on 1400", () => {
    const marchInput = movement(LEDGER, INPUT_VAT, "2026-03-01", "2026-03-31").negate();
    expect(marchInput.toString()).toBe("280.000000");
    const march = rows(LEDGER, "2026-03-01", "2026-03-31");
    const inputTax = march.filter((r) => r.side === "input").reduce((sum, r) => sum + r.tax, 0);
    expect(Money.fromMajor(inputTax.toFixed(2)).toString()).toBe(marchInput.toString());
  });
});

describe("إشعار خصم — a credit note belongs to the period it was ISSUED", () => {
  it("leaves the already-filed March return untouched", () => {
    const march = rows(LEDGER, "2026-03-01", "2026-03-31");
    expect(row(march, "output", 14)!.tax).toBe(525);
    expect(row(march, "output", 14)!.base).toBe(3750);
    expect(vatNetPayable(march)).toBe(285);
  });

  it("reduces APRIL output tax by exactly the credited VAT, as a negative row", () => {
    const april = rows(LEDGER, "2026-04-01", "2026-04-30");
    expect(row(april, "output", 14)!.base).toBe(-1250);
    expect(row(april, "output", 14)!.tax).toBe(-175);
    expect(vatNetPayable(april)).toBe(-175);
  });

  it("and the April movement on 2200 is the same 175.00 debit the return reports", () => {
    expect(movement(LEDGER, OUTPUT_VAT, "2026-04-01", "2026-04-30").toString()).toBe("-175.000000");
  });

  it("a quarter that spans both periods nets them, so nothing is lost or double-counted", () => {
    const quarter = rows(LEDGER, "2026-01-01", "2026-06-30");
    expect(row(quarter, "output", 14)!.tax).toBe(525 + 140 - 175);
    expect(row(quarter, "output", 14)!.base).toBe(3750 + 1000 - 1250);
  });
});

/**
 * DEFECT — the input side of the return reports the tax but no وعاء (taxable
 * base). buildInvoicePosting tags only its INPUT-VAT lines with taxRatePercent;
 * the expense/inventory debit that IS the base carries no rate, so the report
 * per-rate reader (ratedBuckets) skips it and the row goes out at base 0.
 *
 * The sales side does not have this hole: buildSalesInvoiceGlPosting tags the
 * revenue line with the rate too, which is why the output rows above carry a
 * real base. Filing an input row of 280.00 tax on a base of 0.00 is an
 * arithmetic impossibility on the ETA form and invites the input tax to be
 * disallowed outright.
 */
describe("DEFECT: the return input side declares tax with a zero taxable base", () => {
  it("reports 280.00 of input tax against a base of 0.00, though the purchase base was 2,000.00", () => {
    const march = rows(LEDGER, "2026-03-01", "2026-03-31");
    const input = row(march, "input", 14)!;
    expect(input.tax).toBe(280);
    expect(input.base).toBe(0);

    const purchase = LEDGER.find((e) => e.id === "PI-MAR")!;
    const base = purchase.lines.find((l) => l.accountId === PURCHASES)!;
    expect(base.debit.toString()).toBe("2000.000000");
    expect(base.taxRatePercent ?? null).toBeNull();
  });
});
