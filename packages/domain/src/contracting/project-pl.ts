import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import type { PostedLine } from "../gl/ledger.js";
import type { Project } from "../projects/project.js";
import { COST_CATEGORIES, type CostCategory } from "./cost-category.js";

/**
 * ربحية المشاريع — the project P&L, grouped by the two contracting dimensions
 * a posted line carries (docs/artifacts/mezan-contracting-designs.html D-01).
 * Pure: takes already-fetched posted lines and returns rows; the caller
 * filters by period. Only revenue and expense accounts contribute, so the
 * totals reconcile to the raw ledger the same way the Cost Centre P&L does.
 */

export type ProjectCostBreakdown = Readonly<Record<CostCategory | "uncategorised", Money>>;

export interface ProjectPnLRow {
  readonly projectId: string;
  readonly code: string;
  readonly name: string;
  readonly budget: Money;
  readonly revenue: Money;
  readonly cost: Money;
  readonly costByCategory: ProjectCostBreakdown;
  /** revenue − cost. */
  readonly margin: Money;
  /** budget − cost; negative once the project has spent past its budget. */
  readonly budgetRemaining: Money;
}

export interface ProjectPnLReport {
  readonly rows: readonly ProjectPnLRow[];
  readonly totals: {
    readonly revenue: Money;
    readonly cost: Money;
    readonly margin: Money;
  };
}

interface Bucket {
  revenue: bigint;
  cost: bigint;
  byCategory: Map<CostCategory | "uncategorised", bigint>;
}

export function computeProjectPnL(
  lines: readonly PostedLine[],
  accounts: readonly Account[],
  projects: readonly Project[],
): ProjectPnLReport {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const buckets = new Map<string, Bucket>();
  for (const project of projects) {
    buckets.set(project.id, { revenue: 0n, cost: 0n, byCategory: new Map() });
  }

  for (const line of lines) {
    if (line.projectId === null) continue;
    const account = accountById.get(line.accountId);
    if (!account || (account.type !== "revenue" && account.type !== "expense")) continue;
    let bucket = buckets.get(line.projectId);
    if (!bucket) {
      bucket = { revenue: 0n, cost: 0n, byCategory: new Map() };
      buckets.set(line.projectId, bucket);
    }
    if (account.type === "revenue") {
      bucket.revenue += line.credit.scaled - line.debit.scaled;
      continue;
    }
    const amount = line.debit.scaled - line.credit.scaled;
    bucket.cost += amount;
    const category = line.costCategory ?? "uncategorised";
    bucket.byCategory.set(category, (bucket.byCategory.get(category) ?? 0n) + amount);
  }

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const orderedIds = [...buckets.keys()].sort((a, b) => {
    const ca = projectById.get(a)?.code ?? a;
    const cb = projectById.get(b)?.code ?? b;
    return ca.localeCompare(cb);
  });

  let totalRevenue = 0n;
  let totalCost = 0n;
  const rows: ProjectPnLRow[] = orderedIds.map((id) => {
    const bucket = buckets.get(id)!;
    const project = projectById.get(id);
    totalRevenue += bucket.revenue;
    totalCost += bucket.cost;
    const budget = project?.budget ?? Money.zero();
    const byCategory = Object.fromEntries(
      [...COST_CATEGORIES, "uncategorised" as const].map((c) => [c, Money.fromScaled(bucket.byCategory.get(c) ?? 0n)]),
    ) as ProjectCostBreakdown;
    return {
      projectId: id,
      code: project?.code ?? id,
      name: project?.nameAr ?? id,
      budget,
      revenue: Money.fromScaled(bucket.revenue),
      cost: Money.fromScaled(bucket.cost),
      costByCategory: byCategory,
      margin: Money.fromScaled(bucket.revenue - bucket.cost),
      budgetRemaining: Money.fromScaled(budget.scaled - bucket.cost),
    };
  });

  return {
    rows,
    totals: {
      revenue: Money.fromScaled(totalRevenue),
      cost: Money.fromScaled(totalCost),
      margin: Money.fromScaled(totalRevenue - totalCost),
    },
  };
}
