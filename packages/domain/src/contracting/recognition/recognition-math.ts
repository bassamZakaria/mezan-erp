import { Money } from "../../money/index.js";
import type { PostedLine } from "../../gl/ledger.js";
import { COST_CATEGORIES, type CostCategory } from "../cost-category.js";
import { computeContractValue, computeVariationOrderValue } from "../contracts/amounts.js";
import type { BoqLine, BudgetRevision, RecognitionPolicy, VariationOrder, WorksContract } from "../contracts/contract.js";
import type { RecognitionFigures, WipCategoryAmount } from "./recognition.js";

/**
 * The arithmetic of the monthly run. Pure, exact and separately testable: the
 * service does nothing but fetch its inputs, call this, and post what it says.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERCENT_SCALE = 10_000n; // four decimal places on the reported percentage
const HUNDRED_PERCENT = 100n * PERCENT_SCALE;

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** amount × numerator / denominator, rounded HALF_UP to the currency minor unit. */
export function proportionOf(amount: Money, numerator: Money, denominator: Money): Money {
  if (denominator.scaled === 0n) return Money.zero();
  const raw = divHalfUp(amount.scaled * numerator.scaled, denominator.scaled);
  return Money.fromScaled(divHalfUp(raw, 10_000n) * 10_000n);
}

