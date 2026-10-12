import { describe, expect, it } from "vitest";
import type { DocumentRepository, FrameworkDocument } from "../documents/document.js";
import type { JournalEntry, JournalLine } from "../journal.js";
import { Money, Qty } from "../money/index.js";
import { createPurchaseReturnDocumentType, type PurchaseReturnLine } from "../purchase-returns/purchase-return-document.js";
import { createSalesReturnDocumentType, type SalesReturnLine } from "../sales-returns/sales-return-document.js";
import { TaxClassificationReturnMixedError } from "../tax-rates/classify-posted-line-tax.js";
import { createReturnTaxCarry, expectedReturnTaxJournalLines } from "./tax-carry.js";
import { createJournalTaxTagPort } from "./tax-tag.js";

const SALES = createSalesReturnDocumentType({
  accountsReceivableId: "1105", salesReturnsAccountId: "4190", outputTaxPayableAccountId: "2200", inventoryAccountId: "1200", cogsAccountId: "5100",
});
const PURCHASES = createPurchaseReturnDocumentType({
  accountsPayableId: "2100", inputTaxPayableId: "1400", inventoryAccountId: "1200", priceVarianceAccountId: "5900",
});

const salesLine = (sourceInvoiceId: string, sourceInvoiceNumber: string, unitPrice: string): SalesReturnLine => ({
  itemId: "ITEM-A", warehouseId: "WH1", customerId: "CUST-1", sourceInvoiceId, sourceInvoiceNumber, reason: "DEFECTIVE",
  availableQty: Qty.fromMajor("10"), qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor(unitPrice), unitCost: Money.zero(), taxAmount: Money.zero(),
  taxRatePercent: 0, taxRateId: null,
});

const twoInvoices = (): FrameworkDocument<SalesReturnLine> => ({
  id: "SR-TWO", docType: "SALES_RETURN", docNo: "SRT-000009", date: "2026-08-21", memo: "", status: "confirmed",
  lines: [salesLine("INV-A", "INV-000014", "100"), salesLine("INV-B", "INV-000015", "250")],
  createdAt: "2026-08-21T00:00:00.000Z", confirmedAt: "2026-08-21T00:00:00.000Z", reversesDocId: null, reversedByDocId: null, workflowRequestId: null, journalEntryId: "JE-1",
});

const journalLine = (accountId: string, debit: string, credit: string, taxRatePercent: number | null = null): JournalLine =>
  ({ accountId, debit: Money.fromMajor(debit), credit: Money.fromMajor(credit), taxRatePercent, taxRateId: null }) as unknown as JournalLine;

function world(doc: FrameworkDocument<SalesReturnLine>, journal: JournalLine[]) {
  let stored = doc;
  let entry = { id: "JE-1", date: doc.date, lines: journal } as unknown as JournalEntry;
  const tag = (indexes: readonly number[], taxRatePercent: number, taxRateId: string) => {
    entry = { ...entry, lines: entry.lines.map((line, index) => (indexes.includes(index) ? { ...line, taxRatePercent, taxRateId } : line)) };
    return indexes.length;
  };
  const ledger = {
    findById: async () => entry,
    retagUnnamedTaxRate: async (_id: string, percent: number, rateId: string) =>
      tag(entry.lines.flatMap((line, index) => (line.taxRatePercent === percent && (line.taxRateId ?? null) === null ? [index] : [])), percent, rateId),
    tagJournalLines: async (_id: string, indexes: readonly number[], percent: number, rateId: string) => tag(indexes, percent, rateId),
  };
  const returns = {
    list: async () => [stored],
    findById: async () => stored,
    nameSourcedLineTaxRate: async (_docId: string, sourceInvoiceId: string, percent: number, rateId: string) => {
      let named = 0;
      stored = {
        ...stored,
        lines: stored.lines.map((line) => {
          if (line.sourceInvoiceId !== sourceInvoiceId || line.taxRatePercent !== percent || (line.taxRateId ?? null) !== null) return line;
          named += 1;
          return { ...line, taxRateId: rateId };
        }),
      };
      return named;
    },
  } as unknown as DocumentRepository<SalesReturnLine>;
  const carry = createReturnTaxCarry({ returns, tags: createJournalTaxTagPort({ ledger }), expected: expectedReturnTaxJournalLines(SALES) });
  return { carry, journal: () => entry.lines.map((line) => [line.accountId, line.debit.toString(), line.taxRateId ?? null]), lines: () => stored.lines.map((line) => line.taxRateId ?? null) };
}

