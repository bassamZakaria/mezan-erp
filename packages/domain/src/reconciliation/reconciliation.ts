import { Money } from "../money/index.js";
import type { PostedLine } from "../gl/ledger.js";

/**
 * مطابقة الأرصدة — Balance Reconciliation (docs/catalog/04). A control-account
 * integrity check: each sub-ledger balance (inventory valuation, treasury cash,
 * AR, AP) is compared against its GL control-account balance, and any journal
 * line posted directly to a control account without going through its sub-ledger
 * is flagged as "unlinked". Pure domain — the caller supplies the balances and
 * the control-account lines.
 */

/** One sub-ledger↔GL comparison to reconcile. */
export interface ReconciliationComparison {
  /** Stable key, e.g. "inventory", "treasury-egp", "ar", "ap". */
  readonly key: string;
  readonly label: string;
  readonly controlAccountId: string;
  /** Balance computed from the sub-ledger's own records. */
  readonly subLedgerBalance: Money;
  /** Balance of the GL control account (posted ledger lines). */
  readonly glBalance: Money;
}

export interface ReconciliationRow extends ReconciliationComparison {
  /** subLedgerBalance − glBalance. Zero when reconciled. */
  readonly difference: Money;
  readonly matched: boolean;
}

export interface ReconciliationSummary {
  readonly rows: readonly ReconciliationRow[];
  readonly allMatched: boolean;
}

/** Build the reconciliation summary — one row per comparison plus an overall flag. */
export function computeBalanceReconciliation(
  comparisons: readonly ReconciliationComparison[],
): ReconciliationSummary {
  const rows: ReconciliationRow[] = comparisons.map((c) => {
    const difference = Money.fromScaled(c.subLedgerBalance.scaled - c.glBalance.scaled);
    return { ...c, difference, matched: difference.scaled === 0n };
  });
  return { rows, allMatched: rows.every((r) => r.matched) };
}

/** A control-account journal line with no sub-ledger attribution. */
export interface UnlinkedEntryLine {
  readonly entryId: string;
  readonly entryNo: string | null;
  readonly date: string;
  readonly accountId: string;
  readonly memo: string | null;
  readonly debit: Money;
  readonly credit: Money;
}

/**
 * Flag lines posted directly to a control account without a sub-ledger link.
 * Heuristic (docs/catalog/04): sub-ledger postings are system-generated
 * (source "system"), so a "manual" line hitting a control account is one a user
 * posted straight to it, bypassing the sub-ledger — exactly what this tab
 * surfaces ("القيود غير المرتبطة"). Newest first.
 */
export function findUnlinkedControlLines(
  lines: readonly PostedLine[],
  controlAccountIds: ReadonlySet<string>,
): UnlinkedEntryLine[] {
  return lines
    .filter((l) => controlAccountIds.has(l.accountId) && l.source === "manual")
    .map((l) => ({
      entryId: l.entryId,
      entryNo: l.entryNo,
      date: l.date,
      accountId: l.accountId,
      memo: l.memo,
      debit: l.debit,
      credit: l.credit,
    }))
    .sort((a, b) => (a.date === b.date ? (b.entryNo ?? "").localeCompare(a.entryNo ?? "") : b.date.localeCompare(a.date)));
}
