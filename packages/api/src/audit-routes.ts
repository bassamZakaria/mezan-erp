import { Hono } from "hono";
import type { AuditQueryPort } from "@mezan/domain";
import { auditQuerySchema } from "@mezan/contracts";
import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from "./permission-gate.js";

/**
 * Read-only query surface over the append-only audit trail (`/audit`,
 * docs/plan.md §5.7). The write side (`AuditSink.append`, wired per-module via
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
  resolveAuthContext: AuthContextResolver = headerAuthContextResolver,
) {
  const app = new Hono();
  const gate = createPermissionGate(resolveAuthContext);

  app.get("/", gate("audit.logs.view"), async (c) => {
    const parsed = auditQuerySchema.safeParse({
      stream: c.req.query("stream"),
      branchId: c.req.query("branchId"),
      module: c.req.query("module"),
      action: c.req.query("action"),
      actor: c.req.query("actor"),
      entityType: c.req.query("entityType"),
      entityId: c.req.query("entityId"),
      severity: c.req.query("severity"),
      from: c.req.query("from"),
      to: c.req.query("to"),
      limit: c.req.query("limit"),
      offset: c.req.query("offset"),
    });
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const result = await store.queryEvents(parsed.data);
    return c.json(result);
  });

  return app;
}
