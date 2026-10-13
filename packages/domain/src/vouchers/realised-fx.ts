/**
 * فروق العملة المحققة — realised exchange differences (IAS 21 ¶28, D221).
 *
 * A foreign invoice is booked at the rate of its own date. When money settles
 * it at another rate, the allocation relieves the invoice of what it was booked
 * at, and the difference between that and what the money was worth in base is
 * a gain or a loss in the period the settlement happened — posted here, at the
 * moment the money is matched to the invoice, as QuickBooks and Odoo both do.
 *
 * The same entry moves the settled money off the party's control account in
 * the currency its own line carried (none, for base money) and relieves the
 * invoice's foreign position at the rate it was booked at, so FX revaluation
 * sees the foreign amount close whatever currency paid it (D260). Both control
 * lines name the party; they net to the difference.
 */

import { Money } from "../money/index.js";
import { postJournalEntry, reverseJournalEntry, type JournalLineInput, type JournalPostingDeps } from "../gl/index.js";
import { laterDay, type AllocatableInvoice, type SettlementRates, type SettlementSplit, type VoucherAllocation } from "./allocation.js";
import type { AllocationInvoiceKind } from "./voucher-types.js";

/** `sourceDocType` of a realised-FX entry and, through the mirror, of its reversal. The ladders skip these lines by it. */
export const FX_REALISED_DOC_TYPE = "FX_REALISED";

/**
 * Memo on the gain or loss line of a realised-FX entry. Entries posted before
 * D260 also carry it on their single control line, which FX revaluation reads
 * as base only; it must not change.
 */
export const FX_REALISED_LINE_MEMO = "فروق عملة محققة";

/** Memo on the two control-account lines of a settlement entry (D260); FX revaluation reads their foreign amounts. */
export const FX_SETTLEMENT_LINE_MEMO = "تسوية فاتورة بعملة أجنبية";

/** INVARIANT: the revaluation's own memo — FX revaluation reads such a line as base only, and the aging ladders net it against the restatement it relieves. */
export const FX_REVALUATION_SHARE_MEMO = "إعادة تقييم عملات أجنبية";

/** What a settlement needs to know about rates and where the difference goes. */
export interface RealisedFxPort {
  /** The currency and rate a foreign invoice was booked at; null for a base-currency one. */
  invoiceFx(invoiceId: string, kind: AllocationInvoiceKind): Promise<{ currency: string; fxRate: string } | null>;
  /** The approved rate for `currency` on `date` (on or before it), or null. */
  rateOn(currency: string, date: string): Promise<string | null>;
  /** Where a realised difference posts, read at each posting so a tenant's account routing applies at once (D229). */
  differenceAccounts(): Promise<FxDifferenceAccounts>;
  revaluationShare?(invoice: AllocatableInvoice): Promise<Money>;
  moneyRevaluationShare?(voucherId: string): Promise<Money>;
  releaseMoneyShare?(voucherId: string, date: string): Promise<void>;
  treasuryRevaluationShare?(treasuryAccountId: string, foreign: Money, fromDate: string, toDate: string): Promise<Money>;
  treasuryPosition?(treasuryAccountId: string, asOfDate: string): Promise<{ readonly foreign: Money; readonly base: Money } | null>;
}

/** أرباح / خسائر فروق العملة المحققة — the realised gain and loss accounts. */
export interface FxDifferenceAccounts {
  readonly gainAccountId: string;
  readonly lossAccountId: string;
}

/** Raised when a foreign invoice is settled on a day with no approved rate for its currency. */
export class SettlementRateMissingError extends Error {
  readonly code = "FX_RATE_MISSING";
  constructor(
    readonly currency: string,
    readonly date: string,
  ) {
    super(`لا يوجد سعر صرف معتمد للعملة ${currency} بتاريخ ${date}؛ لا يمكن تسوية الفاتورة.`);
    this.name = "SettlementRateMissingError";
  }
}

/** The money doing the settling: its currency, the rate it was stamped at, and its date. */
export interface SettlingMoney {
  readonly currency: string | null | undefined;
  readonly fxRate: string | null | undefined;
  readonly date: string;
}

