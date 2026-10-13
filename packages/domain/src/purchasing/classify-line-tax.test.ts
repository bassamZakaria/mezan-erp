import { describe, expect, it } from "vitest";
import type { AuditEvent, AuditSink } from "../audit/index.js";
import { Money, Qty } from "../money/index.js";
import { createJournalTaxTagPort } from "../gl/tax-tag.js";
import { TaxClassificationJournalUntaggedError, TaxRateAlreadyClassifiedError, type ExpectedTaxJournalLine, type TaxRate } from "../tax-rates/index.js";
import { classifyPurchaseInvoiceLineTax, postedPurchaseAccounts } from "./classify-line-tax.js";
import type { PurchaseInvoice } from "./purchase-invoice.js";
import { InMemoryPurchaseInvoices } from "./test-helpers.js";
import { PurchaseInvoiceStatusCode } from "./types.js";

const rate = (id: string, percent: number): TaxRate => ({
  id, code: id, name: id, rate: percent, calculationType: "exclusive", isDefault: false,
  outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status: "active",
});
const MASTER = [rate("EXEMPT", 0), rate("EXPORT", 0)];

class RecordingSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  async query(): Promise<readonly AuditEvent[]> {
    return this.events;
  }
}

function alreadyClassified(reaches: () => readonly string[]) {
  const invoices = new InMemoryPurchaseInvoices();
  const invoice = {
    id: "pi-1", number: "PINV-000001", supplierId: "sup-1", date: "2026-08-23", dueDate: null, supplierInvoiceNumber: null,
    branchId: "MAIN", warehouseId: "WH-1", currency: "EGP", notes: null, receiptId: null, status: PurchaseInvoiceStatusCode.Confirmed,
    createdBy: "u", createdAt: "2026-08-23T00:00:00.000Z",
    lines: [{ itemId: "item-A", kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("100"), taxRatePercent: 0, taxRateId: "EXEMPT" }],
  } as unknown as PurchaseInvoice;
  invoices.rows.set(invoice.id, invoice);
  const audit = new RecordingSink();
  const carries: unknown[] = [];
  const deps = {
    invoices,
    audit,
    actor: "USER-1",
    taxRates: { list: async () => MASTER },
    taxDependents: {
      carry: async (request: unknown) => {
        carries.push(request);
        return { documentNumbers: reaches(), journalLinesNamed: reaches().length };
      },
    },
  };
  return { deps, audit, invoices, carries, stored: invoice };
}

describe("classifying a purchase line that already names the rate asked for (finding 13, purchase twin)", () => {
  it("audits a retry that carries the standing rate onto a return, and writes no row for a retry that reaches nothing", async () => {
    let reaches: readonly string[] = ["PRT-000009"];
    const { deps, audit, invoices, carries, stored } = alreadyClassified(() => reaches);
    const standing = await classifyPurchaseInvoiceLineTax("pi-1", { lineRef: "0", taxRateId: "EXEMPT" }, deps);
    expect([standing.plan.lineRefs, standing.plan.after.taxRateId, standing.journalLinesNamed]).toEqual([["0"], "EXEMPT", 0]);
    expect(carries).toEqual([{ sourceDocumentId: "pi-1", taxRatePercent: 0, taxRateId: "EXEMPT" }]);
    expect(invoices.rows.get("pi-1")).toBe(stored);
    const carried = audit.events.filter((e) => e.action === "CARRY_LINE_TAX");
    expect(carried.map((e) => [e.module, e.entityType, e.entityId, e.actor])).toEqual([["purchases", "PURCHASE_INVOICE", "pi-1", "USER-1"]]);
    expect(carried.map((e) => e.details)).toEqual([
      expect.objectContaining({ number: "PINV-000001", lineIds: ["0"], after: { taxRateId: "EXEMPT", taxRatePercent: 0 }, carriedToDocuments: ["PRT-000009"], carriedJournalLinesNamed: 1 }),
    ]);
    expect(audit.events.filter((e) => e.action === "CLASSIFY_LINE_TAX")).toEqual([]);

    reaches = [];
    await classifyPurchaseInvoiceLineTax("pi-1", { lineRef: "0", taxRateId: "EXEMPT" }, deps);
    expect(audit.events.filter((e) => e.action === "CARRY_LINE_TAX")).toHaveLength(1);
  });

  it("still refuses re-pointing the line to another rate, and carries nothing", async () => {
    const { deps, audit, carries } = alreadyClassified(() => ["PRT-000009"]);
    await expect(classifyPurchaseInvoiceLineTax("pi-1", { lineRef: "0", taxRateId: "EXPORT" }, deps)).rejects.toBeInstanceOf(TaxRateAlreadyClassifiedError);
    expect(carries).toEqual([]);
    expect(audit.events).toEqual([]);
  });
});

