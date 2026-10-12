import { Hono } from "hono";
import {
  Money,
  computeBalanceReconciliation,
  findUnlinkedControlLines,
  type LedgerRepository,
  type NaturalBalance,
  type ReconciliationSummary,
  type ForeignResidue,
} from "@mezan/domain";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

/** One sub-ledger↔GL control-account pairing to reconcile. */
export interface ReconciliationControl {
  readonly key: string;
  readonly label: string;
  readonly controlAccountId: string;
  readonly naturalBalance: NaturalBalance;
  /** Balance from the sub-ledger's own records (normal-positive on its natural side). */
  readonly subLedgerBalance: Money;
}

export interface ReconciliationRoutesDeps {
  readonly ledger: LedgerRepository;
  /** Yields the sub-ledger balances to check against their GL control accounts. */
  readonly resolveControls: () => Promise<readonly ReconciliationControl[]>;
  /** Every account and document holding none of its foreign currency while base is still carried on it. */
  readonly foreignResidues?: () => Promise<readonly ForeignResidue[]>;
}

/**
 * The one place a sub-ledger balance is set against its GL control account.
 * `/reconciliation` and the period-close checklist both call this, so the two
 * can never state different differences for the same control.
 */
export async function reconcileControls(
  ledger: Pick<LedgerRepository, "accountBalance">,
  controls: readonly ReconciliationControl[],
  asOfDate?: string,
): Promise<ReconciliationSummary> {
  const comparisons = await Promise.all(
    controls.map(async (control) => {
      const bal = await ledger.accountBalance(control.controlAccountId, asOfDate);
      const glBalance = control.naturalBalance === "debit" ? bal.balance : Money.fromScaled(-bal.balance.scaled);
      return {
        key: control.key,
        label: control.label,
        controlAccountId: control.controlAccountId,
        subLedgerBalance: control.subLedgerBalance,
        glBalance,
      };
    }),
  );
  return computeBalanceReconciliation(comparisons);
}

/**
 * مطابقة الأرصدة — Balance Reconciliation (docs/archive/catalog/04), mounted under
 * `/reconciliation`. `GET /` returns the summary (sub-ledger vs GL control
 * account) and the القيود غير المرتبطة (unlinked control-account lines).
 * Permission: `accounting.reports.view`.
 */
export function createReconciliationRoutes(
  deps: ReconciliationRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("accounting.reports.view"), async (c) => {
    const controls = await deps.resolveControls();
    const summary = await reconcileControls(deps.ledger, controls);

    const controlIds = new Set(controls.map((x) => x.controlAccountId));
    const lines = (await deps.ledger.listLines?.()) ?? [];
    const unlinked = findUnlinkedControlLines(lines, controlIds);
    const residues = (await deps.foreignResidues?.()) ?? [];
    const residueTotal = residues.reduce((sum, row) => sum + (row.base.scaled < 0n ? -row.base.scaled : row.base.scaled), 0n);

    return c.json({
      rows: summary.rows.map((r) => ({
        key: r.key,
        label: r.label,
        controlAccountId: r.controlAccountId,
        subLedgerBalance: r.subLedgerBalance.toString(),
        glBalance: r.glBalance.toString(),
        difference: r.difference.toString(),
        matched: r.matched,
      })),
      allMatched: summary.allMatched,
      foreignResidue: {
        total: Money.fromScaled(residueTotal).toString(),
        rows: residues.map((row) => ({ kind: row.kind, ref: row.ref, currency: row.currency, base: row.base.toString() })),
      },
      unlinked: unlinked.map((u) => ({
        entryId: u.entryId,
        entryNo: u.entryNo,
        date: u.date,
        accountId: u.accountId,
        memo: u.memo,
        debit: u.debit.toString(),
        credit: u.credit.toString(),
      })),
    });
  });

  return app;
}