/**
 * The booked and settlement rates for one invoice, or null when it is a
 * base-currency invoice. Money in the invoice's own currency settles at its
 * own stamped rate; anything else (a base-currency receipt, a cheque) buys the
 * invoice's currency at the approved rate of its own date.
 */
export async function settlementRatesFor(
  port: RealisedFxPort,
  invoice: AllocatableInvoice,
  money: SettlingMoney,
): Promise<SettlementRates | null> {
  const booked = await port.invoiceFx(invoice.id, invoice.kind);
  if (!booked) return null;
  if (money.fxRate && money.currency === booked.currency) {
    return { invoiceRate: booked.fxRate, settlementRate: money.fxRate };
  }
  const rate = await port.rateOn(booked.currency, money.date);
  if (!rate) throw new SettlementRateMissingError(booked.currency, money.date);
  return { invoiceRate: booked.fxRate, settlementRate: rate };
}

/** The currency and rate on the settling money's own control-account line; a null rate is base money. */
export interface SettlingLine {
  readonly currency: string | null | undefined;
  readonly fxRate: string | null | undefined;
}

export interface RealisedFxPostingInput {
  readonly allocationId: string;
  readonly invoice: AllocatableInvoice;
  readonly split: SettlementSplit;
  /** The invoice's currency and the rate it was booked at. */
  readonly currency: string;
  readonly invoiceRate: string;
  readonly money: SettlingLine;
  /** The allocation's effective day (D265); the entry is dated the later of it and the invoice's own date. */
  readonly date: string;
  /** The party's control account the voucher or cheque posted to (1105 / 2100). */
  readonly controlAccountId: string;
  readonly branchId?: string | null;
  readonly reference: string;
}

/** The deterministic id of the realised-FX entry an allocation posts. */
export function realisedFxEntryId(allocationId: string): string {
  return `FXR:${allocationId}`;
}

function sameRate(a: string, b: string): boolean {
  return Money.fromMajor(a).scaled === Money.fromMajor(b).scaled;
}

/**
 * The balanced settlement entry for one allocation. On a customer the money's
 * line is debited back by what the allocation used and the invoice's line is
 * credited by what it relieved; a supplier's the mirror. The difference goes
 * to the gain or loss account. Null when the money already sits in the
 * invoice's currency at its booked rate, so there is nothing to move.
 */
export function buildRealisedFxLines(input: RealisedFxPostingInput, accounts: FxDifferenceAccounts): JournalLineInput[] | null {
  const diff = input.split.fxDifference.scaled;
  const moneyRate = input.money.fxRate ?? null;
  const moneyCurrency = moneyRate ? (input.money.currency ?? null) : null;
  const share = (input.split.revaluationShare?.scaled ?? 0n) + (input.split.moneyRevaluationShare?.scaled ?? 0n);
  if (diff === 0n && share === 0n && moneyRate && moneyCurrency === input.currency && sameRate(moneyRate, input.invoiceRate)) return null;
  const zero = Money.zero();
  const receivable = input.invoice.kind === "sales";
  const branchId = input.branchId ?? null;
  const partyId = input.invoice.partyId;
  const used = Money.fromScaled(input.split.relief.scaled + share + diff);
  const relief = input.split.relief;
  const lines: JournalLineInput[] = [
    {
      accountId: input.controlAccountId,
      debit: receivable ? used : zero,
      credit: receivable ? zero : used,
      memo: FX_SETTLEMENT_LINE_MEMO,
      currency: moneyCurrency,
      fxRate: moneyRate,
      partyId,
      branchId,
    },
    {
      accountId: input.controlAccountId,
      debit: receivable ? zero : relief,
      credit: receivable ? relief : zero,
      memo: FX_SETTLEMENT_LINE_MEMO,
      currency: input.currency,
      fxRate: input.invoiceRate,
      partyId,
      branchId,
    },
  ];
  if (share !== 0n) {
    const magnitude = Money.fromScaled(share < 0n ? -share : share);
    const relievesDebit = receivable ? share > 0n : share < 0n;
    lines.push({
      accountId: input.controlAccountId,
      debit: relievesDebit ? zero : magnitude,
      credit: relievesDebit ? magnitude : zero,
      memo: FX_REVALUATION_SHARE_MEMO,
      currency: input.currency,
      fxRate: input.invoiceRate,
      partyId,
      branchId,
    });
  }
  if (diff !== 0n) {
    const magnitude = Money.fromScaled(diff < 0n ? -diff : diff);
    const gain = receivable ? diff > 0n : diff < 0n;
    lines.push({
      accountId: gain ? accounts.gainAccountId : accounts.lossAccountId,
      debit: gain ? zero : magnitude,
      credit: gain ? magnitude : zero,
      memo: FX_REALISED_LINE_MEMO,
      branchId,
    });
  }
  return lines;
}