describe("an invoice posted to an account of its own — a subcontract certificate's work in progress (D79, declared 7)", () => {
  const DEFAULTS = { inventoryAccountId: "1200", payableAccountId: "2100", taxAccountId: "1400", expenseAccountId: "5910" };
  const POSTED = [
    { accountId: "1230", debit: Money.fromMajor("1000"), credit: Money.zero() },
    { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("1000") },
  ];

  function legacySubcontractInvoice() {
    const invoices = new InMemoryPurchaseInvoices();
    const invoice = {
      id: "pi-sub", number: "PINV-000077", supplierId: "sub-1", date: "2026-08-23", dueDate: null, supplierInvoiceNumber: null,
      branchId: "MAIN", warehouseId: "WH-1", currency: "EGP", notes: null, receiptId: null, status: PurchaseInvoiceStatusCode.Confirmed,
      createdBy: "u", createdAt: "2026-08-23T00:00:00.000Z",
      lines: [{ itemId: null, kind: "expense", description: "مستخلص باطن", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("1000"), taxRatePercent: 0, taxRateId: null, costCategory: "subcontract" }],
    } as unknown as PurchaseInvoice;
    invoices.rows.set(invoice.id, invoice);
    let journal = [
      { accountId: "1230", debit: Money.fromMajor("1000"), credit: Money.zero(), taxRatePercent: null as number | null, taxRateId: null as string | null },
      { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("1000"), taxRatePercent: null as number | null, taxRateId: null as string | null },
    ];
    const tags = createJournalTaxTagPort({
      ledger: {
        findById: async () => ({ id: "PI-JE:pi-sub", date: "2026-08-23", lines: journal }) as never,
        retagUnnamedTaxRate: async () => 0,
        tagJournalLines: async (_id: string, indexes: readonly number[], taxRatePercent: number, taxRateId: string) => {
          journal = journal.map((line, index) => (indexes.includes(index) ? { ...line, taxRatePercent, taxRateId } : line));
          return indexes.length;
        },
      },
    });
    const deps = {
      invoices,
      taxRates: { list: async () => MASTER },
      accounts: DEFAULTS,
      taxTags: {
        retagUnnamedTaxRate: (_id: string, percent: number, rateId: string, expected?: readonly ExpectedTaxJournalLine[]) => tags.retagUnnamedTaxRate("PI-JE:pi-sub", percent, rateId, expected),
        nameChosenLines: (_id: string, indexes: readonly number[], percent: number, rateId: string, expected: readonly ExpectedTaxJournalLine[]) =>
          tags.nameChosenLines("PI-JE:pi-sub", indexes, percent, rateId, expected),
      },
    };
    return { deps, invoices, journal: () => journal.map((line) => [line.accountId, line.taxRateId]) };
  }

  it("names the line the entry really posted, on the account it really posted to", async () => {
    const { deps, invoices, journal } = legacySubcontractInvoice();
    const classified = await classifyPurchaseInvoiceLineTax("pi-sub", { lineRef: "0", taxRateId: "EXEMPT" }, { ...deps, postedLines: async () => POSTED });
    expect(classified.journalLinesNamed).toBe(1);
    expect(journal()).toEqual([["1230", "EXEMPT"], ["2100", null]]);
    expect(invoices.rows.get("pi-sub")?.lines[0]?.taxRateId).toBe("EXEMPT");
  });

  it("without the posted entry it can only expect the default expense account, and refuses rather than leave the entry unnamed", async () => {
    const { deps, invoices, journal } = legacySubcontractInvoice();
    await expect(classifyPurchaseInvoiceLineTax("pi-sub", { lineRef: "0", taxRateId: "EXEMPT" }, deps)).rejects.toBeInstanceOf(TaxClassificationJournalUntaggedError);
    expect(journal()).toEqual([["1230", null], ["2100", null]]);
    expect(invoices.rows.get("pi-sub")?.lines[0]?.taxRateId).toBeNull();
  });

  it("reads the account an expense line posted to off the entry: the one debit account that is no default of the chain", () => {
    const posted = [
      { accountId: "1230", debit: Money.fromMajor("1000"), credit: Money.zero() },
      { accountId: "1400", debit: Money.fromMajor("140"), credit: Money.zero() },
      { accountId: "2100", debit: Money.zero(), credit: Money.fromMajor("1140") },
    ];
    expect(postedPurchaseAccounts(DEFAULTS, posted).expenseAccountId).toBe("1230");
    expect(postedPurchaseAccounts(DEFAULTS, [{ accountId: "5910", debit: Money.fromMajor("1"), credit: Money.zero() }]).expenseAccountId).toBe("5910");
    expect(postedPurchaseAccounts(DEFAULTS, [...posted, { accountId: "1240", debit: Money.fromMajor("1"), credit: Money.zero() }]).expenseAccountId).toBe("5910");
  });
});

