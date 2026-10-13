import { Money, allocateScaled } from "../money/index.js";
import type { Account, NaturalBalance } from "../accounts/account.js";
import { isMonetaryAccountType } from "../accounts/monetary.js";
import type { JournalEntry } from "../journal.js";
import type { PostedLine } from "../gl/ledger.js";
import type { JournalLineInput, JournalPostingDeps } from "../gl/post.js";
import { postJournalEntry } from "../gl/post.js";
import { reverseJournalEntry } from "../gl/reverse.js";
import { FX_REVALUATION_DOC_TYPE, nextDay } from "../gl/revaluation-lock.js";
import { convertToBase, convertFromBase, isBaseCurrency, FxRateMissingError } from "../exchange-rates/convert.js";
import { FX_REALISED_LINE_MEMO } from "../vouchers/realised-fx.js";
import { FxOpenItemType } from "../vouchers/allocation.js";
import type { AllocationInvoiceKind } from "../vouchers/voucher-types.js";

/**
 * إعادة تقييم العملات الأجنبية — FX Revaluation (docs/archive/catalog/04). At period
 * end, open foreign-currency balances (AR/AP/treasury) are revalued at the
 * approved closing rate; the difference from the value on the books is posted
 * as an FX gain/loss journal entry that — by default — auto-reverses on the
 * next day, so the adjustment is confined to the closing day and doesn't
 * distort the next period.
 */

export enum ForeignResidueKind {
  Account = "account",
  Item = "item",
}

export interface ForeignResidue {
  readonly kind: ForeignResidueKind;
  readonly ref: string;
  readonly itemType?: FxOpenItemType;
  readonly currency: string;
  readonly base: Money;
}

export const FX_ROUNDING_RESIDUE_LIMIT = Money.fromMajor("0.01");

export function isRoundingResidue(residue: ForeignResidue): boolean {
  const magnitude = residue.base.scaled < 0n ? -residue.base.scaled : residue.base.scaled;
  return magnitude !== 0n && magnitude < FX_ROUNDING_RESIDUE_LIMIT.scaled;
}

export function accountForeignResidues(balances: readonly OpenFxBalance[]): ForeignResidue[] {
  return balances
    .filter((balance) => balance.foreignAmount.scaled === 0n && balance.bookedBase.scaled !== 0n)
    .map((balance) => ({ kind: ForeignResidueKind.Account, ref: balance.accountId, currency: balance.currency, base: balance.naturalBalance === "debit" ? balance.bookedBase : Money.fromScaled(-balance.bookedBase.scaled) }));
}

/** One open foreign-currency balance to revalue. */
export interface OpenFxBalance {
  readonly accountId: string;
  readonly currency: string;
  /** The balance expressed in its foreign currency. */
  readonly foreignAmount: Money;
  /** The base-currency value currently carried on the books for this balance. */
  readonly bookedBase: Money;
  /** The control account's natural side — decides how a rate change hits gain vs loss. */
  readonly naturalBalance: NaturalBalance;
  /** Optional human label for the preview (e.g. customer/supplier/treasury name). */
  readonly label?: string;
}

export interface OpenFxItem {
  readonly itemId: string;
  readonly itemType: FxOpenItemType;
  readonly kind: AllocationInvoiceKind;
  readonly partyId: string;
  readonly foreignOutstanding: Money;
  readonly carryingBase: Money;
}

export interface FxRevaluationShare {
  readonly accountId: string;
  readonly itemId: string;
  readonly itemType: FxOpenItemType;
  readonly kind: AllocationInvoiceKind;
  readonly partyId: string;
  readonly currency: string;
  readonly amount: Money;
}

export function openFxItemsKey(accountId: string, currency: string): string {
  return `${accountId} ${currency}`;
}

export function attributeRevaluation(delta: bigint, items: readonly OpenFxItem[], closingRate: string): bigint[] {
  const own = items.map((item) => convertToBase(item.foreignOutstanding, closingRate).scaled - item.carryingBase.scaled);
  const residual = delta - own.reduce((sum, value) => sum + value, 0n);
  const spread = allocateScaled(residual, items.map((item) => (item.foreignOutstanding.scaled < 0n ? -item.foreignOutstanding.scaled : item.foreignOutstanding.scaled)));
  return own.map((value, index) => value + (spread[index] ?? 0n));
}