/** Posts the settlement entry of one allocation; returns the entry id, or null when there was nothing to post. */
export async function postRealisedFx(
  input: RealisedFxPostingInput,
  port: Pick<RealisedFxPort, "differenceAccounts">,
  gl: JournalPostingDeps,
): Promise<string | null> {
  const lines = buildRealisedFxLines(input, await port.differenceAccounts());
  if (!lines) return null;
  const id = realisedFxEntryId(input.allocationId);
  await postJournalEntry(
    {
      id,
      date: laterDay(input.date, input.invoice.date),
      memo:
        input.split.fxDifference.scaled === 0n
          ? `تسوية ${input.invoice.invoiceNo} بعملة ${input.currency} (${input.reference})`
          : `فروق عملة محققة — تسوية ${input.invoice.invoiceNo} (${input.reference})`,
      source: "system",
      sourceDocType: FX_REALISED_DOC_TYPE,
      sourceDocId: input.allocationId,
      sourceDocNumber: input.invoice.invoiceNo,
      lines,
    },
    gl,
  );
  return id;
}

export interface RevaluationRelease {
  readonly kind: AllocationInvoiceKind;
  readonly controlAccountId: string;
  readonly partyId: string;
  readonly currency: string;
  readonly fxRate: string;
  readonly share: Money;
  readonly branchId?: string | null;
}

export function buildRevaluationReleaseLines(release: RevaluationRelease, accounts: FxDifferenceAccounts): JournalLineInput[] {
  const debitPositive = release.kind === "sales" ? release.share.scaled : -release.share.scaled;
  if (debitPositive === 0n) return [];
  const zero = Money.zero();
  const magnitude = Money.fromScaled(debitPositive < 0n ? -debitPositive : debitPositive);
  const overstated = debitPositive > 0n;
  const branchId = release.branchId ?? null;
  return [
    { accountId: release.controlAccountId, debit: overstated ? zero : magnitude, credit: overstated ? magnitude : zero, memo: FX_REVALUATION_SHARE_MEMO, currency: release.currency, fxRate: release.fxRate, partyId: release.partyId, branchId },
    { accountId: overstated ? accounts.lossAccountId : accounts.gainAccountId, debit: overstated ? magnitude : zero, credit: overstated ? zero : magnitude, memo: FX_REALISED_LINE_MEMO, branchId },
  ];
}

export function realisedFxReversalId(fxEntryId: string): string {
  return `${fxEntryId}:REV`;
}

/**
 * The day an undo of `allocation` takes effect (D265): the day of the event
 * that undid it — the hand undo, the voucher's reversal, the cheque's bounce —
 * but never before the allocation itself took effect, so its settlement entry
 * and the mirror never stand in the wrong order.
 */
export async function allocationUndoDay(
  allocation: VoucherAllocation,
  eventDay: string,
  ledger: Pick<JournalPostingDeps["ledger"], "findById">,
): Promise<string> {
  const made = allocation.date ?? (allocation.fxEntryId ? (await ledger.findById(allocation.fxEntryId))?.date : null);
  return laterDay(eventDay, made);
}

/** Mirrors the settlement entry of an allocation being undone, on the day from {@link allocationUndoDay}. */
export async function reverseRealisedFx(allocation: VoucherAllocation, gl: JournalPostingDeps, date: string): Promise<void> {
  if (!allocation.fxEntryId) return;
  const entry = await gl.ledger.findById(allocation.fxEntryId);
  if (!entry || entry.reversedByEntryId) return;
  await reverseJournalEntry(allocation.fxEntryId, gl, {
    reversalId: realisedFxReversalId(allocation.fxEntryId),
    date,
    memo: `عكس فروق عملة محققة (${entry.entryNo ?? entry.id})`,
  });
}
