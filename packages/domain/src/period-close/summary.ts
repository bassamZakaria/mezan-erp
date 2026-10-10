import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import type { PeriodCloseCheckCode, PeriodCloseCheckResult, PeriodCloseWindow } from "./types.js";

export interface TrialBalanceSnapshotRow {
  readonly accountId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly opening: Money;
  readonly movement: Money;
  readonly closing: Money;
}

export interface TrialBalanceSnapshotTotals {
  readonly closingDebit: Money;
  readonly closingCredit: Money;
  readonly movementDebit: Money;
  readonly movementCredit: Money;
}

export interface PeriodCloseSummary extends PeriodCloseWindow {
  readonly id: string;
  readonly closedBy: string;
  readonly closedAt: string;
  readonly overrideReason: string | null;
  readonly failedChecks: readonly PeriodCloseCheckCode[];
  readonly checks: readonly PeriodCloseCheckResult[];
  readonly trialBalance: readonly TrialBalanceSnapshotRow[];
  readonly totals: TrialBalanceSnapshotTotals;
  readonly sha256: string;
}

export type UnsignedPeriodCloseSummary = Omit<PeriodCloseSummary, "sha256">;

export interface PeriodCloseSummaryRepository {
  save(summary: PeriodCloseSummary): Promise<void>;
  findById(id: string): Promise<PeriodCloseSummary | null>;
  list(filter?: { readonly periodId?: string }): Promise<readonly PeriodCloseSummary[]>;
}

export function buildTrialBalanceSnapshot(
  accounts: readonly Pick<Account, "id" | "code" | "nameAr" | "nameEn">[],
  openingByAccount: ReadonlyMap<string, Money>,
  closingByAccount: ReadonlyMap<string, Money>,
): { rows: TrialBalanceSnapshotRow[]; totals: TrialBalanceSnapshotTotals } {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ids = new Set([...openingByAccount.keys(), ...closingByAccount.keys()]);
  const rows: TrialBalanceSnapshotRow[] = [];
  for (const id of ids) {
    const opening = openingByAccount.get(id) ?? Money.zero();
    const closing = closingByAccount.get(id) ?? Money.zero();
    const movement = closing.add(opening.negate());
    if (opening.scaled === 0n && closing.scaled === 0n && movement.scaled === 0n) continue;
    const account = byId.get(id);
    rows.push({
      accountId: id,
      code: account?.code ?? id,
      nameAr: account?.nameAr ?? id,
      nameEn: account?.nameEn ?? null,
      opening,
      movement,
      closing,
    });
  }
  rows.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  let closingDebit = 0n;
  let closingCredit = 0n;
  let movementDebit = 0n;
  let movementCredit = 0n;
  for (const row of rows) {
    if (row.closing.scaled > 0n) closingDebit += row.closing.scaled;
    else closingCredit -= row.closing.scaled;
    if (row.movement.scaled > 0n) movementDebit += row.movement.scaled;
    else movementCredit -= row.movement.scaled;
  }
  return {
    rows,
    totals: {
      closingDebit: Money.fromScaled(closingDebit),
      closingCredit: Money.fromScaled(closingCredit),
      movementDebit: Money.fromScaled(movementDebit),
      movementCredit: Money.fromScaled(movementCredit),
    },
  };
}

function canonicalValue(value: unknown): unknown {
  if (value instanceof Money) return value.toString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalValue((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** The exact bytes the SHA-256 seals. Changing this changes every stored hash — never edit it in place. */
export function canonicalCloseSummary(summary: UnsignedPeriodCloseSummary): string {
  return JSON.stringify(
    canonicalValue({
      id: summary.id,
      periodId: summary.periodId,
      year: summary.year,
      periodNumber: summary.periodNumber,
      startDate: summary.startDate,
      endDate: summary.endDate,
      closedBy: summary.closedBy,
      closedAt: summary.closedAt,
      overrideReason: summary.overrideReason,
      failedChecks: summary.failedChecks,
      trialBalance: summary.trialBalance,
      totals: summary.totals,
    }),
  );
}