export interface FxRevaluationConfig {
  /** Posting date (period end) — also the effective date the closing rates were read for. */
  readonly date: string;
  /** currency → closing rate (base units per one foreign unit, exact decimal string). */
  readonly closingRates: ReadonlyMap<string, string>;
  /** فروق عملة دائنة — FX gain account (revenue). */
  readonly gainAccountId: string;
  /** فروق عملة مدينة — FX loss account (expense). */
  readonly lossAccountId: string;
  readonly openItems?: ReadonlyMap<string, readonly OpenFxItem[]>;
}

/** Per-balance revaluation detail (for the "معاينة"/preview and audit). */
export interface FxRevaluationDetail {
  readonly accountId: string;
  readonly currency: string;
  readonly label: string | null;
  readonly foreignAmount: Money;
  readonly bookedBase: Money;
  readonly closingRate: string;
  readonly revaluedBase: Money;
  /** revaluedBase − bookedBase (signed, base currency). */
  readonly delta: Money;
  /** Signed economic gain (+) / loss (−) this balance contributes. */
  readonly gainLoss: Money;
}

export interface FxRevaluationResult {
  readonly details: readonly FxRevaluationDetail[];
  readonly lines: readonly JournalLineInput[];
  readonly shares: readonly FxRevaluationShare[];
  readonly totalGain: Money;
  readonly totalLoss: Money;
  /** True when at least one balance moved — i.e. there is a JE worth posting. */
  readonly hasImpact: boolean;
}

/**
 * Pure math: revalue every open balance at its currency's closing rate and
 * build the balanced FX gain/loss journal lines. Enforces the strict
 * fx-rate-missing policy — a balance whose currency has no closing rate throws
 * {@link FxRateMissingError} rather than being silently skipped.
 */
export function computeFxRevaluation(
  balances: readonly OpenFxBalance[],
  config: FxRevaluationConfig,
): FxRevaluationResult {
  const details: FxRevaluationDetail[] = [];
  const controlLines: JournalLineInput[] = [];
  const shares: FxRevaluationShare[] = [];
  let totalGain = 0n;
  let totalLoss = 0n;

  for (const balance of balances) {
    const rate = config.closingRates.get(balance.currency);
    if (rate === undefined) {
      throw new FxRateMissingError(balance.currency, config.date);
    }
    const revaluedBase = convertToBase(balance.foreignAmount, rate);
    const delta = revaluedBase.scaled - balance.bookedBase.scaled;
    // Economic gain for this balance: a debit-natured (asset) account gains
    // when its base value rises; a credit-natured (liability) account gains
    // when its base value falls.
    const gainLoss = balance.naturalBalance === "debit" ? delta : -delta;

    details.push({
      accountId: balance.accountId,
      currency: balance.currency,
      label: balance.label ?? null,
      foreignAmount: balance.foreignAmount,
      bookedBase: balance.bookedBase,
      closingRate: rate,
      revaluedBase,
      delta: Money.fromScaled(delta),
      gainLoss: Money.fromScaled(gainLoss),
    });

    if (delta === 0n) continue;
    const side = balance.naturalBalance === "debit" ? 1n : -1n;
    const items = (config.openItems?.get(openFxItemsKey(balance.accountId, balance.currency)) ?? []).filter((item) => item.foreignOutstanding.scaled !== 0n);
    if (items.length === 0) {
      controlLines.push(lineFor(balance.accountId, side * delta, balance.currency, rate));
    } else {
      attributeRevaluation(delta, items, rate).forEach((amount, index) => {
        const item = items[index]!;
        if (amount === 0n) return;
        controlLines.push({ ...lineFor(balance.accountId, side * amount, balance.currency, rate), partyId: item.partyId });
        shares.push({ accountId: balance.accountId, itemId: item.itemId, itemType: item.itemType, kind: item.kind, partyId: item.partyId, currency: balance.currency, amount: Money.fromScaled(amount) });
      });
    }
    if (gainLoss > 0n) totalGain += gainLoss;
    else totalLoss += -gainLoss;
  }

  const lines: JournalLineInput[] = [...controlLines];
  if (totalGain > 0n) {
    lines.push(lineFor(config.gainAccountId, -totalGain, null, null));
  }
  if (totalLoss > 0n) {
    lines.push(lineFor(config.lossAccountId, totalLoss, null, null));
  }

  return {
    details,
    lines,
    shares,
    totalGain: Money.fromScaled(totalGain),
    totalLoss: Money.fromScaled(totalLoss),
    hasImpact: totalGain > 0n || totalLoss > 0n,
  };
}

export { isMonetaryAccountType };

