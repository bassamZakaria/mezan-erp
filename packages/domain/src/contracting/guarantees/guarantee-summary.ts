import { Money } from "../../money/index.js";
import type { TreasuryAccount } from "../../treasury-accounts/treasury-account.js";
import type { Project } from "../../projects/project.js";
import { isExpiringWithin, isGuaranteeOutstanding, type LetterOfGuarantee } from "./guarantee.js";

/**
 * تقرير حدود التسهيلات — what the register exists to report: how much of each
 * bank's guarantee facility is already committed, how much cash is locked up
 * behind it, and what expires soon (design §05). A contractor's binding
 * constraint is this, not its cash balance.
 */

export const DEFAULT_EXPIRY_HORIZON_DAYS = 30;

export interface GuaranteeBankRow {
  readonly bankTreasuryAccountId: string;
  readonly bankNameAr: string;
  readonly outstanding: Money;
  readonly restrictedCash: Money;
  /** Null when the treasury account has no facility limit configured. */
  readonly facilityLimit: Money | null;
  /** `facilityLimit − outstanding`; null when there is no limit. Negative means the facility is over-drawn. */
  readonly available: Money | null;
  readonly count: number;
}

export interface GuaranteeProjectRow {
  readonly projectId: string | null;
  readonly projectNameAr: string;
  readonly outstanding: Money;
  readonly restrictedCash: Money;
  readonly count: number;
}

export interface GuaranteeSummary {
  readonly asOfDate: string;
  readonly totalOutstanding: Money;
  readonly restrictedCash: Money;
  /** Σ of the limits actually configured — banks with no limit contribute nothing. */
  readonly totalFacilityLimit: Money;
  /** `totalFacilityLimit` less what is committed at the banks that have one. */
  readonly totalAvailable: Money;
  readonly expiringWithin30Days: number;
  readonly byBank: readonly GuaranteeBankRow[];
  readonly byProject: readonly GuaranteeProjectRow[];
}

interface Accumulator {
  outstanding: Money;
  restrictedCash: Money;
  count: number;
}

function blank(): Accumulator {
  return { outstanding: Money.zero(), restrictedCash: Money.zero(), count: 0 };
}

function accumulate(into: Map<string, Accumulator>, key: string, guarantee: LetterOfGuarantee): void {
  const row = into.get(key) ?? blank();
  row.outstanding = row.outstanding.add(guarantee.currentValue);
  row.restrictedCash = row.restrictedCash.add(guarantee.cashMarginAmount);
  row.count += 1;
  into.set(key, row);
}

/**
 * Every figure here is derived from the letters themselves — never from
 * anything a caller supplied. `outstanding` counts only letters the bank is
 * still on the hook for (active/reduced); a released or called one has already
 * had its memorandum pair and its margin reversed on the ledger, so counting it
 * would report exposure that no longer exists.
 */
export function computeGuaranteeSummary(
  guarantees: readonly LetterOfGuarantee[],
  banks: readonly TreasuryAccount[],
  projects: readonly Project[],
  today: string,
  expiryHorizonDays: number = DEFAULT_EXPIRY_HORIZON_DAYS,
): GuaranteeSummary {
  const bankById = new Map(banks.map((b) => [b.id, b]));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  const byBank = new Map<string, Accumulator>();
  const byProject = new Map<string, Accumulator>();
  let totalOutstanding = Money.zero();
  let restrictedCash = Money.zero();
  let expiring = 0;

  for (const guarantee of guarantees) {
    if (!isGuaranteeOutstanding(guarantee)) continue;
    totalOutstanding = totalOutstanding.add(guarantee.currentValue);
    restrictedCash = restrictedCash.add(guarantee.cashMarginAmount);
    if (isExpiringWithin(guarantee, today, expiryHorizonDays)) expiring += 1;
    accumulate(byBank, guarantee.bankTreasuryAccountId, guarantee);
    accumulate(byProject, guarantee.projectId ?? "", guarantee);
  }

  let totalFacilityLimit = Money.zero();
  let committedAgainstLimits = Money.zero();
  const bankRows: GuaranteeBankRow[] = [];
  // Every bank treasury account appears, including one with nothing drawn:
  // a facility with room left is exactly what the estimator needs to see.
  const bankIds = new Set<string>([...byBank.keys(), ...banks.filter((b) => b.type === "bank").map((b) => b.id)]);
  for (const bankTreasuryAccountId of bankIds) {
    const acc = byBank.get(bankTreasuryAccountId) ?? blank();
    const bank = bankById.get(bankTreasuryAccountId);
    const facilityLimit = bank?.guaranteeFacilityLimit ?? null;
    if (facilityLimit !== null) {
      totalFacilityLimit = totalFacilityLimit.add(facilityLimit);
      committedAgainstLimits = committedAgainstLimits.add(acc.outstanding);
    }
    bankRows.push({
      bankTreasuryAccountId,
      bankNameAr: bank?.name ?? bankTreasuryAccountId,
      outstanding: acc.outstanding,
      restrictedCash: acc.restrictedCash,
      facilityLimit,
      available: facilityLimit === null ? null : facilityLimit.add(acc.outstanding.negate()),
      count: acc.count,
    });
  }
  bankRows.sort((a, b) => Number(b.outstanding.scaled - a.outstanding.scaled) || a.bankNameAr.localeCompare(b.bankNameAr));

  const projectRows: GuaranteeProjectRow[] = [...byProject.entries()]
    .map(([projectId, acc]) => ({
      projectId: projectId === "" ? null : projectId,
      projectNameAr: projectId === "" ? "بدون مشروع — مناقصات" : (projectById.get(projectId)?.nameAr ?? projectId),
      outstanding: acc.outstanding,
      restrictedCash: acc.restrictedCash,
      count: acc.count,
    }))
    .sort((a, b) => Number(b.outstanding.scaled - a.outstanding.scaled));

  return {
    asOfDate: today,
    totalOutstanding,
    restrictedCash,
    totalFacilityLimit,
    totalAvailable: totalFacilityLimit.add(committedAgainstLimits.negate()),
    expiringWithin30Days: expiring,
    byBank: bankRows,
    byProject: projectRows,
  };
}
