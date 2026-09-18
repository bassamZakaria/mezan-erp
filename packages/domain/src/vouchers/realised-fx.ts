/**
 * فروق العملة المحققة — realised exchange differences (IAS 21 ¶28, D221).
 *
 * A foreign invoice is booked at the rate of its own date. When money settles
 * it at another rate, the allocation relieves the invoice of what it was booked
 * at, and the difference between that and what the money was worth in base is
 * a gain or a loss in the period the settlement happened — posted here, at the
 * moment the money is matched to the invoice, as QuickBooks and Odoo both do.
 *
 * The control-account line names the party and carries the invoice's currency,
 * so the difference is never left sitting on a customer or supplier and FX
 * revaluation sees the position close. It moves base only: the foreign amount
 * was settled by the voucher itself.
 */

import { Money } from "../money/index.js";
import { postJournalEntry, reverseJournalEntry, type JournalLineInput, type JournalPostingDeps } from "../gl/index.js";
import type { AllocatableInvoice, SettlementRates, SettlementSplit, VoucherAllocation } from "./allocation.js";
import type { AllocationInvoiceKind } from "./voucher-types.js";

/** `sourceDocType` of a realised-FX entry and, through the mirror, of its reversal. The ladders skip these lines by it. */
export const FX_REALISED_DOC_TYPE = "FX_REALISED";

/** Memo on the control-account line of a realised-FX entry; FX revaluation reads it as base-only. */
export const FX_REALISED_LINE_MEMO = "فروق عملة محققة";

/** What a settlement needs to know about rates and where the difference goes. */
export interface RealisedFxPort {
  /** The currency and rate a foreign invoice was booked at; null for a base-currency one. */
  invoiceFx(invoiceId: string, kind: AllocationInvoiceKind): Promise<{ currency: string; fxRate: string } | null>;
  /** The approved rate for `currency` on `date` (on or before it), or null. */
  rateOn(currency: string, date: string): Promise<string | null>;
  /** Where a realised difference posts, read at each posting so a tenant's account routing applies at once (D229). */
  differenceAccounts(): Promise<FxDifferenceAccounts>;
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

export interface RealisedFxPostingInput {
  readonly allocationId: string;
  readonly invoice: AllocatableInvoice;
  readonly split: SettlementSplit;
  readonly currency: string;
  readonly settlementRate: string;
  /** The date the settlement happened; the entry is dated the later of it and the invoice's own date. */
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

/**
 * The balanced entry for a realised difference. A customer's control account
 * is debited by what the receipt over-credited it (a gain) or credited by what
 * it fell short (a loss); a supplier's the mirror. Null when there is none.
 */
export function buildRealisedFxLines(input: RealisedFxPostingInput, accounts: FxDifferenceAccounts): JournalLineInput[] | null {
  const diff = input.split.fxDifference.scaled;
  if (diff === 0n) return null;
  const magnitude = Money.fromScaled(diff < 0n ? -diff : diff);
  const zero = Money.zero();
  const receivable = input.invoice.kind === "sales";
  const controlDebit = receivable ? diff > 0n : diff < 0n;
  const gain = receivable ? diff > 0n : diff < 0n;
  const branchId = input.branchId ?? null;
  return [
    {
      accountId: input.controlAccountId,
      debit: controlDebit ? magnitude : zero,
      credit: controlDebit ? zero : magnitude,
      memo: FX_REALISED_LINE_MEMO,
      currency: input.currency,
      fxRate: input.settlementRate,
      partyId: input.invoice.partyId,
      branchId,
    },
    {
      accountId: gain ? accounts.gainAccountId : accounts.lossAccountId,
      debit: controlDebit ? zero : magnitude,
      credit: controlDebit ? magnitude : zero,
      memo: FX_REALISED_LINE_MEMO,
      branchId,
    },
  ];
}

/** Posts the realised difference of one allocation; returns the entry id, or null when there was none. */
export async function postRealisedFx(
  input: RealisedFxPostingInput,
  port: Pick<RealisedFxPort, "differenceAccounts">,
  gl: JournalPostingDeps,
): Promise<string | null> {
  if (input.split.fxDifference.scaled === 0n) return null;
  const lines = buildRealisedFxLines(input, await port.differenceAccounts());
  if (!lines) return null;
  const id = realisedFxEntryId(input.allocationId);
  await postJournalEntry(
    {
      id,
      date: input.date > input.invoice.date ? input.date : input.invoice.date,
      memo: `فروق عملة محققة — تسوية ${input.invoice.invoiceNo} (${input.reference})`,
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

/**
 * Mirrors the realised-FX entry of an allocation being undone, on `date` or,
 * when none is given, the later of the entry's own date and today. An
 * allocation that realised nothing has nothing to mirror.
 */
export async function reverseRealisedFx(
  allocation: VoucherAllocation,
  gl: JournalPostingDeps,
  opts: { readonly date?: string; readonly today: string },
): Promise<void> {
  if (!allocation.fxEntryId) return;
  const entry = await gl.ledger.findById(allocation.fxEntryId);
  if (!entry || entry.reversedByEntryId) return;
  const date = opts.date ?? (entry.date > opts.today ? entry.date : opts.today);
  await reverseJournalEntry(allocation.fxEntryId, gl, {
    reversalId: `${allocation.fxEntryId}:REV`,
    date,
    memo: `عكس فروق عملة محققة (${entry.entryNo ?? entry.id})`,
  });
}
