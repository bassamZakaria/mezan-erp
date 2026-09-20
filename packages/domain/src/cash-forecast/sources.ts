import { Money } from "../money/index.js";
import { salesInvoiceBaseGrandTotal, salesInvoiceTotals } from "../sales-invoices/totals.js";
import { SALES_INVOICE_ACTIVE_STATUSES } from "../sales-invoices/sales-invoice.js";
import { purchaseInvoiceBaseTotal } from "../purchasing/purchase-invoice.js";
import type { AgingCustomersContext } from "../reports/aging-customers.js";
import type { AgingSuppliersContext } from "../reports/aging-suppliers.js";
import type { AgingOpenItem } from "../reports/aging-open-items.js";
import type { InstallmentPlanDocument } from "../installments/installment-plan-document.js";
import type { Cheque } from "../cheques/cheque.js";
import {
  CashFlowDirection,
  CashForecastSourceKind,
  type CashCommitment,
  type CashForecastItem,
} from "./types.js";

interface OpenPiece {
  readonly id: string;
  readonly kind: CashForecastSourceKind;
  readonly partyId: string;
  readonly dueDate: string;
  readonly reference: string | null;
  readonly documentId: string | null;
  readonly currency: string | null;
  readonly branchId: string | null;
  readonly detail: string | null;
  remaining: bigint;
}

interface PartyNames {
  readonly ar: Map<string, string>;
  readonly en: Map<string, string | null>;
}

function namesOf(parties: readonly { readonly id: string; readonly nameAr?: string; readonly nameEn: string | null }[] | undefined): PartyNames {
  const ar = new Map<string, string>();
  const en = new Map<string, string | null>();
  for (const party of parties ?? []) {
    if (party.nameAr) ar.set(party.id, party.nameAr);
    en.set(party.id, party.nameEn ?? null);
  }
  return { ar, en };
}

function drawDownOldestFirst(pieces: OpenPiece[], credit: bigint): void {
  let left = credit;
  const ordered = [...pieces].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
  for (const piece of ordered) {
    if (left <= 0n) return;
    const taken = piece.remaining < left ? piece.remaining : left;
    piece.remaining -= taken;
    left -= taken;
  }
}

function netByParty(pieces: OpenPiece[], credits: ReadonlyMap<string, bigint>): OpenPiece[] {
  const byParty = new Map<string, OpenPiece[]>();
  for (const piece of pieces) {
    const list = byParty.get(piece.partyId) ?? [];
    list.push(piece);
    byParty.set(piece.partyId, list);
  }
  for (const [partyId, credit] of credits) {
    const list = byParty.get(partyId);
    if (list && credit > 0n) drawDownOldestFirst(list, credit);
  }
  return pieces.filter((piece) => piece.remaining > 0n);
}

function openItemPieces(
  items: readonly AgingOpenItem[] | undefined,
  asOfDate: string,
  kind: CashForecastSourceKind,
  addCredit: (partyId: string, scaled: bigint) => void,
): OpenPiece[] {
  const pieces: OpenPiece[] = [];
  (items ?? []).forEach((item, index) => {
    if (item.date > asOfDate) return;
    if (item.amount.scaled < 0n) {
      addCredit(item.partyId, -item.amount.scaled);
      return;
    }
    if (item.amount.scaled === 0n) return;
    pieces.push({
      id: `${kind}:${item.source}:${item.partyId}:${item.reference ?? item.date}:${index}`,
      kind,
      partyId: item.partyId,
      dueDate: item.dueDate ?? item.date,
      reference: item.reference ?? null,
      documentId: null,
      currency: null,
      branchId: item.branchId ?? null,
      detail: item.source,
      remaining: item.amount.scaled,
    });
  });
  return pieces;
}

function toItems(pieces: readonly OpenPiece[], direction: CashFlowDirection, names: PartyNames): CashForecastItem[] {
  return pieces.map((piece) => ({
    id: piece.id,
    kind: piece.kind,
    direction,
    dueDate: piece.dueDate,
    amount: Money.fromScaled(piece.remaining),
    partyId: piece.partyId,
    partyName: names.ar.get(piece.partyId) ?? null,
    partyNameEn: names.en.get(piece.partyId) ?? null,
    reference: piece.reference,
    documentId: piece.documentId,
    currency: piece.currency,
    branchId: piece.branchId,
    detail: piece.detail,
  }));
}

