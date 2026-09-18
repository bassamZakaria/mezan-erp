import { describe, expect, it } from "vitest";
import type {
  ChequeDTO,
  PurchaseInvoiceDTO,
  PurchaseReturnDocumentDTO,
  SupplierDTO,
  TreasuryAccountDTO,
  VoucherDTO,
} from "@mezan/contracts";
import { supplierPayableById, treasuryBalanceById } from "./partner-balances";

const supplier = (id: string, openingBalance: string): SupplierDTO => ({ id, openingBalance }) as SupplierDTO;

const purchaseInvoice = (supplierId: string, status: string, total: string): PurchaseInvoiceDTO =>
  ({ supplierId, status, total }) as PurchaseInvoiceDTO;

const voucher = (supplierId: string, direction: string, status: string, amount: string): VoucherDTO =>
  ({ supplierId, direction, status, amount }) as VoucherDTO;

const cheque = (partyId: string, direction: string, effectiveStatus: string, amount: string): ChequeDTO =>
  ({ partyId, direction, effectiveStatus, amount }) as ChequeDTO;

const purchaseReturn = (
  status: string,
  lines: { supplierId: string; qty: string; unitCost: string; taxAmount: string }[],
): PurchaseReturnDocumentDTO => ({ status, lines }) as PurchaseReturnDocumentDTO;

describe("supplierPayableById", () => {
  it("adds confirmed purchase invoices to the opening balance", () => {
    const payable = supplierPayableById(
      [supplier("S1", "200.000000")],
      [purchaseInvoice("S1", "confirmed", "800.000000"), purchaseInvoice("S1", "draft", "500.000000")],
      [],
      [],
    );
    expect(payable.get("S1")).toBe(1000);
  });

  it("clears debt with a payment voucher and raises it with a refund receipt", () => {
    const payable = supplierPayableById(
      [supplier("S1", "0.000000")],
      [purchaseInvoice("S1", "confirmed", "1000.000000")],
      [voucher("S1", "payment", "confirmed", "300.000000"), voucher("S1", "receipt", "posted", "50.000000")],
      [],
    );
    expect(payable.get("S1")).toBe(750);
  });

  it("ignores a voucher that is neither confirmed nor posted", () => {
    const payable = supplierPayableById(
      [supplier("S1", "0.000000")],
      [purchaseInvoice("S1", "confirmed", "1000.000000")],
      [voucher("S1", "payment", "draft", "300.000000")],
      [],
    );
    expect(payable.get("S1")).toBe(1000);
  });

  it("subtracts a confirmed return at its own value including tax", () => {
    const payable = supplierPayableById(
      [supplier("S1", "0.000000")],
      [purchaseInvoice("S1", "confirmed", "1000.000000")],
      [],
      [purchaseReturn("confirmed", [{ supplierId: "S1", qty: "2", unitCost: "100.000000", taxAmount: "28.000000" }])],
    );
    expect(payable.get("S1")).toBe(772);
  });

  it("ignores a draft return", () => {
    const payable = supplierPayableById(
      [supplier("S1", "0.000000")],
      [purchaseInvoice("S1", "confirmed", "1000.000000")],
      [],
      [purchaseReturn("draft", [{ supplierId: "S1", qty: "2", unitCost: "100.000000", taxAmount: "0" }])],
    );
    expect(payable.get("S1")).toBe(1000);
  });

  it("debits an outgoing cheque the moment it is handed over, and not a bounced one", () => {
    const withCheque = supplierPayableById(
      [supplier("S1", "0.000000")],
      [purchaseInvoice("S1", "confirmed", "1000.000000")],
      [],
      [],
      [cheque("S1", "outgoing", "deposited", "400.000000")],
    );
    expect(withCheque.get("S1")).toBe(600);

    const bounced = supplierPayableById(
      [supplier("S1", "0.000000")],
      [purchaseInvoice("S1", "confirmed", "1000.000000")],
      [],
      [],
      [cheque("S1", "outgoing", "bounced", "400.000000")],
    );
    expect(bounced.get("S1")).toBe(1000);
  });

  it("ignores a voucher with no supplier on it", () => {
    const payable = supplierPayableById(
      [supplier("S1", "0.000000")],
      [purchaseInvoice("S1", "confirmed", "100.000000")],
      [{ direction: "payment", status: "confirmed", amount: "50.000000" } as VoucherDTO],
      [],
    );
    expect(payable.get("S1")).toBe(100);
  });
});

describe("treasuryBalanceById", () => {
  it("reads each account's balance from its own GL account, debit less credit", () => {
    const balance = treasuryBalanceById(
      [{ id: "T1", glAccountId: "1310" } as TreasuryAccountDTO],
      [{ accountId: "1310", debit: 141396, credit: 0 }],
    );
    expect(balance.get("T1")).toBe(141396);
  });

  it("nets a credit against a debit on the same account", () => {
    const balance = treasuryBalanceById(
      [{ id: "T1", glAccountId: "1310" } as TreasuryAccountDTO],
      [{ accountId: "1310", debit: 1000, credit: 400 }],
    );
    expect(balance.get("T1")).toBe(600);
  });

  it("reports zero for an account with no GL account behind it", () => {
    const balance = treasuryBalanceById([{ id: "T1", glAccountId: null } as TreasuryAccountDTO], []);
    expect(balance.get("T1")).toBe(0);
  });

  it("reports zero for a GL account with no movement rather than undefined", () => {
    const balance = treasuryBalanceById(
      [{ id: "T1", glAccountId: "1399" } as TreasuryAccountDTO],
      [{ accountId: "1310", debit: 500, credit: 0 }],
    );
    expect(balance.get("T1")).toBe(0);
  });

  it("never invents a balance for an account it was not given", () => {
    const balance = treasuryBalanceById([], [{ accountId: "1310", debit: 500, credit: 0 }]);
    expect(balance.size).toBe(0);
  });
});
