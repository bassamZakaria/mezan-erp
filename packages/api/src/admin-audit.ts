import type { Context } from "hono";
import { recordSensitiveEvent, type AuditSeverity, type AuditSink } from "@mezan/domain";
import { getAuthContext } from "./permission-gate.js";

/**
 * The forensic trail for administrative acts.
 *
 * WHY THIS EXISTS. A customer's credit-limit edit was logged with its before
 * and after, while granting yourself approver rights, creating a user, editing
 * tenant settings and closing or reopening a period wrote nothing at all — so
 * the changes that decide who may do what left no record, and the change that
 * decides how much one customer may owe left a detailed one.
 *
 * Recording is best-effort by design: an audit sink that is unavailable must
 * not turn a legitimate admin action into a 500. What it must never do is
 * silently succeed while writing nothing, which is why the sink is a required
 * argument rather than an optional field with a default.
 */
export interface AdminAuditEntry {
  readonly module: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly action: string;
  readonly severity?: AuditSeverity;
  readonly details?: Readonly<Record<string, unknown>> | null;
}

export async function recordAdminEvent(
  audit: AuditSink | undefined,
  c: Context,
  entry: AdminAuditEntry,
): Promise<void> {
  if (!audit) return;
  await recordSensitiveEvent(audit, {
    module: entry.module,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    // The RESOLVED caller, never a header: the actor on a forensic record has
    // to be the identity the server issued, or the log is writable by whoever
    // it is meant to incriminate.
    actor: getAuthContext(c)?.userId ?? "system",
    severity: entry.severity ?? "WARNING",
    details: entry.details ?? null,
  });
}

/**
 * Which keys changed between two settings snapshots, and what they were.
 *
 * The values themselves travel because "settings changed" is not evidence of
 * anything — the question an auditor asks is whether someone turned OFF the
 * control that was in their way, and only the before/after answers it.
 */
export function changedKeys(
  before: Readonly<Record<string, unknown>> | null | undefined,
  after: Readonly<Record<string, unknown>>,
): Record<string, { readonly from: unknown; readonly to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    const from = before?.[key];
    const to = after[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) out[key] = { from: from ?? null, to: to ?? null };
  }
  return out;
}