function splitIntoInstallments(pieces: OpenPiece[], plans: readonly InstallmentPlanDocument[]): OpenPiece[] {
  const planByInvoice = new Map<string, InstallmentPlanDocument>();
  for (const plan of plans) {
    if (plan.status !== "confirmed" || plan.reversesDocId || plan.reversedByDocId) continue;
    const invoiceId = plan.lines[0]?.sourceInvoiceId;
    if (invoiceId) planByInvoice.set(invoiceId, plan);
  }
  const out: OpenPiece[] = [];
  for (const piece of pieces) {
    const plan = piece.kind === CashForecastSourceKind.Receivable && piece.documentId ? planByInvoice.get(piece.documentId) : undefined;
    if (!plan) {
      out.push(piece);
      continue;
    }
    const unpaid = plan.lines
      .filter((line) => line.status !== "paid" && line.status !== "cancelled")
      .map((line) => ({ line, open: line.amount.scaled - line.paidAmount.scaled }))
      .filter((entry) => entry.open > 0n)
      .sort((a, b) => (a.line.dueDate < b.line.dueDate ? -1 : a.line.dueDate > b.line.dueDate ? 1 : a.line.no - b.line.no));
    let left = piece.remaining;
    const scheduled: OpenPiece[] = [];
    for (let i = unpaid.length - 1; i >= 0 && left > 0n; i -= 1) {
      const entry = unpaid[i]!;
      const taken = entry.open < left ? entry.open : left;
      left -= taken;
      scheduled.unshift({
        ...piece,
        id: `${piece.id}:installment:${entry.line.no}`,
        kind: CashForecastSourceKind.Installment,
        dueDate: entry.line.dueDate,
        detail: `${plan.docNo ?? plan.id} #${entry.line.no}`,
        remaining: taken,
      });
    }
    if (left > 0n) out.push({ ...piece, remaining: left });
    out.push(...scheduled);
  }
  return out;
}

export interface ReceivableSourcesInput {
  readonly asOfDate: string;
  readonly aging: AgingCustomersContext;
  readonly installmentPlans?: readonly InstallmentPlanDocument[];
}

export function receivableForecastItems(input: ReceivableSourcesInput): CashForecastItem[] {
  const { asOfDate, aging } = input;
  const credits = new Map<string, bigint>();
  const addCredit = (partyId: string, scaled: bigint) => credits.set(partyId, (credits.get(partyId) ?? 0n) + scaled);
  const pieces: OpenPiece[] = [];
  for (const invoice of aging.invoices) {
    if (!SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) continue;
    if (invoice.date > asOfDate) continue;
    const total = salesInvoiceBaseGrandTotal(salesInvoiceTotals(invoice), invoice.fxRate);
    const allocated = aging.allocatedByInvoiceId?.get(invoice.id)?.scaled ?? 0n;
    const settledNow = allocated > invoice.amountPaid.scaled ? allocated : invoice.amountPaid.scaled;
    const later = aging.settledAfterAsOfByInvoiceId?.get(invoice.id)?.scaled ?? 0n;
    const settled = settledNow > later ? settledNow - later : 0n;
    const returned = aging.returnsByInvoiceId?.get(invoice.id)?.scaled ?? 0n;
    const balance = total.scaled - settled - returned;
    if (balance < 0n) addCredit(invoice.customerId, -balance);
    if (balance <= 0n) continue;
    pieces.push({
      id: `${CashForecastSourceKind.Receivable}:${invoice.id}`,
      kind: CashForecastSourceKind.Receivable,
      partyId: invoice.customerId,
      dueDate: invoice.dueDate,
      reference: invoice.docNo ?? invoice.id,
      documentId: invoice.id,
      currency: invoice.fxRate ? invoice.currency : null,
      branchId: invoice.branchId ?? null,
      detail: null,
      remaining: balance,
    });
  }
  for (const [customerId, credit] of aging.unappliedCreditsByCustomerId ?? []) {
    if (credit.scaled > 0n) addCredit(customerId, credit.scaled);
  }
  pieces.push(...openItemPieces(aging.openItems, asOfDate, CashForecastSourceKind.ReceivableOther, addCredit));
  const netted = netByParty(pieces, credits);
  const names = namesOf(aging.customers);
  for (const invoice of aging.invoices) {
    if (!names.ar.has(invoice.customerId)) names.ar.set(invoice.customerId, invoice.customerNameAr);
  }
  return toItems(splitIntoInstallments(netted, input.installmentPlans ?? []), CashFlowDirection.Inflow, names);
}

