import { expect } from "vitest";
import { seededWorld, type SeededWorld } from "./seeded-world.js";

export enum FxSide {
  Receivable = "receivable",
  Payable = "payable",
}

export const FX_INVOICE_ID: Record<FxSide, string> = { [FxSide.Receivable]: "inv-usd", [FxSide.Payable]: "pi-usd" };
export const FX_CONTROL: Record<FxSide, string> = { [FxSide.Receivable]: "1105", [FxSide.Payable]: "2100" };
const FX_PARTY: Record<FxSide, string> = { [FxSide.Receivable]: "cust-usd", [FxSide.Payable]: "sup-usd" };

export function major(scaled: bigint): string {
  const sign = scaled < 0n ? "-" : "";
  const abs = scaled < 0n ? -scaled : scaled;
  return `${sign}${abs / 1_000_000n}.${String(abs % 1_000_000n).padStart(6, "0")}`;
}

export interface FxBooks {
  readonly world: SeededWorld;
  ok(method: string, url: string, body?: unknown, status?: number): Promise<Record<string, unknown>>;
  rate(id: string, value: string, effectiveDate: string, currency?: string): Promise<void>;
  invoice(side: FxSide, id?: string, terms?: { readonly date?: string; readonly units?: string }): Promise<void>;
  revalue(closing: string, date?: string): Promise<string>;
  voucher(side: FxSide, id: string, amount: string, extra?: Record<string, unknown>): Promise<void>;
  settle(side: FxSide, id: string, amount: string, invoiceId?: string): Promise<void>;
  cheque(side: FxSide, id: string, amount: string): Promise<void>;
  allocateCheque(side: FxSide, id: string, amount: string): Promise<void>;
  returnUnits(side: FxSide, id: string, qty: string): Promise<void>;
  voidInvoice(side: FxSide): Promise<void>;
  fx(side: FxSide): { control: string; unrealised: string; realised: string };
}

