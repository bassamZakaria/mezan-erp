import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createAgingSuppliersReport, supplierAgingBalances, supplierAgingTotal } from "./aging-suppliers.js";
import type { PurchaseInvoice, PurchaseInvoiceLine } from "../purchasing/purchase-invoice.js";
import type { Supplier } from "../suppliers/supplier.js";

function pline(overrides: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine {
  return { itemId: "item-1", description: null, kind: "inventory", qty: Qty.fromMajor("1"), unitCost: Money.fromMajor("300.00"), taxRatePercent: 0, ...overrides };
}
function pinvoice(overrides: Partial<PurchaseInvoice> = {}): PurchaseInvoice {
  return {
    id: "pinv-1", number: "PI-1", supplierId: "sup-1", date: "2026-06-01", dueDate: "2026-06-15", supplierInvoiceNumber: null, branchId: "br-1",
    warehouseId: "wh-1", currency: "EGP", notes: null, receiptId: null, lines: [pline()], status: "confirmed", createdBy: "system", createdAt: "2026-06-01T00:00:00.000Z", ...overrides,
  };
}
function supplier(overrides: Partial<Supplier> = {}): Supplier {
  return { id: "sup-1", code: "S001", nameAr: "مورد أ", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: Money.zero(), branchId: null, active: true, addressCity: null, addressDistrict: null, addressStreet: null, bankAccount: null, ...overrides };
}

describe("createAgingSuppliersReport", () => {
  it("treats the full invoice total as outstanding (no payment tracking)", () => {
    const definition = createAgingSuppliersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-06-05" }, { invoices: [pinvoice()], suppliers: [supplier()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.current).toBe(300);
    expect(outcome.rows[0]?.total).toBe(300);
  });

  it("falls back to the invoice date when dueDate is null", () => {
    const definition = createAgingSuppliersReport("2026-08-22");
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" }, // 2026-06-01 -> 2026-08-22 = 82 days
      { invoices: [pinvoice({ dueDate: null })], suppliers: [supplier()] },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.d61to90).toBe(300);
  });

  it("excludes draft purchase invoices", () => {
    const definition = createAgingSuppliersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-08-22" }, { invoices: [pinvoice({ status: "draft" })], suppliers: [supplier()] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
  });

  it("resolves the supplier's Arabic name from ctx.suppliers", () => {
    const definition = createAgingSuppliersReport("2026-08-22");
    const outcome = runReport(definition, { asOfDate: "2026-08-22" }, { invoices: [pinvoice()], suppliers: [supplier({ nameAr: "مورد النيل" })] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.supplierNameAr).toBe("مورد النيل");
  });
});

describe("createAgingSuppliersReport — the tie to the AP control account (D112)", () => {
  const definition = createAgingSuppliersReport("2026-08-22");
  const twoInvoices = [
    pinvoice({ id: "pinv-1", supplierId: "sup-1", lines: [pline({ unitCost: Money.fromMajor("1250.50") })] }),
    pinvoice({ id: "pinv-2", supplierId: "sup-2", lines: [pline({ unitCost: Money.fromMajor("3400.00") })] }),
  ];
  const suppliers = [supplier(), supplier({ id: "sup-2", code: "S002", nameAr: "مورد ب" })];

  it("ties when the ladder and the control account hold the same NON-ZERO balance", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" },
      { invoices: twoInvoices, suppliers, payablesControlBalance: () => 4650.5 },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.reconciliation?.reportTotal).toBe(4650.5);
    expect(outcome.reconciliation?.referenceTotal).toBe(4650.5);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });

  it("flags the difference when a payment reached the GL and not the allocation sub-ledger", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-08-22" },
      { invoices: twoInvoices, suppliers, payablesControlBalance: () => 4000 },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.reconciliation?.diff).toBe(650.5);
    expect(outcome.reconciliation?.withinTolerance).toBe(false);
  });
});

