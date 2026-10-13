import type { Context } from "hono";
import {
  auditBranchFromScope,
  auditFieldValue,
  createAuditEvent,
  diffAuditFields,
  recordSecurityEvent,
  recordSensitiveEvent,
  type AuditChangeAction,
  type AuditEvent,
  type AuditFieldChange,
  type AuditSeverity,
  type AuditSink,
} from "@mezan/domain";
import { getAuthContext } from "./permission-gate.js";
import { requestOrigin } from "./request-origin.js";

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

export function buildAdminEvent(c: Context, entry: AdminAuditEntry): AuditEvent {
  const ctx = getAuthContext(c);
  return createAuditEvent({
    stream: "sensitive",
    module: entry.module,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    // The RESOLVED caller, never a header: the actor on a forensic record has
    // to be the identity the server issued, or the log is writable by whoever
    // it is meant to incriminate.
    actor: ctx?.userId ?? "system",
    /*
     * WHICH branch the act came from, read off the caller's own scope rather
     * than anything they send. The webhook routes were the ONLY writer that
     * ever stamped this, and DEC-17 deleted them — which would have left
     * `AuditEvent.branchId` and the audit screen's branch filter with no
     * producer at all, the exact failure shape this field was added to avoid.
     * An all-branch caller resolves to null and stays visible unfiltered.
     */
    branchId: ctx ? auditBranchFromScope(ctx.branchScope) : null,
    severity: entry.severity ?? "WARNING",
    details: withOrigin(c, entry.details),
  });
}

export async function recordAdminEvent(
  audit: AuditSink | undefined,
  c: Context,
  entry: AdminAuditEntry,
): Promise<void> {
  if (!audit) return;
  await audit.append(buildAdminEvent(c, entry));
}

/**
 * WHERE the act came from, stamped onto every administrative record.
 *
 * The session grant carries a user id, permissions, a role code and two scopes
 * — and no origin. The audit row carries an actor, a branch and a timestamp —
 * and no origin. So after a cash shortfall at till 3 there was no way to
 * establish that the adjustment came from till 3 rather than the back office,
 * at any layer. Since the desktop edition now serves the same app over a LAN
 * socket as well as in-process, that went from a small gap to the general case.
 *
 * `requestOrigin` reads the socket, never a header (see request-origin.ts), so
 * this is one field on a forensic record that the party it may incriminate
 * cannot write. "host" means the request came from inside the process — the
 * machine's own console — which is a fact, not a missing value.
 */
function withOrigin(
  c: Context,
  details: Readonly<Record<string, unknown>> | null | undefined,
): Readonly<Record<string, unknown>> {
  return { ...(details ?? {}), origin: requestOrigin(c) ?? "host" };
}

/**
 * The same, on the SECURITY stream (أحداث الأمان).
 *
 * The two streams are not decoration. `sensitive` answers "who changed this
 * record"; `security` answers "who tried to take authority they do not have,
 * and who reset whose credential" — the questions an auditor asks first and the
 * ones the أحداث الأمان tab shows. Before this, `recordSecurityEvent` had
 * exactly two call sites in the whole product, both self-service, so that tab
 * read empty on a live tenant — which an owner reads as "nothing is happening".
 */
export async function recordSecurityAdminEvent(
  audit: AuditSink | undefined,
  c: Context,
  entry: AdminAuditEntry,
): Promise<void> {
  if (!audit) return;
  await recordSecurityEvent(audit, {
    module: entry.module,
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    actor: getAuthContext(c)?.userId ?? "anonymous",
    severity: entry.severity ?? "CRITICAL",
    details: withOrigin(c, entry.details),
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

export interface AuditEntityRef {
  readonly module: string;
  readonly entityType: string;
  readonly entityId: string | null;
}

export interface FieldChangesEntry<T extends object> {
  readonly entity: AuditEntityRef;
  readonly action: AuditChangeAction;
  readonly before: T | null | undefined;
  readonly after: T;
  readonly fields: readonly (keyof T & string)[];
  readonly warnOn?: readonly string[];
  readonly severity?: AuditSeverity;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly extraChanges?: readonly AuditFieldChange[];
}

export async function recordFieldChanges<T extends object>(
  audit: AuditSink | undefined,
  c: Context,
  entry: FieldChangesEntry<T>,
): Promise<readonly AuditFieldChange[]> {
  const changes = [...diffAuditFields(entry.before, entry.after, entry.fields), ...(entry.extraChanges ?? [])];
  const warned = entry.warnOn ?? [];
  const severity = entry.severity ?? (changes.some((change) => warned.includes(change.field)) ? "WARNING" : "INFO");
  await recordAdminEvent(audit, c, {
    module: entry.entity.module,
    entityType: entry.entity.entityType,
    entityId: entry.entity.entityId,
    action: entry.action,
    severity,
    details: { ...(entry.details ?? {}), changes },
  });
  return changes;
}

export function changedKeysAsFieldChanges(
  changed: Readonly<Record<string, { readonly from: unknown; readonly to: unknown }>>,
): AuditFieldChange[] {
  return Object.entries(changed).map(([field, { from, to }]) => ({
    field,
    from: auditFieldValue(from),
    to: auditFieldValue(to),
  }));
}