export async function openFxBooks(): Promise<FxBooks> {
  const world = await seededWorld({ seedDemoData: false });

  async function ok(method: string, url: string, body?: unknown, status = 201): Promise<Record<string, unknown>> {
    const res = await world.request(method, url, body);
    expect(`${res.status} ${method} ${url}`, JSON.stringify(res.body)).toBe(`${status} ${method} ${url}`);
    return res.body;
  }

  async function rate(id: string, value: string, effectiveDate: string, currency = "USD") {
    await ok("POST", "/exchange-rates", { id, currency, rate: value, effectiveDate, rateType: "standard", source: "manual" });
    await ok("POST", `/exchange-rates/${id}/approve`, {}, 200);
  }

  await rate("fx-booked", "48.00", "2026-08-01");
  const settings = (await world.request("GET", "/settings")).body;
  await ok("PUT", "/settings", { ...settings, multiCurrencyEnabled: true }, 200);
  await ok("POST", "/treasury-accounts", { id: "ta-cash", code: "TA-CASH", name: "الخزينة", branchId: "BR-MAIN", glAccountId: "1300-1", openingBalance: "0" });
  await ok("POST", "/treasury-accounts", { id: "ta-bank", code: "TA-BANK", name: "البنك", type: "bank", branchId: "BR-MAIN", glAccountId: "1310", openingBalance: "0" });
  await ok("POST", "/vouchers", { id: "v-fund", date: "2026-08-01", voucherType: "capital_injection", amount: "5000000", branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: "3100" });
  await ok("POST", "/vouchers/v-fund/confirm", {}, 200);
  await ok("POST", "/customers", { id: "cust-usd", code: "cust-usd", nameAr: "عميل بالدولار", paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" });
  await ok("POST", "/suppliers", { id: "sup-usd", code: "sup-usd", nameAr: "مورد بالدولار", currency: "USD", openingBalance: "0" });
  await ok("POST", "/items", { id: "SVC-1", code: "SVC-1", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" });
  await ok("POST", "/items", { id: "STK-1", code: "STK-1", nameAr: "صنف", type: "stock", baseUnitCode: "PCS", costingMethod: "WAC" });

  async function invoice(side: FxSide, id = FX_INVOICE_ID[side], terms: { readonly date?: string; readonly units?: string } = {}) {
    const date = terms.date ?? "2026-08-22";
    const qty = terms.units ?? "10";
    if (side === FxSide.Receivable) {
      await ok("POST", "/sales-invoices", {
        id, date, dueDate: "2026-09-21", customerId: "cust-usd", customerNameAr: "عميل بالدولار", warehouseId: "WH-MAIN", branchId: "BR-MAIN",
        arAccountId: "1105", taxAccountId: "2200", currency: "USD",
        lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty, unitPrice: "100", taxRatePercent: 0, revenueAccountId: "4100" }],
      });
      await ok("POST", `/sales-invoices/${id}/confirm`, {}, 200);
      return;
    }
    await ok("POST", "/purchases/invoices", {
      id, supplierId: "sup-usd", date, dueDate: "2026-09-21", branchId: "BR-MAIN", warehouseId: "WH-MAIN", currency: "USD",
      lines: [{ itemId: "STK-1", description: "صنف بالدولار", kind: "inventory", qty, unitCost: "100", taxRatePercent: 0 }],
    });
    await ok("POST", `/purchases/invoices/${id}/confirm`, {}, 200);
  }

  async function revalue(closing: string, date = "2026-08-31") {
    await rate(`fx-closing-${date}`, closing, date);
    return String((await ok("POST", "/revaluation/post", { date, currencies: ["USD"], autoReverse: false })).entryId);
  }

  async function voucher(side: FxSide, id: string, amount: string, extra: Record<string, unknown> = {}) {
    const party = side === FxSide.Receivable ? { voucherType: "customer_collection", customerId: FX_PARTY[side] } : { voucherType: "supplier_payment", supplierId: FX_PARTY[side] };
    await ok("POST", "/vouchers", { id, date: "2026-09-10", amount, branchId: "BR-MAIN", paymentMethod: "cash", treasuryAccountId: "ta-cash", treasuryGlAccountId: "1300-1", counterpartyGlAccountId: FX_CONTROL[side], ...party, ...extra });
    await ok("POST", `/vouchers/${id}/confirm`, {}, 200);
  }

  async function settle(side: FxSide, id: string, amount: string, invoiceId = FX_INVOICE_ID[side]) {
    await voucher(side, id, amount);
    await ok("POST", `/vouchers/${id}/allocations`, { allocationId: `al-${id}`, invoiceId, amount });
  }

  async function cheque(side: FxSide, id: string, amount: string) {
    const direction =
      side === FxSide.Receivable
        ? { direction: "incoming", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" } }
        : { direction: "outgoing", controlAccounts: { underCollectionAccountId: "2150", bouncedAccountId: null } };
    await ok("POST", "/cheques", { id, chequeNumber: `N-${id}`, bankName: "بنك مصر", issueDate: "2026-09-10", dueDate: "2026-09-10", branchId: "BR-MAIN", partyId: FX_PARTY[side], counterpartyGlAccountId: FX_CONTROL[side], amount, ...direction });
  }

  async function allocateCheque(side: FxSide, id: string, amount: string) {
    await ok("POST", `/cheques/${id}/allocations`, { allocationId: `al-${id}`, invoiceId: FX_INVOICE_ID[side], amount });
  }

  async function returnUnits(side: FxSide, id: string, qty: string) {
    if (side === FxSide.Receivable) {
      await ok("POST", "/sales-returns/from-invoice", { id, date: "2026-09-10", memo: "", warehouseId: "WH-MAIN", sourceInvoiceId: FX_INVOICE_ID[side], reason: "OTHER", requested: [{ itemId: "SVC-1", qty }] });
      await ok("POST", `/sales-returns/${id}/confirm`, {}, 200);
      return;
    }
    const bill = (await world.request("GET", `/purchases/invoices/${FX_INVOICE_ID[side]}`)).body;
    await ok("POST", "/purchase-returns", {
      id, date: "2026-09-10", memo: "",
      lines: [{ itemId: "STK-1", warehouseId: "WH-MAIN", supplierId: "sup-usd", sourceInvoiceId: FX_INVOICE_ID[side], sourceInvoiceNumber: String(bill.number), reason: "DEFECTIVE", availableQty: "10", qty, unitCost: "100", taxAmount: "0" }],
    });
    await ok("POST", `/purchase-returns/${id}/confirm`, {}, 200);
  }

  async function voidInvoice(side: FxSide) {
    if (side === FxSide.Receivable) await ok("POST", `/sales-invoices/${FX_INVOICE_ID[side]}/void`, {}, 200);
    else await ok("POST", `/purchases/invoices/${FX_INVOICE_ID[side]}/cancel`, {}, 200);
  }

  function fx(side: FxSide) {
    return {
      control: major(world.balance(FX_CONTROL[side])),
      unrealised: major(-(world.balance("4940") + world.balance("5940"))),
      realised: major(-(world.balance("4920") + world.balance("5920"))),
    };
  }

  return { world, ok, rate, invoice, revalue, voucher, settle, cheque, allocateCheque, returnUnits, voidInvoice, fx };
}
