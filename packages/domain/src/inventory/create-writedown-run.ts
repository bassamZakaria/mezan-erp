import { Money } from "../money/index.js";
import {
  DEFAULT_AGING_WRITEDOWN_POLICY,
  agingDaysBetween,
  applyRateBps,
  periodEndDate,
  writedownRateForAgingDays,
  type AgingBand,
} from "./aging.js";
import { DuplicateWritedownPeriodError, NoSlowMovingStockError } from "./errors.js";
import type { WritedownRun, WritedownRunLine, WritedownRunRepository } from "./writedown-run.js";
import type { StockLedgerRepository, WacSnapshotRepository } from "./ports.js";

export interface CreateWritedownRunCommand {
  readonly id: string;
  /** "YYYY-MM" */
  readonly period: string;
  /** Null (default) scopes the run to every warehouse. */
  readonly warehouseId?: string | null;
  /** Overrides the shipped default aging policy. */
  readonly policy?: readonly AgingBand[];
  readonly now?: () => string;
}

export interface CreateWritedownRunDeps {
  readonly runs: WritedownRunRepository;
  readonly wacSnapshots: WacSnapshotRepository;
  readonly stockLedger: StockLedgerRepository;
}

/**
 * Builds a مسودة (draft) write-down run for a period (+ optional warehouse
 * scope): rejects a duplicate non-cancelled run for the same period+scope,
 * scans every on-hand stock position's WAC snapshot, ages each by its last
 * ledger movement (docs/archive/phase-backlog.md "aging-based … against slow-moving stock"),
 * applies the aging policy's rate to the position's recorded WAC value, keeps
 * only non-zero lines, and rejects an empty result. Never mutates a cost
 * layer or the WAC snapshot itself — the batch only reads them.
 */
export async function createWritedownRun(
  cmd: CreateWritedownRunCommand,
  deps: CreateWritedownRunDeps,
): Promise<WritedownRun> {
  const warehouseId = cmd.warehouseId ?? null;

  const existingRun = await deps.runs.findByPeriod(cmd.period, warehouseId);
  if (existingRun && existingRun.status !== "cancelled") {
    throw new DuplicateWritedownPeriodError(cmd.period, warehouseId);
  }

  const asOfDate = periodEndDate(cmd.period);
  const policy = cmd.policy ?? DEFAULT_AGING_WRITEDOWN_POLICY;

  const snapshots = await deps.wacSnapshots.list();
  const scoped = snapshots.filter(
    (s) => s.onHand.scaled > 0n && (warehouseId === null || s.warehouseId === warehouseId),
  );

  const lines: WritedownRunLine[] = [];
  for (const snapshot of scoped) {
    const movements = await deps.stockLedger.listByPosition(snapshot.itemId, snapshot.warehouseId);
    if (movements.length === 0) continue; // no ledger history — nothing to age against
    const lastMovement = movements[movements.length - 1]!;
    const agingDays = agingDaysBetween(lastMovement.occurredAt, asOfDate);
    const writedownRateBps = writedownRateForAgingDays(agingDays, policy);
    if (writedownRateBps <= 0) continue;

    const amount = applyRateBps(snapshot.totalValue, writedownRateBps);
    if (amount.scaled <= 0n) continue;

    lines.push({
      itemId: snapshot.itemId,
      warehouseId: snapshot.warehouseId,
      onHandQty: snapshot.onHand,
      unitCost: snapshot.averageCost,
      agingDays,
      writedownRateBps,
      amount,
    });
  }

  if (lines.length === 0) {
    throw new NoSlowMovingStockError(cmd.period);
  }

  const run: WritedownRun = {
    id: cmd.id,
    period: cmd.period,
    warehouseId,
    status: "draft",
    lines,
    totalAmount: Money.sum(lines.map((l) => l.amount)),
    journalEntryId: null,
    createdAt: cmd.now?.() ?? new Date().toISOString(),
    postedAt: null,
  };

  await deps.runs.create(run);
  return run;
}
