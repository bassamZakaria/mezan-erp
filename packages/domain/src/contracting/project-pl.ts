import { Money } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import type { PostedLine } from "../gl/ledger.js";
import type { Project } from "../projects/project.js";
import { COST_CATEGORIES, type CostCategory } from "./cost-category.js";
import type { ProjectStatusFlag } from "./recognition/project-flags.js";

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
  /** أعمال تحت التنفيذ still standing in 1230 — zero on a project whose month has been run. */
  readonly wipBalance: Money;
  /** أصل العقد (1170) — what has been recognised beyond what has been billed. */
  readonly contractAsset: Money;
  /** التزام العقد (2175) — what has been billed beyond what has been recognised. */
  readonly contractLiability: Money;
  /** Cumulative مستخلصات credited to 2165, including what the runs have already reclassified. */
  readonly billedToDate: Money;
  /** Cumulative إيرادات المقاولات (4100) credited against this project. */
  readonly revenueRecognised: Money;
  /** «عقد خاسر — مخصّص واجب» / «غرامة تأخير محتملة», derived on every read. */
  readonly flags: readonly ProjectStatusFlag[];
}

/** The contracting accounts the project rows read their balance-sheet figures from. */
export interface ProjectContractingAccountIds {
  readonly wip: string;
  readonly contractAsset: string;
  readonly contractLiability: string;
  readonly billings: string;
  readonly revenue: string;
}

export interface ProjectContractingInput {
  /**
   * Posted lines on those accounts, CUMULATIVE to the report's end date — a
   * balance-sheet figure is not a period movement, and clipping it to the
   * report's start date would report a WIP balance that never existed.
   */
  readonly lines: readonly PostedLine[];
  readonly accounts: ProjectContractingAccountIds;
  /**
   * Σ billedInPeriod over each project's live recognition runs. The monthly run
   * debits 2165 to reclassify it, so the account's own balance holds only what
   * has NOT been recognised yet; without this the billed figure would fall back
   * to zero after every run.
   */
  readonly billedReclassedByProject?: ReadonlyMap<string, Money>;
  readonly flagsByProject?: ReadonlyMap<string, readonly ProjectStatusFlag[]>;
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

interface ContractingBucket {
  wip: bigint;
  contractAsset: bigint;
  contractLiability: bigint;
  billings: bigint;
  revenueRecognised: bigint;
}

function contractingBuckets(input: ProjectContractingInput | undefined): Map<string, ContractingBucket> {
  const buckets = new Map<string, ContractingBucket>();
  if (!input) return buckets;
  for (const line of input.lines) {
    if (line.projectId === null) continue;
    let bucket = buckets.get(line.projectId);
    if (!bucket) {
      bucket = { wip: 0n, contractAsset: 0n, contractLiability: 0n, billings: 0n, revenueRecognised: 0n };
      buckets.set(line.projectId, bucket);
    }
    const debitNet = line.debit.scaled - line.credit.scaled;
    if (line.accountId === input.accounts.wip) bucket.wip += debitNet;
    if (line.accountId === input.accounts.contractAsset) bucket.contractAsset += debitNet;
    if (line.accountId === input.accounts.contractLiability) bucket.contractLiability -= debitNet;
    if (line.accountId === input.accounts.billings) bucket.billings -= debitNet;
    if (line.accountId === input.accounts.revenue) bucket.revenueRecognised -= debitNet;
  }
  return buckets;
}

export function computeProjectPnL(
  lines: readonly PostedLine[],
  accounts: readonly Account[],
  projects: readonly Project[],
  contracting?: ProjectContractingInput,
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

  const contractingByProject = contractingBuckets(contracting);
  for (const id of contractingByProject.keys()) {
    if (!buckets.has(id)) buckets.set(id, { revenue: 0n, cost: 0n, byCategory: new Map() });
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
    const contract = contractingByProject.get(id) ?? {
      wip: 0n,
      contractAsset: 0n,
      contractLiability: 0n,
      billings: 0n,
      revenueRecognised: 0n,
    };
    const reclassed = contracting?.billedReclassedByProject?.get(id)?.scaled ?? 0n;
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
      wipBalance: Money.fromScaled(contract.wip),
      contractAsset: Money.fromScaled(contract.contractAsset > 0n ? contract.contractAsset : 0n),
      contractLiability: Money.fromScaled(contract.contractLiability > 0n ? contract.contractLiability : 0n),
      billedToDate: Money.fromScaled(contract.billings + reclassed),
      revenueRecognised: Money.fromScaled(contract.revenueRecognised),
      flags: contracting?.flagsByProject?.get(id) ?? [],
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
