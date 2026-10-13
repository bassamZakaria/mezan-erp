import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import { NextNumberService } from "../numbering/index.js";
import { InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { InactiveTaxRateError, TaxRateNotFoundError, TaxRatePercentMismatchError, type TaxRate } from "../tax-rates/index.js";
import { buildInvoicePosting, createPurchaseInvoice, type PurchaseInvoice, type PurchaseInvoiceRepository } from "./purchase-invoice.js";
import type { PurchaseGlAccounts } from "./types.js";


class InMemoryInvoices implements Pick<PurchaseInvoiceRepository, "findById" | "create"> {
  private readonly rows = new Map<string, PurchaseInvoice>();
  async findById(id: string): Promise<PurchaseInvoice | null> {
    return this.rows.get(id) ?? null;
  }
  async create(invoice: PurchaseInvoice): Promise<void> {
    this.rows.set(invoice.id, invoice);
  }
}

const rate = (id: string, percent: number, status: TaxRate["status"] = "active"): TaxRate => ({
  id, code: id, name: id, rate: percent, calculationType: "exclusive", isDefault: false,
  outputTaxAccountId: null, inputTaxAccountId: null, etaSubType: "auto", status,
});
const MASTER = [rate("VAT14", 14), rate("EXEMPT", 0), rate("EXPORT", 0), rate("OLD5", 5, "inactive")];

const ACCOUNTS: PurchaseGlAccounts = {
  inventoryAccountId: "1300-inventory",
  taxAccountId: "1360-input-vat",
  payableAccountId: "2100-payables",
};

function deps(withMaster = true) {
  return {
    invoices: new InMemoryInvoices() as unknown as PurchaseInvoiceRepository,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    ...(withMaster ? { taxRates: { list: async () => MASTER } } : {}),
  };
}

const line = (tax: { taxRateId?: string | null; taxRatePercent?: number }) => ({
  itemId: "item-A", kind: "inventory" as const, qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("100"), ...tax,
});

const command = (lines: ReturnType<typeof line>[]) => ({
  id: "pi-1", supplierId: "sup-1", date: "2026-08-23", branchId: "MAIN", warehouseId: "WH-1", lines,
});

describe("createPurchaseInvoice — the line stores the tax rate applied (D79)", () => {
  it("reads the percent off the named rate and stores its id", async () => {
    const invoice = await createPurchaseInvoice(command([line({ taxRateId: "VAT14" }), line({ taxRateId: "EXEMPT" })]), deps());
    expect(invoice.lines.map((l) => [l.taxRateId, l.taxRatePercent])).toEqual([["VAT14", 14], ["EXEMPT", 0]]);
  });

  it("resolves a percent-only line — the shape an invoice raised from a receipt has — to the one active rate", async () => {
    const invoice = await createPurchaseInvoice(command([line({ taxRatePercent: 14 })]), deps());
    expect(invoice.lines[0]).toMatchObject({ taxRateId: "VAT14", taxRatePercent: 14 });
  });

  it("stores no id for a 0% line while two 0% rates exist", async () => {
    const invoice = await createPurchaseInvoice(command([line({ taxRatePercent: 0 })]), deps());
    expect(invoice.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 0 });
  });

  it("refuses an unknown id, a deactivated rate and a mismatched percent", async () => {
    await expect(createPurchaseInvoice(command([line({ taxRateId: "TAX-1" })]), deps())).rejects.toBeInstanceOf(TaxRateNotFoundError);
    await expect(createPurchaseInvoice(command([line({ taxRateId: "OLD5" })]), deps())).rejects.toBeInstanceOf(InactiveTaxRateError);
    await expect(createPurchaseInvoice(command([line({ taxRateId: "VAT14", taxRatePercent: 0 })]), deps())).rejects.toBeInstanceOf(TaxRatePercentMismatchError);
  });

  it("without the tax rate master wired, keeps the percent and stores no id", async () => {
    const invoice = await createPurchaseInvoice(command([line({ taxRatePercent: 14 })]), deps(false));
    expect(invoice.lines[0]).toMatchObject({ taxRateId: null, taxRatePercent: 14 });
  });

  it("posts the stored id on the input-VAT line, apart from a legacy line of the same percent", async () => {
    const invoice = await createPurchaseInvoice(command([line({ taxRateId: "VAT14" })]), deps());
    const mixed: PurchaseInvoice = { ...invoice, lines: [...invoice.lines, { ...invoice.lines[0]!, taxRateId: null }] };
    const posting = buildInvoicePosting(mixed, ACCOUNTS);
    const vat = posting.lines.filter((l) => l.accountId === ACCOUNTS.taxAccountId);
    expect(vat.map((l) => [l.taxRateId ?? null, l.taxRatePercent, l.debit.toString()])).toEqual([
      ["VAT14", 14, "14.000000"],
      [null, 14, "14.000000"],
    ]);
    const debit = Money.sum(posting.lines.map((l) => l.debit));
    const credit = Money.sum(posting.lines.map((l) => l.credit));
    expect(debit.equals(credit)).toBe(true);
  });
});