describe("createAgingSuppliersReport — foreign invoices and leftover debits (D194)", () => {
  const definition = createAgingSuppliersReport("2026-08-22");

  it("ages a SAR 100 invoice booked at 13.20 at the 1,320.00 it credited 2100 with, not at 100", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-06-05" },
      { invoices: [pinvoice({ currency: "SAR", fxRate: "13.20", lines: [pline({ kind: "expense", itemId: null, unitCost: Money.fromMajor("100") })] })], suppliers: [supplier()], payablesControlBalance: () => 1320 },
    );
    if (!outcome.ok) throw new Error("report failed");
    expect(outcome.rows[0]?.total).toBe(1320);
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });

  it("keeps a payment larger than the debt on the row as a negative «جاري», so the ladder still ties", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-06-05" },
      {
        invoices: [pinvoice()],
        suppliers: [supplier(), supplier({ id: "sup-2", nameAr: "مورد ب" })],
        unappliedDebitsBySupplierId: new Map([["sup-1", Money.fromMajor("350")], ["sup-2", Money.fromMajor("40")]]),
        payablesControlBalance: () => -90,
      },
    );
    if (!outcome.ok) throw new Error("report failed");
    expect(outcome.rows.find((r) => r.supplierId === "sup-1")).toMatchObject({ current: -50, total: -50 });
    expect(outcome.rows.find((r) => r.supplierId === "sup-2")).toMatchObject({ current: -40, total: -40 });
    expect(outcome.reconciliation?.withinTolerance).toBe(true);
  });

  it("names the FX revaluation it excluded from the reference", () => {
    const outcome = runReport(
      definition,
      { asOfDate: "2026-06-05" },
      { invoices: [pinvoice()], suppliers: [supplier()], payablesControlBalance: () => 300, fxRevaluationOnControl: () => 30 },
    );
    if (!outcome.ok) throw new Error("report failed");
    expect(outcome.reconciliation?.reconcilingItems).toEqual([expect.objectContaining({ key: "fxRevaluation", amount: 30 })]);
  });
});

describe("supplierAgingBalances — balances no invoice carries (D204, D205, D210, D211)", () => {
  const params = { asOfDate: "2026-08-22", branchId: "" };
  const total = (map: ReturnType<typeof supplierAgingBalances>, id: string) => supplierAgingTotal(map.get(id)!).toString();

  it("carries the supplier's opening balance and a manual credit on 2100 as what they are owed", () => {
    const map = supplierAgingBalances(params, {
      invoices: [],
      openItems: [
        { partyId: "sup-1", source: "opening", date: "2026-01-01", amount: Money.fromMajor("1500") },
        { partyId: "sup-1", source: "journal", date: "2026-08-20", amount: Money.fromMajor("300") },
      ],
    });
    expect(total(map, "sup-1")).toBe("1800.000000");
    expect(map.get("sup-1")?.over120.toString()).toBe("1500.000000");
  });

  it("nets a manual debit on 2100 like an unallocated payment", () => {
    const map = supplierAgingBalances(params, {
      invoices: [pinvoice()],
      openItems: [{ partyId: "sup-1", source: "journal", date: "2026-08-20", amount: Money.fromMajor("-100") }],
    });
    expect(total(map, "sup-1")).toBe("200.000000");
  });

  it("keeps a return beyond what is still owed as a debit on the supplier, and a supplier refund puts it back", () => {
    const returned = supplierAgingBalances(params, {
      invoices: [pinvoice()],
      allocatedByInvoiceId: new Map([["pinv-1", Money.fromMajor("300")]]),
      returnsByInvoiceId: new Map([["pinv-1", Money.fromMajor("40")]]),
    });
    expect(total(returned, "sup-1")).toBe("-40.000000");
    const refunded = supplierAgingBalances(params, {
      invoices: [pinvoice()],
      allocatedByInvoiceId: new Map([["pinv-1", Money.fromMajor("300")]]),
      returnsByInvoiceId: new Map([["pinv-1", Money.fromMajor("40")]]),
      openItems: [{ partyId: "sup-1", source: "refund", date: "2026-08-21", amount: Money.fromMajor("40") }],
    });
    expect(total(refunded, "sup-1")).toBe("0.000000");
  });
});

describe("supplierAgingBalances — a payment dated after the snapshot does not settle it (D220)", () => {
  it("ages the bill at what it owed that day", () => {
    const map = supplierAgingBalances(
      { asOfDate: "2026-06-30", branchId: "" },
      {
        invoices: [pinvoice()],
        allocatedByInvoiceId: new Map([["pinv-1", Money.fromMajor("300")]]),
        settledAfterAsOfByInvoiceId: new Map([["pinv-1", Money.fromMajor("100")]]),
      },
    );
    expect(supplierAgingTotal(map.get("sup-1")!).toString()).toBe("100.000000");
  });
});