export function isMonthEnd(date: string): boolean {
  if (!ISO_DATE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const next = new Date(parsed.getTime() + 86_400_000);
  return next.getUTCMonth() !== parsed.getUTCMonth();
}

/** The first day of the month `date` falls in. */
export function monthStartOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The last day of the month before the one `date` falls in. */
export function previousMonthEnd(date: string): string {
  const start = new Date(`${monthStartOf(date)}T00:00:00Z`);
  return new Date(start.getTime() - 86_400_000).toISOString().slice(0, 10);
}

/** The last day of the month `date` falls in. */
export function monthEndOf(date: string): string {
  const start = new Date(`${monthStartOf(date)}T00:00:00Z`);
  const nextMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return new Date(nextMonth.getTime() - 86_400_000).toISOString().slice(0, 10);
}

/**
 * التكلفة الكلية المقدرة as it stood at `asOfDate`. A budget revision is an
 * append-only record of one change, so the value at a past date is the
 * `previousValue` of the earliest revision made after it.
 */
export function estimatedTotalCostAsOf(
  contract: Pick<WorksContract, "estimatedTotalCost" | "budgetRevisions">,
  asOfDate: string,
): Money | null {
  const later = [...contract.budgetRevisions]
    .filter((r: BudgetRevision) => r.date > asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (later.length === 0) return contract.estimatedTotalCost;
  return later[0]!.previousValue;
}

/**
 * قيمة العقد بعد أوامر التغيير as of a date — the base bill plus the net value
 * of every variation order APPROVED on or before it. Mirrors the contract
 * view's `contractValueAfterVariations`, filtered by the legal approval date,
 * because a run for May cannot be told about an order approved in August.
 */
export function contractValueAsOf(
  boqLines: readonly BoqLine[],
  orders: readonly VariationOrder[],
  asOfDate: string,
): Money {
  const variations = orders.filter(
    (o) => o.status === "approved" && o.approvedAt !== null && o.approvedAt <= asOfDate,
  );
  return computeContractValue(boqLines).add(
    Money.sum(variations.map((o) => computeVariationOrderValue(o, boqLines))),
  );
}

/** The GL accounts the run reads and posts through, already resolved from the routing table. */
export interface RecognitionAccountIds {
  readonly wip: string;
  readonly costOfRevenue: string;
  readonly billings: string;
  readonly contractAsset: string;
  readonly contractLiability: string;
  readonly onerousProvision: string;
  readonly onerousLoss: string;
  readonly revenue: string;
  readonly plantRecovery: string;
}

export interface RecognitionInput {
  readonly periodEnd: string;
  readonly recognitionPolicy: RecognitionPolicy;
  readonly estimatedTotalCost: Money;
  readonly contractValue: Money;
  /** Every posted line carrying the contract's projectId, dated on or before `periodEnd`. */
  readonly lines: readonly PostedLine[];
  /** The ids of every P&L expense account in the chart. */
  readonly expenseAccountIds: ReadonlySet<string>;
  readonly accounts: RecognitionAccountIds;
  /** Σ periodRevenue over this contract's earlier live runs. */
  readonly revenueRecognisedPreviously: Money;
  /** Σ billedInPeriod over this contract's earlier live runs — what has already left 2165. */
  readonly billedReclassedPreviously: Money;
}

function netOf(lines: readonly PostedLine[]): Money {
  let acc = 0n;
  for (const line of lines) acc += line.debit.scaled - line.credit.scaled;
  return Money.fromScaled(acc);
}

/**
 * التكلفة حتى تاريخه. Costs reach a project either as أعمال تحت التنفيذ (1230,
 * where the site documents capitalise them) or straight onto an expense
 * account carrying the project dimension.
 *
 * INVARIANT: تكلفة إيراد العقود (5150) IS counted. The monthly WIP relief moves
 * cost out of 1230 and into 5150, so netting 1230 without 5150 would report a
 * cost-to-date of zero the moment the first run posted, and the percentage of
 * completion would collapse to nothing every month.
 *
 * استرداد تكلفة تشغيل المعدات (5160) is the contra of a cost already sitting in
 * WIP — counting it would cancel the plant hours out again — and خسائر عقود
 * متوقعة (5930) is this run's own output.
 */
export function costToDateOf(
  lines: readonly PostedLine[],
  expenseAccountIds: ReadonlySet<string>,
  accounts: RecognitionAccountIds,
): Money {
  const excluded = new Set([accounts.onerousLoss, accounts.plantRecovery]);
  return netOf(
    lines.filter(
      (l) => !excluded.has(l.accountId) && (l.accountId === accounts.wip || expenseAccountIds.has(l.accountId)),
    ),
  );
}

function percentCompleteOf(costToDate: Money, estimatedTotalCost: Money): string {
  if (estimatedTotalCost.scaled <= 0n) return "0.0000";
  const raw = divHalfUp(costToDate.scaled * HUNDRED_PERCENT, estimatedTotalCost.scaled);
  const capped = raw > HUNDRED_PERCENT ? HUNDRED_PERCENT : raw < 0n ? 0n : raw;
  const whole = capped / PERCENT_SCALE;
  const frac = capped % PERCENT_SCALE;
  return `${whole}.${frac.toString().padStart(4, "0")}`;
}

function wipByCategoryOf(wipLines: readonly PostedLine[]): WipCategoryAmount[] {
  const buckets = new Map<CostCategory | "", bigint>();
  for (const line of wipLines) {
    const key = line.costCategory ?? "";
    buckets.set(key, (buckets.get(key) ?? 0n) + (line.debit.scaled - line.credit.scaled));
  }
  const ordered: (CostCategory | "")[] = [...COST_CATEGORIES, ""];
  return ordered
    .filter((key) => (buckets.get(key) ?? 0n) !== 0n)
    .map((key) => ({
      costCategory: key === "" ? null : key,
      amount: Money.fromScaled(buckets.get(key) ?? 0n),
    }));
}

/**
 * The whole computation. Nothing here reads a client-supplied figure: the
 * cumulative cost, what has been billed, what sits in WIP and what the
 * provision already carries all come off posted lines.
 */
export function computeRecognition(input: RecognitionInput): RecognitionFigures {
  const { accounts, periodEnd } = input;
  const monthStart = monthStartOf(periodEnd);
  const certifiedValue = input.recognitionPolicy === "certified_value";

  const costToDate = costToDateOf(input.lines, input.expenseAccountIds, accounts);
  const costToComplete = Money.fromScaled(
    input.estimatedTotalCost.scaled > costToDate.scaled ? input.estimatedTotalCost.scaled - costToDate.scaled : 0n,
  );
  const percentComplete = percentCompleteOf(costToDate, input.estimatedTotalCost);

  // revenueToDate is contractValue × costToDate / estimatedTotalCost in ONE
  // rounding step — deriving it from the reported percentage would round twice
  // and leave a few piastres of revenue nothing can explain.
  const cappedCost = Money.fromScaled(
    costToDate.scaled > input.estimatedTotalCost.scaled ? input.estimatedTotalCost.scaled : costToDate.scaled < 0n ? 0n : costToDate.scaled,
  );
  const revenueToDate = certifiedValue
    ? Money.zero()
    : proportionOf(input.contractValue, cappedCost, input.estimatedTotalCost);
  const periodRevenue = Money.fromScaled(revenueToDate.scaled - input.revenueRecognisedPreviously.scaled);

  // The billings standing in 2165 for this project. A run relieves the whole
  // balance, so 2165 nets to zero over time and a certificate reversal reduces
  // the billed figure by itself.
  const billingsLines = input.lines.filter((l) => l.accountId === accounts.billings);
  const billedInPeriod = certifiedValue ? Money.zero() : netOf(billingsLines).negate();
  const billedToDate = Money.fromScaled(billedInPeriod.scaled + input.billedReclassedPreviously.scaled);

  const position = Money.fromScaled(revenueToDate.scaled - billedToDate.scaled);
  const contractAsset = Money.fromScaled(position.scaled > 0n ? position.scaled : 0n);
  const contractLiability = Money.fromScaled(position.scaled < 0n ? -position.scaled : 0n);

  const priorAsset = netOf(input.lines.filter((l) => l.accountId === accounts.contractAsset));
  const assetAfterSteps = Money.fromScaled(priorAsset.scaled + periodRevenue.scaled - billedInPeriod.scaled);
  // The change in التزام العقد: positive when an excess credit has to leave
  // 1170 for 2175, negative when a liability is released back into the asset.
  const contractPositionMovement = certifiedValue
    ? Money.zero()
    : Money.fromScaled(contractAsset.scaled - assetAfterSteps.scaled);

  const foreseeableLoss = certifiedValue
    ? Money.zero()
    : Money.fromScaled(
        input.estimatedTotalCost.scaled > input.contractValue.scaled
          ? input.estimatedTotalCost.scaled - input.contractValue.scaled
          : 0n,
      );
  const provisionRequired = proportionOf(foreseeableLoss, costToComplete, input.estimatedTotalCost);
  const provisionBalance = netOf(input.lines.filter((l) => l.accountId === accounts.onerousProvision)).negate();
  const provisionMovement = Money.fromScaled(provisionRequired.scaled - provisionBalance.scaled);

  const wipLines = input.lines.filter((l) => l.accountId === accounts.wip);
  const wipOpening = netOf(wipLines.filter((l) => l.date < monthStart));
  const wipIncurred = netOf(wipLines.filter((l) => l.date >= monthStart));
  const wipRelieved = Money.fromScaled(wipOpening.scaled + wipIncurred.scaled);
  const wipByCategory = wipByCategoryOf(wipLines);

  return {
    recognitionPolicy: input.recognitionPolicy,
    estimatedTotalCost: input.estimatedTotalCost,
    costToDate,
    costToComplete,
    percentComplete,
    contractValue: input.contractValue,
    revenueToDate,
    revenueRecognisedPreviously: certifiedValue ? Money.zero() : input.revenueRecognisedPreviously,
    periodRevenue: certifiedValue ? Money.zero() : periodRevenue,
    billedInPeriod,
    billedToDate,
    contractAsset: certifiedValue ? Money.zero() : contractAsset,
    contractLiability: certifiedValue ? Money.zero() : contractLiability,
    contractPositionMovement,
    foreseeableLoss,
    provisionRequired: certifiedValue ? Money.zero() : provisionRequired,
    provisionBalance,
    provisionMovement: certifiedValue ? Money.zero() : provisionMovement,
    wipOpening,
    wipIncurred,
    wipRelieved,
    wipClosing: Money.zero(),
    wipByCategory,
  };
}
