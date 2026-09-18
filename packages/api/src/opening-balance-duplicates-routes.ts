import { Hono, type Context } from "hono";
import {
  createOpeningBalanceDuplicatesReport,
  runReport,
  recordSensitiveEvent,
  NoFiscalPeriodForDateError,
  PeriodNotOpenForPostingError,
  VatPeriodAlreadyFiledError,
  JournalEntryAlreadyReversedError,
  JournalEntryNotFoundError,
  JournalEntryNotPostedError,
  type AuditSink,
  type OpeningBalanceDuplicatesContext,
  type RunReportOutcome,
} from "@mezan/domain";
import { createPermissionGate, getAuthContext, type AuthContextResolver } from "./permission-gate.js";

export interface OpeningBalanceDuplicatesRoutesDeps {
  readonly resolveContext: () => Promise<OpeningBalanceDuplicatesContext>;
  /**
   * Re-runs the party's own poster (`postPartyOpeningBalance`, "sync" mode)
   * against its OWN current `openingBalance` — the same correction path a
   * screen edit takes, so the only thing it can do is reverse whatever is
   * redundant. `null` means the party id does not exist; `false` means there
   * was nothing to reverse (already repaired, or never duplicated) — that is
   * the idempotency the repair action is required to have (D241).
   */
  readonly repair: (kind: "customer" | "supplier", partyId: string) => Promise<boolean | null>;
  readonly audit?: AuditSink;
}

function respond(c: Context, outcome: RunReportOutcome<unknown, unknown>): Response {
  if (!outcome.ok) return c.json({ error: "VALIDATION_ERROR", errors: outcome.errors }, 400);
  return c.json({
    params: outcome.params,
    rows: outcome.rows,
    groups: outcome.groups,
    grandTotals: outcome.grandTotals,
    reconciliation: outcome.reconciliation,
    kpis: outcome.kpis,
  });
}

function handleDomainError(c: Context, err: unknown): Response {
  if (err instanceof NoFiscalPeriodForDateError || err instanceof PeriodNotOpenForPostingError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof VatPeriodAlreadyFiledError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof JournalEntryNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof JournalEntryNotPostedError || err instanceof JournalEntryAlreadyReversedError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  throw err;
}

/**
 * تكرار ترحيل الأرصدة الافتتاحية — Duplicate Opening-Balance Postings (D241),
 * mounted under `/gl/opening-balance-duplicates`:
 *
 *   GET  /            the read-only exceptions report — every party posted
 *                      more than once, and the excess still on the control
 *                      account (`accounting.reports.view`)
 *   POST /:kind/:partyId/repair
 *                      posts the reversing entry that removes exactly the
 *                      excess (`accounting.journal.post` — the GL posting
 *                      permission, same gate `/gl/journal-entries/:id/reverse`
 *                      uses). Posted entries are never edited or deleted
 *                      (docs/archive/plan.md §3 rule 1): this reverses.
 *
 * Read-only report, mutating action gated separately — `reports-routes.ts`'s
 * own convention is GET-only, so the action lives here instead of there.
 */
export function createOpeningBalanceDuplicatesRoutes(
  deps: OpeningBalanceDuplicatesRoutesDeps,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("accounting.reports.view"), async (c) => {
    const definition = createOpeningBalanceDuplicatesReport();
    const ctx = await deps.resolveContext();
    return respond(c, runReport(definition, {}, ctx));
  });

  app.post("/:kind/:partyId/repair", gate("accounting.journal.post"), async (c) => {
    const kind = c.req.param("kind");
    if (kind !== "customer" && kind !== "supplier") {
      return c.json({ error: "INVALID_PARTY_KIND", message: "النوع يجب أن يكون عميل أو مورد." }, 400);
    }
    const partyId = c.req.param("partyId");
    try {
      const repaired = await deps.repair(kind, partyId);
      if (repaired === null) return c.json({ error: "NOT_FOUND" }, 404);
      if (deps.audit) {
        await recordSensitiveEvent(deps.audit, {
          module: "accounting",
          entityType: kind === "customer" ? "CUSTOMER" : "SUPPLIER",
          entityId: partyId,
          action: "REPAIR_DUPLICATE_OPENING_BALANCE",
          actor: getAuthContext(c)?.userId ?? "system",
          severity: "WARNING",
          details: { kind, partyId, repaired },
        });
      }
      return c.json({ kind, partyId, repaired });
    } catch (err) {
      return handleDomainError(c, err);
    }
  });

  return app;
}