export interface PayableSourcesInput {
  readonly asOfDate: string;
  readonly aging: AgingSuppliersContext;
}

export function payableForecastItems(input: PayableSourcesInput): CashForecastItem[] {
  const { asOfDate, aging } = input;
  const debits = new Map<string, bigint>();
  const addDebit = (partyId: string, scaled: bigint) => debits.set(partyId, (debits.get(partyId) ?? 0n) + scaled);
  const pieces: OpenPiece[] = [];
  for (const invoice of aging.invoices) {
    if (invoice.status !== "confirmed") continue;
    if (invoice.date > asOfDate) continue;
    const allocatedNow = aging.allocatedByInvoiceId?.get(invoice.id)?.scaled ?? 0n;
    const later = aging.settledAfterAsOfByInvoiceId?.get(invoice.id)?.scaled ?? 0n;
    const allocated = allocatedNow > later ? allocatedNow - later : 0n;
    const returned = aging.returnsByInvoiceId?.get(invoice.id)?.scaled ?? 0n;
    const outstanding = purchaseInvoiceBaseTotal(invoice).scaled - allocated - returned;
    if (outstanding < 0n) addDebit(invoice.supplierId, -outstanding);
    if (outstanding <= 0n) continue;
    pieces.push({
      id: `${CashForecastSourceKind.Payable}:${invoice.id}`,
      kind: CashForecastSourceKind.Payable,
      partyId: invoice.supplierId,
      dueDate: invoice.dueDate ?? invoice.date,
      reference: invoice.number,
      documentId: invoice.id,
      currency: invoice.fxRate ? invoice.currency : null,
      branchId: invoice.branchId ?? null,
      detail: invoice.supplierInvoiceNumber,
      remaining: outstanding,
    });
  }
  for (const [supplierId, debit] of aging.unappliedDebitsBySupplierId ?? []) {
    if (debit.scaled > 0n) addDebit(supplierId, debit.scaled);
  }
  pieces.push(...openItemPieces(aging.openItems, asOfDate, CashForecastSourceKind.PayableOther, addDebit));
  return toItems(netByParty(pieces, debits), CashFlowDirection.Outflow, namesOf(aging.suppliers));
}

export const OPEN_CHEQUE_STATUSES: ReadonlySet<Cheque["status"]> = new Set(["pending", "deposited"]);

export interface ChequeForecastSource {
  readonly cheque: Cheque;
  readonly baseAmount: Money;
  readonly partyName: string | null;
  readonly partyNameEn: string | null;
}

export function chequeForecastItems(sources: readonly ChequeForecastSource[]): CashForecastItem[] {
  const items: CashForecastItem[] = [];
  for (const { cheque, baseAmount, partyName, partyNameEn } of sources) {
    if (!OPEN_CHEQUE_STATUSES.has(cheque.status)) continue;
    if (baseAmount.scaled <= 0n) continue;
    const incoming = cheque.direction === "incoming";
    items.push({
      id: `cheque:${cheque.id}`,
      kind: incoming ? CashForecastSourceKind.ChequeIncoming : CashForecastSourceKind.ChequeOutgoing,
      direction: incoming ? CashFlowDirection.Inflow : CashFlowDirection.Outflow,
      dueDate: cheque.dueDate,
      amount: baseAmount,
      partyId: cheque.partyId,
      partyName,
      partyNameEn,
      reference: cheque.chequeNumber,
      documentId: cheque.id,
      currency: cheque.currency,
      branchId: cheque.branchId ?? null,
      detail: cheque.bankName,
    });
  }
  return items;
}

export function commitmentForecastItems(sourceId: string, commitments: readonly CashCommitment[]): CashForecastItem[] {
  return commitments
    .filter((commitment) => commitment.amount.scaled > 0n)
    .map((commitment) => ({
      id: `commitment:${sourceId}:${commitment.id}`,
      kind: CashForecastSourceKind.Commitment,
      direction: commitment.direction,
      dueDate: commitment.date,
      amount: commitment.amount,
      partyId: null,
      partyName: commitment.label,
      partyNameEn: null,
      reference: commitment.reference ?? null,
      documentId: commitment.documentId ?? null,
      currency: null,
      branchId: commitment.branchId ?? null,
      detail: sourceId,
    }));
}
