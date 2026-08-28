import type {
  ChequeDTO,
  CustomerDTO,
  PurchaseInvoiceDTO,
  PurchaseReturnDocumentDTO,
  SupplierDTO,
  TreasuryAccountDTO,
  VoucherDTO,
} from "@mezan/contracts";
import type { SalesInvoiceDTO } from "../data/hooks";

/**
 * Live balances for the list screens.
 *
 * Every one of these existed only as an *opening* balance on its list — the
 * suppliers list reported 0.00 payable against 150,867.60 of confirmed invoices,
 * the treasury list reported 0.00 cash with ten confirmed vouchers posted, and a
 * customer's remaining credit ignored every invoice they had been billed
 * (D39/D40/D41). The detail screens already built the right figure in their
 * statement tabs; these helpers put the same arithmetic on the lists.
 *
 * Amounts are summed as numbers because they are display aggregates fed to
 * `<Money>` — the authoritative arithmetic stays in the domain, on `Money`.
 */

function num(value: string | null | undefined): number {
  return Number(value ?? "0");
}

const VOUCHER_SETTLED: ReadonlySet<string> = new Set(["confirmed", "posted"]);

/**
 * What each customer still owes: their opening balance plus what is left on
 * every live invoice, less the cheques they have handed over. `remainingBalance`
 * is the server's own figure, already net of collections and confirmed returns.
 *
 * The cheque term is the twin of the supplier one below, and was missing here.
 * An incoming cheque credits AR the moment it is received — leaving it out
 * overstates what the customer owes by exactly the cheques in hand, which for a
 * distribution business is most of the balance. A bounced cheque puts the debt
 * back, so it is excluded.
 */
export function customerOwedById(
  customers: readonly CustomerDTO[],
  invoices: readonly SalesInvoiceDTO[],
  cheques: readonly ChequeDTO[] = [],
): Map<string, number> {
  const owed = new Map<string, number>();
  for (const c of customers) owed.set(c.id, num(c.openingBalance));
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.status === "cancelled") continue;
    owed.set(inv.customerId, (owed.get(inv.customerId) ?? 0) + num(inv.remainingBalance));
  }
  for (const cheque of cheques) {
    if (cheque.direction !== "incoming" || cheque.effectiveStatus === "bounced") continue;
    owed.set(cheque.partyId, (owed.get(cheque.partyId) ?? 0) - num(cheque.amount));
  }
  return owed;
}

/**
 * What each supplier is still owed: opening balance plus confirmed purchase
 * invoices, less confirmed payments made to them and confirmed returns sent
 * back. Purchase invoices carry no `amountPaid` of their own (see
 * `docs/reference-parity/03-purchases.md` P-2), so payments are read from the
 * vouchers that name the supplier.
 */
export function supplierPayableById(
  suppliers: readonly SupplierDTO[],
  invoices: readonly PurchaseInvoiceDTO[],
  vouchers: readonly VoucherDTO[],
  returns: readonly PurchaseReturnDocumentDTO[],
  cheques: readonly ChequeDTO[] = [],
): Map<string, number> {
  const payable = new Map<string, number>();
  for (const s of suppliers) payable.set(s.id, num(s.openingBalance));

  for (const inv of invoices) {
    if (inv.status !== "confirmed") continue;
    payable.set(inv.supplierId, (payable.get(inv.supplierId) ?? 0) + num(inv.total));
  }

  for (const v of vouchers) {
    if (!v.supplierId || !VOUCHER_SETTLED.has(v.status)) continue;
    // A payment to the supplier clears debt; a refund from them raises it again.
    const sign = v.direction === "payment" ? -1 : v.direction === "receipt" ? 1 : 0;
    if (sign === 0) continue;
    payable.set(v.supplierId, (payable.get(v.supplierId) ?? 0) + sign * num(v.amount));
  }

  for (const doc of returns) {
    if (doc.status !== "confirmed") continue;
    for (const line of doc.lines) {
      const value = num(line.qty) * num(line.unitCost) + num(line.taxAmount);
      payable.set(line.supplierId, (payable.get(line.supplierId) ?? 0) - value);
    }
  }

  // An outgoing cheque debits AP the moment it is handed over — leaving it out
  // overstated the payable by exactly the cheques issued (5,800.00 on the demo
  // tenant). A bounced cheque puts the debt back.
  for (const cheque of cheques) {
    if (cheque.direction !== "outgoing" || cheque.effectiveStatus === "bounced") continue;
    payable.set(cheque.partyId, (payable.get(cheque.partyId) ?? 0) - num(cheque.amount));
  }
  return payable;
}

/**
 * Each treasury account's live balance, read from **its own GL account** in the
 * trial balance rather than re-derived from vouchers.
 *
 * Deriving it from vouchers was measurably wrong: vouchers alone put the bank
 * account at −107,504.00 while GL 1310 stood at +141,396.00, because cheques,
 * van settlements and the opening import also post to treasury accounts. A cash
 * box's balance IS its ledger account; anything else is a second opinion that
 * will drift.
 */
export function treasuryBalanceById(
  accounts: readonly TreasuryAccountDTO[],
  trialBalance: readonly { accountId: string; debit: number; credit: number }[],
): Map<string, number> {
  const byAccount = new Map<string, number>();
  for (const row of trialBalance) byAccount.set(row.accountId, row.debit - row.credit);

  const balance = new Map<string, number>();
  for (const a of accounts) balance.set(a.id, a.glAccountId ? (byAccount.get(a.glAccountId) ?? 0) : 0);
  return balance;
}