/**
 * Recover the open foreign-currency balances from posted ledger lines. Each FX
 * line (one carrying a non-base currency + booking rate) contributes its base
 * amount and the foreign amount that base+rate represent; amounts are grouped
 * per (account, currency) and expressed as a normal-positive balance on the
 * account's natural side, ready for {@link computeFxRevaluation}. Base amounts
 * are summed per rate before converting, so lines that close each other at the
 * same rate — an invoice and the settlement that relieved it (D260) — close to
 * the micro-unit. Only a monetary account contributes — see
 * {@link MONETARY_ACCOUNT_TYPES}. Pure.
 */
export function deriveOpenFxBalances(
  lines: readonly PostedLine[],
  accounts: readonly Account[],
  currencyFilter?: ReadonlySet<string>,
): OpenFxBalance[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const groups = new Map<string, { accountId: string; currency: string; baseSum: bigint; baseByRate: Map<string, { rate: string; base: bigint }> }>();

  for (const line of lines) {
    if (isBaseCurrency(line.currency) || !line.fxRate) continue;
    const currency = line.currency as string;
    if (currencyFilter && !currencyFilter.has(currency)) continue;
    const lineAccount = accountById.get(line.accountId);
    if (!lineAccount || !isMonetaryAccountType(lineAccount.type)) continue;
    const key = `${line.accountId} ${currency}`;
    const group = groups.get(key) ?? { accountId: line.accountId, currency, baseSum: 0n, baseByRate: new Map() };
    const baseDelta = line.debit.scaled - line.credit.scaled;
    group.baseSum += baseDelta;
    // A restatement — a revaluation, its reversal, or a realised difference
    // posted before D260 — moves the base value of a position and none of its
    // foreign amount. Reading it as foreign at its own rate put a phantom 2.04
    // USD on a 100 USD position revalued by 100 EGP at 49.00.
    if (!BASE_ONLY_MEMOS.has(line.memo ?? "")) {
      const rateKey = Money.fromMajor(line.fxRate).scaled.toString();
      const atRate = group.baseByRate.get(rateKey) ?? { rate: line.fxRate, base: 0n };
      atRate.base += baseDelta;
      group.baseByRate.set(rateKey, atRate);
    }
    groups.set(key, group);
  }

  const balances: OpenFxBalance[] = [];
  for (const group of groups.values()) {
    const account = accountById.get(group.accountId)!;
    const sign = account.naturalBalance === "debit" ? 1n : -1n;
    let foreignSum = 0n;
    for (const { rate, base } of group.baseByRate.values()) {
      if (base !== 0n) foreignSum += convertFromBase(Money.fromScaled(base), rate).scaled;
    }
    const bookedBase = Money.fromScaled(sign * group.baseSum);
    const foreignAmount = Money.fromScaled(sign * foreignSum);
    // A fully-settled balance (net zero) is not "open" — skip it.
    if (bookedBase.scaled === 0n && foreignAmount.scaled === 0n) continue;
    balances.push({
      accountId: account.id,
      currency: group.currency,
      foreignAmount,
      bookedBase,
      naturalBalance: account.naturalBalance,
      label: account.nameAr,
    });
  }
  return balances.sort((a, b) => (a.accountId === b.accountId ? a.currency.localeCompare(b.currency) : a.accountId.localeCompare(b.accountId)));
}

export interface ForeignTreasuryBalance {
  readonly treasuryAccountId: string;
  readonly name: string;
  readonly glAccountId: string;
  readonly currency: string;
  readonly foreignBalance: Money;
  readonly baseBalance: Money;
  readonly derivedLines: number;
}

export interface DerivedTreasuryFxLine {
  readonly entryId: string;
  readonly accountId: string;
  readonly date: string;
  readonly currency: string;
  readonly fxRate: string;
  readonly foreignAmount: Money;
}

export async function withDerivedTreasuryFx<L extends Pick<PostedLine, "entryId" | "accountId" | "date" | "currency" | "fxRate" | "debit" | "credit">>(
  lines: readonly L[],
  foreignTreasuryCurrencyByAccount: ReadonlyMap<string, string>,
  rateOn: (currency: string, date: string) => Promise<string | null>,
): Promise<{ readonly lines: L[]; readonly derived: DerivedTreasuryFxLine[] }> {
  const derived: DerivedTreasuryFxLine[] = [];
  const rates = new Map<string, string | null>();
  const out: L[] = [];
  for (const line of lines) {
    const currency = foreignTreasuryCurrencyByAccount.get(line.accountId);
    if (!currency || (line.fxRate && !isBaseCurrency(line.currency))) {
      out.push(line);
      continue;
    }
    const key = `${currency} ${line.date}`;
    if (!rates.has(key)) rates.set(key, await rateOn(currency, line.date));
    const fxRate = rates.get(key) ?? null;
    if (!fxRate) {
      out.push(line);
      continue;
    }
    out.push({ ...line, currency, fxRate });
    derived.push({
      entryId: line.entryId,
      accountId: line.accountId,
      date: line.date,
      currency,
      fxRate,
      foreignAmount: convertFromBase(Money.fromScaled(line.debit.scaled - line.credit.scaled), fxRate),
    });
  }
  return { lines: out, derived };
}

