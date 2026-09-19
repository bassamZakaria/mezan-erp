import { Money } from "../money/index.js";
import {
  CashFlowDirection,
  CashForecastSourceKind,
  OverdueTreatment,
  horizonDays,
  type CashForecast,
  type CashForecastDay,
  type CashForecastDip,
  type CashForecastInput,
  type ScheduledCashItem,
} from "./types.js";

const MAX_DRIVERS = 5;

const RECEIVABLE_KINDS: ReadonlySet<CashForecastSourceKind> = new Set([
  CashForecastSourceKind.Receivable,
  CashForecastSourceKind.Installment,
  CashForecastSourceKind.ReceivableOther,
]);

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function emptyByKind(): Record<CashForecastSourceKind, bigint> {
  return Object.fromEntries(Object.values(CashForecastSourceKind).map((kind) => [kind, 0n])) as Record<CashForecastSourceKind, bigint>;
}

function compareScheduled(a: ScheduledCashItem, b: ScheduledCashItem): number {
  if (a.expectedDate !== b.expectedDate) return a.expectedDate < b.expectedDate ? -1 : 1;
  if (a.direction !== b.direction) return a.direction === CashFlowDirection.Inflow ? -1 : 1;
  if (a.amount.scaled !== b.amount.scaled) return a.amount.scaled > b.amount.scaled ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface CashAlertEvaluation {
  readonly breached: boolean;
  readonly crossingDate: string | null;
  readonly lowestDate: string;
  readonly lowestBalance: Money;
}

export function evaluateCashAlert(forecast: CashForecast): CashAlertEvaluation {
  return {
    breached: forecast.firstBelowThreshold !== null,
    crossingDate: forecast.firstBelowThreshold,
    lowestDate: forecast.lowest.date,
    lowestBalance: forecast.lowest.balance,
  };
}

export function buildCashForecast(input: CashForecastInput): CashForecast {
  const { today, threshold } = input;
  const count = horizonDays(input.horizon);
  const dates = Array.from({ length: count }, (_, i) => addDaysIso(today, i));
  const endDate = dates[dates.length - 1] ?? today;
  const indexByDate = new Map(dates.map((date, i) => [date, i]));

  const scheduled: ScheduledCashItem[] = [];
  const perDay: ScheduledCashItem[][] = dates.map(() => []);
  let excluded = 0n;
  let beyondIn = 0n;
  let beyondOut = 0n;
  let overdueIn = 0n;
  let overdueInCount = 0;
  let overdueOut = 0n;
  let overdueOutCount = 0;

  for (const item of input.items) {
    if (item.amount.scaled <= 0n) continue;
    const overdue = item.dueDate < today;
    const inflow = item.direction === CashFlowDirection.Inflow;
    if (overdue && inflow && RECEIVABLE_KINDS.has(item.kind)) {
      overdueIn += item.amount.scaled;
      overdueInCount += 1;
      if (input.overdueReceivables === OverdueTreatment.Exclude) {
        excluded += item.amount.scaled;
        continue;
      }
    }
    if (overdue && !inflow) {
      overdueOut += item.amount.scaled;
      overdueOutCount += 1;
    }
    const expectedDate = overdue ? today : item.dueDate;
    if (expectedDate > endDate) {
      if (inflow) beyondIn += item.amount.scaled;
      else beyondOut += item.amount.scaled;
      continue;
    }
    const entry: ScheduledCashItem = { ...item, expectedDate, overdue };
    scheduled.push(entry);
    perDay[indexByDate.get(expectedDate) ?? 0]!.push(entry);
  }

  const byKind = emptyByKind();
  let balance = input.openingCash.scaled;
  let totalIn = 0n;
  let totalOut = 0n;
  const closings: bigint[] = [];
  const days: CashForecastDay[] = dates.map((date, i) => {
    const opening = balance;
    let inflows = 0n;
    let outflows = 0n;
    for (const item of perDay[i]!) {
      byKind[item.kind] += item.amount.scaled;
      if (item.direction === CashFlowDirection.Inflow) inflows += item.amount.scaled;
      else outflows += item.amount.scaled;
    }
    totalIn += inflows;
    totalOut += outflows;
    balance = opening + inflows - outflows;
    closings.push(balance);
    return {
      date,
      opening: Money.fromScaled(opening),
      inflows: Money.fromScaled(inflows),
      outflows: Money.fromScaled(outflows),
      closing: Money.fromScaled(balance),
      itemCount: perDay[i]!.length,
    };
  });

  const firstIndex = (test: (closing: bigint) => boolean) => closings.findIndex(test);
  const belowZero = firstIndex((closing) => closing < 0n);
  const belowThreshold = firstIndex((closing) => closing < threshold.scaled);

  let lowestIndex = 0;
  closings.forEach((closing, i) => {
    if (closing < closings[lowestIndex]!) lowestIndex = i;
  });

  const dips = findDips(dates, closings, perDay, threshold.scaled);

  scheduled.sort(compareScheduled);

  return {
    today,
    horizon: input.horizon,
    endDate,
    openingCash: input.openingCash,
    threshold,
    overdueReceivables: input.overdueReceivables,
    days,
    items: scheduled,
    totals: { inflows: Money.fromScaled(totalIn), outflows: Money.fromScaled(totalOut), closing: Money.fromScaled(balance) },
    byKind: Object.fromEntries(Object.entries(byKind).map(([kind, scaled]) => [kind, Money.fromScaled(scaled)])) as Record<CashForecastSourceKind, Money>,
    overdue: {
      receivables: Money.fromScaled(overdueIn),
      receivablesCount: overdueInCount,
      payables: Money.fromScaled(overdueOut),
      payablesCount: overdueOutCount,
    },
    excludedOverdueReceivables: Money.fromScaled(excluded),
    beyondHorizon: { inflows: Money.fromScaled(beyondIn), outflows: Money.fromScaled(beyondOut) },
    firstBelowZero: belowZero >= 0 ? dates[belowZero]! : null,
    firstBelowThreshold: belowThreshold >= 0 ? dates[belowThreshold]! : null,
    lowest: { date: dates[lowestIndex] ?? today, balance: Money.fromScaled(closings[lowestIndex] ?? input.openingCash.scaled) },
    runwayDays: belowZero >= 0 ? belowZero : null,
    dips,
  };
}

function findDips(
  dates: readonly string[],
  closings: readonly bigint[],
  perDay: readonly (readonly ScheduledCashItem[])[],
  threshold: bigint,
): CashForecastDip[] {
  const dips: CashForecastDip[] = [];
  let searchFrom = 0;
  let i = 0;
  while (i < closings.length) {
    if (closings[i]! >= threshold) {
      i += 1;
      continue;
    }
    const start = i;
    let lowest = i;
    while (i < closings.length && closings[i]! < threshold) {
      if (closings[i]! < closings[lowest]!) lowest = i;
      i += 1;
    }
    const end = i - 1;
    let windowStart = searchFrom;
    if (start > searchFrom) {
      let peak = searchFrom;
      for (let k = searchFrom; k < start; k += 1) if (closings[k]! >= closings[peak]!) peak = k;
      windowStart = peak + 1;
    }
    const drivers = perDay
      .slice(windowStart, lowest + 1)
      .flat()
      .filter((item) => item.direction === CashFlowDirection.Outflow)
      .sort((a, b) => (b.amount.scaled > a.amount.scaled ? 1 : b.amount.scaled < a.amount.scaled ? -1 : 0))
      .slice(0, MAX_DRIVERS);
    dips.push({
      startDate: dates[start]!,
      endDate: i >= closings.length ? null : dates[end]!,
      lowestDate: dates[lowest]!,
      lowestBalance: Money.fromScaled(closings[lowest]!),
      drivers,
    });
    searchFrom = i;
  }
  return dips;
}
