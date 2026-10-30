import { Hono } from "hono";
import { VAN_STOCK_STEP_KINDS, type AuditEvent, type AuditQueryPort, type VanReconciliationStepKind } from "@mezan/domain";
import type { AuditChainVerifyPort } from "@mezan/persistence";
import { auditQuerySchema } from "@mezan/contracts";
import { branchGrantOf, createPermissionGate, getAuthContext, maySeeItemCost, omitUnless, type AuthContextResolver } from "./permission-gate.js";

const COST_FIELDS: ReadonlySet<string> = new Set(["costPrice", "defaultCost"]);

enum CostBearingAuditEntity {
  MaterialConsumption = "MATERIAL_CONSUMPTION",
  WritedownRun = "WRITEDOWN_RUN",
  VanTrip = "VAN_TRIP",
}

/** SECURITY: detail keys written at item cost; a new audit write that records item cost must be listed here (#119). */
const COST_DETAIL_KEYS: Readonly<Record<CostBearingAuditEntity, readonly string[]>> = {
  [CostBearingAuditEntity.MaterialConsumption]: ["totalCost"],
  [CostBearingAuditEntity.WritedownRun]: ["totalAmount"],
  [CostBearingAuditEntity.VanTrip]: ["varianceValue"],
};

function redactChanges(details: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const changes = details["changes"];
  if (!Array.isArray(changes)) return details;
  return {
    ...details,
    changes: changes.map((change: unknown) => {
      const field = (change as { field?: unknown } | null)?.field;
      if (typeof field !== "string" || !COST_FIELDS.has(field)) return change;
      return { ...(change as object), from: null, to: null, redacted: true };
    }),
  };
}

function redactStockSteps(details: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const steps = details["steps"];
  if (!Array.isArray(steps)) return details;
  return {
    ...details,
    steps: steps.map((step: unknown) => {
      const kind = (step as { kind?: unknown } | null)?.kind;
      return VAN_STOCK_STEP_KINDS.has(kind as VanReconciliationStepKind) ? { ...(step as object), value: null } : step;
    }),
  };
}

export function redactCost(event: AuditEvent): AuditEvent {
  if (!event.details) return event;
  const withoutSteps = event.entityType === CostBearingAuditEntity.VanTrip ? redactStockSteps(event.details) : event.details;
  const details = omitUnless(false, redactChanges(withoutSteps), (COST_DETAIL_KEYS as Readonly<Record<string, readonly string[]>>)[event.entityType] ?? []);
  return { ...event, details };
}

/**
 * Read-only query surface over the append-only audit trail (`/audit`,
 * docs/archive/plan.md §5.7). The write side (`AuditSink.append`, wired per-module via
 * `recordSensitiveEvent`/`recordSecurityEvent`) is unaffected — this mounts
 * only a filtered `GET`. No PATCH/DELETE exists on this router by design: an
 * audit row is evidence, not editable state.
 *
 * `branchId` narrows to one branch. Rows with no branch — written before the
 * column existed, or by a request not narrowed to a single branch — never
 * match it: an unknown branch is not every branch.
 */
export function createAuditRoutes(
  store: AuditQueryPort,
  resolveAuthContext: AuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  /**
   * «تحقق من سلامة السجل» — walks the hash chain and names the first row that
   * does not verify.
   *
   * Declared BEFORE `/` so the static segment is matched first, and read-only:
   * it recomputes hashes, it never repairs one. A trail that reports itself
   * healthy after being "repaired" would be worse than no check at all.
   *
   * A store built before the chain existed (any `AuditQueryPort` that is not
   * also an `AuditChainVerifyPort` — the LAN mount passes one) answers 501
   * rather than a green tick it cannot justify.
   */
  app.get("/verify", gate("audit.logs.view"), async (c) => {
    const verifier = store as Partial<AuditChainVerifyPort>;
    if (typeof verifier.verifyChain !== "function") {
      return c.json(
        { error: "UNSUPPORTED", message: "لا يمكن التحقق من سلسلة السجل على هذا المصدر." },
        501,
      );
    }
    return c.json(await verifier.verifyChain());
  });

  app.get("/", gate("audit.logs.view"), async (c) => {
    const parsed = auditQuerySchema.safeParse({
      stream: c.req.query("stream"),
      branchId: c.req.query("branchId"),
      module: c.req.query("module"),
      action: c.req.query("action"),
      actor: c.req.query("actor"),
      entityType: c.req.query("entityType"),
      entityId: c.req.query("entityId"),
      field: c.req.query("field"),
      severity: c.req.query("severity"),
      from: c.req.query("from"),
      to: c.req.query("to"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const seeCost = maySeeItemCost(c);
    if (!seeCost && parsed.data.field && COST_FIELDS.has(parsed.data.field)) return c.json({ events: [], total: 0 });
    const ctx = getAuthContext(c);
    // SECURITY: a branch-granted reader is held to rows stamped with its own
    // branches. A row with no branch is not shown to it — most were written by
    // an all-branches caller about some other branch's document (D30).
    const grant = ctx ? branchGrantOf(c) : undefined;
    const result = await store.queryEvents(grant ? { ...parsed.data, branchIds: grant } : parsed.data);
    if (seeCost) return c.json(result);
    return c.json({ ...result, events: result.events.map(redactCost) });
  });

  return app;
}