describe("a return over two invoices (D79, declared 2)", () => {
  it("posts one tagged base line per source invoice and rate, to the same totals", () => {
    const posting = SALES.buildGlPosting?.(twoInvoices());
    const returnsLines = posting?.lines.filter((line) => line.accountId === "4190").map((line) => [line.debit.toString(), line.taxRatePercent]);
    expect(returnsLines).toEqual([["100.000000", 0], ["250.000000", 0]]);
    expect(posting?.lines.find((line) => line.accountId === "1105")?.credit.toString()).toBe("350.000000");
  });

  it("does the same for a purchase return's cost-side lines", () => {
    const line = (sourceInvoiceId: string, unitCost: string): PurchaseReturnLine => ({
      itemId: "ITEM-A", warehouseId: "WH1", supplierId: "SUP-1", sourceInvoiceId, sourceInvoiceNumber: sourceInvoiceId, reason: "DEFECTIVE",
      availableQty: Qty.fromMajor("10"), qty: Qty.fromMajor("1"), unitCost: Money.fromMajor(unitCost), taxAmount: Money.zero(), taxRatePercent: 0, taxRateId: null,
    }) as PurchaseReturnLine;
    const doc = { ...twoInvoices(), docType: "PURCHASE_RETURN", lines: [line("PI-A", "100"), line("PI-B", "250")] } as unknown as FrameworkDocument<PurchaseReturnLine>;
    const posting = PURCHASES.buildGlPosting?.(doc, { valueMoved: Money.fromMajor("-350") });
    expect(posting?.lines.filter((l) => l.accountId === "1200").map((l) => l.credit.toString())).toEqual(["100.000000", "250.000000"]);
  });

  it("classifying one invoice names that invoice's journal line alone, and the other's afterwards", async () => {
    const { carry, journal, lines } = world(twoInvoices(), [journalLine("4190", "100", "0", 0), journalLine("4190", "250", "0", 0), journalLine("1105", "0", "350")]);
    const first = await carry.carry({ sourceDocumentId: "INV-A", taxRatePercent: 0, taxRateId: "EXEMPT" });
    expect(first).toEqual({ documentNumbers: ["SRT-000009"], journalLinesNamed: 1 });
    expect(journal()).toEqual([["4190", "100.000000", "EXEMPT"], ["4190", "250.000000", null], ["1105", "0.000000", null]]);
    expect(lines()).toEqual(["EXEMPT", null]);
    await carry.carry({ sourceDocumentId: "INV-B", taxRatePercent: 0, taxRateId: "EXPORT" });
    expect(journal().map((line) => line[2])).toEqual(["EXEMPT", "EXPORT", null]);
    expect(lines()).toEqual(["EXEMPT", "EXPORT"]);
  });

  it("refuses an entry posted before the split, naming both invoices and the journal action, and writes nothing", async () => {
    const { carry, journal, lines } = world(twoInvoices(), [journalLine("4190", "350", "0", 0), journalLine("1105", "0", "350")]);
    const refusal = await carry.carry({ sourceDocumentId: "INV-A", taxRatePercent: 0, taxRateId: "EXEMPT" }).then(() => null, (err: unknown) => err);
    expect(refusal).toBeInstanceOf(TaxClassificationReturnMixedError);
    const mixed = refusal as TaxClassificationReturnMixedError;
    expect(mixed.message).toContain("INV-000014");
    expect(mixed.message).toContain("INV-000015");
    expect(mixed.message).toContain("تسمية ضريبة سطر القيد");
    expect(mixed.invoiceNumbers).toEqual(["INV-000014", "INV-000015"]);
    expect(journal().map((line) => line[2])).toEqual([null, null]);
    expect(lines()).toEqual([null, null]);
  });
});
