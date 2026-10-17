import {
  OwnerDigestBackupState,
  OwnerDigestExceptionKind,
  OwnerDigestSeverity,
  type OwnerDigestExceptionDTO,
  type OwnerDigestExceptionItemDTO,
  type OwnerDigestThresholdsDTO,
} from "@mezan/contracts";
import { Money } from "../money/index.js";

export const OWNER_DIGEST_ITEM_LIMIT = 5;

const CRITICAL_MULTIPLE = 3;
const CRITICAL_DISCOUNT_PERCENT = 50;
const CRITICAL_OVERDUE_DAYS = 60;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

const SEVERITY_RANK: Readonly<Record<OwnerDigestSeverity, number>> = {
  [OwnerDigestSeverity.Critical]: 0,
  [OwnerDigestSeverity.Warning]: 1,
  [OwnerDigestSeverity.Notice]: 2,
};

const KIND_ORDER: readonly OwnerDigestExceptionKind[] = [
  OwnerDigestExceptionKind.Void,
  OwnerDigestExceptionKind.CashVariance,
  OwnerDigestExceptionKind.BelowFloor,
  OwnerDigestExceptionKind.LargeDiscount,
  OwnerDigestExceptionKind.OverdueCollections,
  OwnerDigestExceptionKind.FailedEta,
  OwnerDigestExceptionKind.ApprovalsWaiting,
  OwnerDigestExceptionKind.LowStock,
  OwnerDigestExceptionKind.Backup,
];

export interface DigestFact {
  readonly reference: string | null;
  readonly party: string | null;
  readonly amount: Money | null;
  readonly detail: string | null;
  readonly on: string | null;
}

export interface DiscountFact extends DigestFact {
  readonly percent: number;
}

export interface WaitingFact extends DigestFact {
  readonly waitingHours: number;
}

export interface OverdueFact {
  readonly amount: Money;
  readonly invoiceCount: number;
  readonly customerCount: number;
  readonly oldestDueDate: string | null;
}

export interface LowStockFact {
  readonly low: number;
  readonly out: number;
  readonly firstItemName: string | null;
}

export interface BackupFact {
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
}

function itemOf(fact: DigestFact): OwnerDigestExceptionItemDTO {
  return {
    reference: fact.reference,
    party: fact.party,
    amount: fact.amount ? fact.amount.toString() : null,
    detail: fact.detail,
    on: fact.on,
  };
}

function magnitude(fact: DigestFact): bigint {
  const scaled = fact.amount?.scaled ?? 0n;
  return scaled < 0n ? -scaled : scaled;
}

function topItems(facts: readonly DigestFact[]): OwnerDigestExceptionItemDTO[] {
  return [...facts]
    .sort((a, b) => (magnitude(b) > magnitude(a) ? 1 : magnitude(b) < magnitude(a) ? -1 : 0))
    .slice(0, OWNER_DIGEST_ITEM_LIMIT)
    .map(itemOf);
}

function totalOf(facts: readonly DigestFact[]): Money | null {
  const amounts = facts.flatMap((fact) => (fact.amount ? [fact.amount] : []));
  return amounts.length === 0 ? null : Money.sum(amounts);
}

function exception(
  kind: OwnerDigestExceptionKind,
  severity: OwnerDigestSeverity,
  count: number,
  amount: Money | null,
  threshold: string | null,
  items: OwnerDigestExceptionItemDTO[],
  backupState: OwnerDigestBackupState | null = null,
  secondaryCount: number | null = null,
): OwnerDigestExceptionDTO {
  return { kind, severity, count, secondaryCount, amount: amount ? amount.toString() : null, threshold, items, backupState };
}

export function evaluateVoids(facts: readonly DigestFact[], thresholds: OwnerDigestThresholdsDTO): OwnerDigestExceptionDTO | null {
  if (facts.length < thresholds.voidCount) return null;
  const severity = facts.length >= thresholds.voidCount * CRITICAL_MULTIPLE ? OwnerDigestSeverity.Critical : OwnerDigestSeverity.Warning;
  return exception(OwnerDigestExceptionKind.Void, severity, facts.length, totalOf(facts), String(thresholds.voidCount), topItems(facts));
}

export function evaluateLargeDiscounts(facts: readonly DiscountFact[], thresholds: OwnerDigestThresholdsDTO): OwnerDigestExceptionDTO | null {
  const over = facts.filter((fact) => fact.percent >= thresholds.largeDiscountPercent);
  if (over.length === 0) return null;
  const severity = over.some((fact) => fact.percent >= CRITICAL_DISCOUNT_PERCENT) ? OwnerDigestSeverity.Critical : OwnerDigestSeverity.Warning;
  return exception(OwnerDigestExceptionKind.LargeDiscount, severity, over.length, totalOf(over), String(thresholds.largeDiscountPercent), topItems(over));
}

export function evaluateBelowFloor(facts: readonly DigestFact[], thresholds: OwnerDigestThresholdsDTO): OwnerDigestExceptionDTO | null {
  if (facts.length < thresholds.belowFloorCount) return null;
  return exception(OwnerDigestExceptionKind.BelowFloor, OwnerDigestSeverity.Warning, facts.length, totalOf(facts), String(thresholds.belowFloorCount), topItems(facts));
}