/** A line whose signed base amount (`debitPositive`) becomes a debit (>0) or credit (<0). */
function lineFor(
  accountId: string,
  debitPositive: bigint,
  currency: string | null,
  fxRate: string | null,
): JournalLineInput {
  return {
    accountId,
    debit: Money.fromScaled(debitPositive > 0n ? debitPositive : 0n),
    credit: Money.fromScaled(debitPositive < 0n ? -debitPositive : 0n),
    currency,
    fxRate,
    memo: FX_REVALUATION_LINE_MEMO,
  };
}

/**
 * Every line a revaluation posts — and, because a reversal mirrors the memo,
 * every line its reversal posts — carries this memo. The aging ladders and
 * `/reconciliation` find the restatement by it, so it must not change.
 */
export const FX_REVALUATION_LINE_MEMO = "إعادة تقييم عملات أجنبية";

const BASE_ONLY_MEMOS: ReadonlySet<string> = new Set([FX_REVALUATION_LINE_MEMO, FX_REALISED_LINE_MEMO]);

/** `sourceDocType` of a revaluation entry and, through the mirror, of its reversal. */
export { FX_REVALUATION_DOC_TYPE };

export function fxRevaluationNet(
  lines: readonly Pick<PostedLine, "accountId" | "source" | "memo" | "debit" | "credit" | "partyId">[],
  accountId: string,
): Money {
  let net = 0n;
  for (const line of lines) {
    if (line.accountId !== accountId || line.source !== "system" || line.memo !== FX_REVALUATION_LINE_MEMO || line.partyId) continue;
    net += line.debit.scaled - line.credit.scaled;
  }
  return Money.fromScaled(net);
}

export interface PostFxRevaluationOptions {
  /** Id for the revaluation journal entry. */
  readonly id: string;
  /** Id for the auto-reversal entry (required when autoReverse is on). */
  readonly reversalId?: string;
  /** Default true — post a reversing entry on the next day (docs/archive/catalog/04: "العكس التلقائي" default checked). */
  readonly autoReverse?: boolean;
  /** Reversal posting date; defaults to the day after `config.date`. */
  readonly reversalDate?: string;
  readonly memo?: string;
}

export interface PostFxRevaluationResult {
  readonly computed: FxRevaluationResult;
  /** The posted revaluation entry, or null when nothing moved. */
  readonly entry: JournalEntry | null;
  /** The auto-reversal entry, when autoReverse was on and an entry was posted. */
  readonly reversal: JournalEntry | null;
}

export { nextDay };

/**
 * Compute + post the FX revaluation entry through the GL engine, then (by
 * default) post its next-day reversal. Both go through the normal posting path,
 * so both are period-gated, balanced, and JE-numbered. Returns everything with
 * no entry posted when there is no rate movement.
 */
export async function postFxRevaluation(
  balances: readonly OpenFxBalance[],
  config: FxRevaluationConfig,
  deps: JournalPostingDeps,
  opts: PostFxRevaluationOptions,
): Promise<PostFxRevaluationResult> {
  const computed = computeFxRevaluation(balances, config);
  if (!computed.hasImpact) {
    return { computed, entry: null, reversal: null };
  }

  const entry = await postJournalEntry(
    {
      id: opts.id,
      date: config.date,
      memo: opts.memo ?? `إعادة تقييم العملات الأجنبية حتى ${config.date}`,
      source: "system",
      sourceDocType: FX_REVALUATION_DOC_TYPE,
      lines: computed.lines,
    },
    deps,
    { isRevaluationRun: true },
  );

  let reversal: JournalEntry | null = null;
  const autoReverse = opts.autoReverse ?? true;
  if (autoReverse) {
    if (!opts.reversalId) {
      throw new Error("postFxRevaluation: reversalId is required when autoReverse is on.");
    }
    const result = await reverseJournalEntry(entry.id, deps, {
      reversalId: opts.reversalId,
      date: opts.reversalDate ?? nextDay(config.date),
      memo: `عكس إعادة تقييم العملات الأجنبية (${entry.entryNo ?? entry.id})`,
    }, { isRevaluationRun: true });
    reversal = result.reversal;
  }

  return { computed, entry, reversal };
}
