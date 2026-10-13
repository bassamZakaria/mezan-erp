import { AuditRecordingError, recordSensitiveEvent, type AuditSink } from "../audit/index.js";

/**
 * سجل العمليات الحساسة للمقاولات — one shape for every contracting transition.
 *
 * Every status move in this module decides money: a certified quantity, an
 * approved payment, a released retention, a guarantee handed back. Until this
 * existed `/audit?module=contracting` answered with nothing at all, so an
 * approval could be traced to no one.
 */
export const CONTRACTING_AUDIT_MODULE = "contracting";

export interface ContractingTransitionAudit {
  /** e.g. "PROGRESS_CERTIFICATE", "SUB_CERTIFICATE", "LETTER_OF_GUARANTEE". */
  readonly entityType: string;
  readonly entityId: string;
  /** The transition, upper-case: "MEASURE", "CERTIFY", "APPROVE", "CANCEL", … */
  readonly action: string;
  readonly actor: string;
  readonly severity?: "CRITICAL" | "ERROR" | "WARNING" | "INFO";
  readonly details?: Readonly<Record<string, unknown>> | null;
}

/**
 * Record one transition. An absent sink is a no-op. A sink that fails INSIDE
 * the transaction the transition is being written in fails the transition with
 * it — the approval rolls back and the request is refused, so no approval
 * commits with no row saying who made it. Only where nothing ties the two
 * together is a failing sink still swallowed.
 */
export async function recordTransition(
  audit: AuditSink | undefined,
  event: ContractingTransitionAudit,
): Promise<void> {
  if (!audit) return;
  try {
    await recordSensitiveEvent(audit, {
      module: CONTRACTING_AUDIT_MODULE,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      actor: event.actor,
      severity: event.severity ?? "INFO",
      details: event.details ?? null,
    });
  } catch (err) {
    if (audit.insideTransaction?.() === true) throw new AuditRecordingError(err);
  }
}
