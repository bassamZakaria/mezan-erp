import { describe, expect, it } from "vitest";
import type { AuditEvent, AuditSink } from "../audit/index.js";
import { Money, Qty } from "../money/index.js";
import { TaxRateAlreadyClassifiedError, type TaxRate } from "../tax-rates/index.js";
import { classifyPurchaseInvoiceLineTax } from "./classify-line-tax.js";
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
