import { Hono } from "hono";
import type { AuditQueryPort } from "@mezan/domain";
import type { AuditChainVerifyPort } from "@mezan/persistence";
import { auditQuerySchema } from "@mezan/contracts";
import { createPermissionGate, type AuthContextResolver } from "./permission-gate.js";

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
