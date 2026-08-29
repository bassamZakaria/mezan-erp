import { Hono } from "hono";
import {
  Money,
  computeBalanceReconciliation,
  findUnlinkedControlLines,
  type LedgerRepository,
  type NaturalBalance,
} from "@mezan/domain";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

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
}

/**
 * مطابقة الأرصدة — Balance Reconciliation (docs/archive/catalog/04), mounted under
 * `/reconciliation`. `GET /` returns the summary (sub-ledger vs GL control
 * account) and the القيود غير المرتبطة (unlinked control-account lines).
 * Permission: `accounting.reports.view`.
 */
export function createReconciliationRoutes(
  deps: ReconciliationRoutesDeps,
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("accounting.reports.view"), async (c) => {
    const controls = await deps.resolveControls();
    const comparisons = await Promise.all(
      controls.map(async (control) => {
        const bal = await deps.ledger.accountBalance(control.controlAccountId);
        // accountBalance.balance is debit − credit; present it on the natural side.
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
    const summary = computeBalanceReconciliation(comparisons);

    const controlIds = new Set(controls.map((x) => x.controlAccountId));
    const lines = (await deps.ledger.listLines?.()) ?? [];
    const unlinked = findUnlinkedControlLines(lines, controlIds);

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
