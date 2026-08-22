import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import type { CostCenter } from "../cost-centers/cost-center.js";
import type { PostedLine } from "../gl/ledger.js";

/**
 * أرباح مراكز التكلفة — Cost Center P&L (docs/catalog/04). Groups the P&L
 * (revenue − expense) of posted journal lines by the cost-center dimension the
 * line carries (`JournalLine.costCenterId`). Lines with no cost center fall
 * into a single "غير مخصص" (unassigned) bucket so the totals always reconcile
 * to the raw ledger. Pure domain: it takes already-fetched data and returns
 * rows — no ports, no dates logic (the caller filters lines by period).
 */

/** One cost-center row of the P&L report. */
export interface CostCenterPnLRow {
  /** Cost-center id, or null for the unassigned bucket. */
  readonly costCenterId: string | null;
  readonly code: string;
  readonly name: string;
  /** Net revenue (credit − debit on revenue accounts). */
  readonly revenue: Money;
  /** Net expense (debit − credit on expense accounts). */
  readonly expense: Money;
  /** revenue − expense. */
  readonly profit: Money;
}

export interface CostCenterPnLReport {
  readonly rows: readonly CostCenterPnLRow[];
  readonly totals: {
    readonly revenue: Money;
    readonly expense: Money;
    readonly profit: Money;
  };
}

const UNASSIGNED_LABEL = "غير مخصص";

interface Bucket {
  revenue: bigint;
  expense: bigint;
}

/**
 * Build the Cost Center P&L. Only revenue/expense lines contribute (balance-
 * sheet accounts have no P&L impact); a line's sign follows its account's
 * P&L nature — revenue nets credit−debit, expense nets debit−credit.
 */
export function computeCostCenterPnL(
  lines: readonly PostedLine[],
  accounts: readonly Account[],
  costCenters: readonly CostCenter[],
): CostCenterPnLReport {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const costCenterById = new Map(costCenters.map((c) => [c.id, c]));
  const buckets = new Map<string | null, Bucket>();

  const bucketFor = (key: string | null): Bucket => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { revenue: 0n, expense: 0n };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  for (const line of lines) {
    const account = accountById.get(line.accountId);
    if (!account) continue;
    if (account.type !== "revenue" && account.type !== "expense") continue;
    const key = line.costCenterId ?? null;
    const bucket = bucketFor(key);
    if (account.type === "revenue") {
      bucket.revenue += line.credit.scaled - line.debit.scaled;
    } else {
      bucket.expense += line.debit.scaled - line.credit.scaled;
    }
  }

  const rows: CostCenterPnLRow[] = [];
  let totalRevenue = 0n;
  let totalExpense = 0n;

  // Deterministic ordering: configured cost centers by code, then unassigned last.
  const orderedKeys = [...buckets.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const ca = costCenterById.get(a)?.code ?? a;
    const cb = costCenterById.get(b)?.code ?? b;
    return ca.localeCompare(cb);
  });

  for (const key of orderedKeys) {
    const bucket = buckets.get(key)!;
    const cc = key === null ? null : costCenterById.get(key) ?? null;
    totalRevenue += bucket.revenue;
    totalExpense += bucket.expense;
    rows.push({
      costCenterId: key,
      code: cc?.code ?? (key === null ? "—" : key),
      name: cc?.nameAr ?? (key === null ? UNASSIGNED_LABEL : key),
      revenue: Money.fromScaled(bucket.revenue),
      expense: Money.fromScaled(bucket.expense),
      profit: Money.fromScaled(bucket.revenue - bucket.expense),
    });
  }

  return {
    rows,
    totals: {
      revenue: Money.fromScaled(totalRevenue),
      expense: Money.fromScaled(totalExpense),
      profit: Money.fromScaled(totalRevenue - totalExpense),
    },
  };
}