export function evaluateCashVariances(facts: readonly DigestFact[], thresholds: OwnerDigestThresholdsDTO): OwnerDigestExceptionDTO | null {
  const limit = Money.fromMajor(thresholds.cashVarianceAmount).scaled;
  const over = facts.filter((fact) => magnitude(fact) > 0n && magnitude(fact) >= limit);
  if (over.length === 0) return null;
  const critical = over.some((fact) => magnitude(fact) >= limit * BigInt(CRITICAL_MULTIPLE * 2));
  return exception(
    OwnerDigestExceptionKind.CashVariance,
    critical ? OwnerDigestSeverity.Critical : OwnerDigestSeverity.Warning,
    over.length,
    totalOf(over),
    thresholds.cashVarianceAmount,
    topItems(over),
  );
}

export function evaluateOverdue(fact: OverdueFact, today: string, thresholds: OwnerDigestThresholdsDTO): OwnerDigestExceptionDTO | null {
  if (fact.invoiceCount === 0 || fact.amount.scaled < Money.fromMajor(thresholds.overdueAmount).scaled) return null;
  const oldestDays = fact.oldestDueDate ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fact.oldestDueDate}T00:00:00Z`)) / MS_PER_DAY) : 0;
  const item: OwnerDigestExceptionItemDTO = { reference: null, party: null, amount: fact.amount.toString(), detail: null, on: fact.oldestDueDate };
  return exception(
    OwnerDigestExceptionKind.OverdueCollections,
    oldestDays >= CRITICAL_OVERDUE_DAYS ? OwnerDigestSeverity.Critical : OwnerDigestSeverity.Warning,
    fact.invoiceCount,
    fact.amount,
    thresholds.overdueAmount,
    [item],
    null,
    fact.customerCount,
  );
}

export function evaluateLowStock(fact: LowStockFact, thresholds: OwnerDigestThresholdsDTO): OwnerDigestExceptionDTO | null {
  const affected = fact.low + fact.out;
  if (affected < thresholds.lowStockItems) return null;
  const item: OwnerDigestExceptionItemDTO = { reference: null, party: fact.firstItemName, amount: null, detail: null, on: null };
  return exception(
    OwnerDigestExceptionKind.LowStock,
    fact.out > 0 ? OwnerDigestSeverity.Critical : OwnerDigestSeverity.Warning,
    affected,
    null,
    String(thresholds.lowStockItems),
    [item],
    null,
    fact.out,
  );
}

export function evaluateWaitingApprovals(facts: readonly WaitingFact[], thresholds: OwnerDigestThresholdsDTO): OwnerDigestExceptionDTO | null {
  const waiting = facts.filter((fact) => fact.waitingHours >= thresholds.approvalWaitingHours);
  if (waiting.length === 0) return null;
  const critical = waiting.some((fact) => fact.waitingHours >= thresholds.approvalWaitingHours * CRITICAL_MULTIPLE);
  const items = [...waiting].sort((a, b) => b.waitingHours - a.waitingHours).slice(0, OWNER_DIGEST_ITEM_LIMIT).map(itemOf);
  return exception(
    OwnerDigestExceptionKind.ApprovalsWaiting,
    critical ? OwnerDigestSeverity.Critical : OwnerDigestSeverity.Warning,
    waiting.length,
    null,
    String(thresholds.approvalWaitingHours),
    items,
  );
}

export function evaluateFailedEta(facts: readonly DigestFact[], thresholds: OwnerDigestThresholdsDTO): OwnerDigestExceptionDTO | null {
  if (facts.length < thresholds.failedEtaCount) return null;
  return exception(OwnerDigestExceptionKind.FailedEta, OwnerDigestSeverity.Critical, facts.length, null, String(thresholds.failedEtaCount), facts.slice(0, OWNER_DIGEST_ITEM_LIMIT).map(itemOf));
}

export function evaluateBackup(fact: BackupFact, nowIso: string, thresholds: OwnerDigestThresholdsDTO): OwnerDigestExceptionDTO | null {
  const lastSuccess = fact.lastSuccessAt ? Date.parse(fact.lastSuccessAt) : null;
  const lastFailure = fact.lastFailureAt ? Date.parse(fact.lastFailureAt) : null;
  const failedSince = lastFailure !== null && (lastSuccess === null || lastFailure > lastSuccess);
  const ageHours = lastSuccess === null ? Number.POSITIVE_INFINITY : (Date.parse(nowIso) - lastSuccess) / MS_PER_HOUR;
  const item: OwnerDigestExceptionItemDTO = { reference: null, party: null, amount: null, detail: null, on: fact.lastSuccessAt };
  if (failedSince) {
    return exception(OwnerDigestExceptionKind.Backup, OwnerDigestSeverity.Critical, 1, null, String(thresholds.backupMaxAgeHours), [item], OwnerDigestBackupState.Failed);
  }
  if (ageHours > thresholds.backupMaxAgeHours) {
    return exception(OwnerDigestExceptionKind.Backup, OwnerDigestSeverity.Warning, 1, null, String(thresholds.backupMaxAgeHours), [item], OwnerDigestBackupState.Stale);
  }
  return null;
}

export function orderExceptions(exceptions: readonly OwnerDigestExceptionDTO[]): OwnerDigestExceptionDTO[] {
  return [...exceptions].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
}
