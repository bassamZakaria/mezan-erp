import { recordSensitiveEvent, type AuditSink } from "../audit/index.js";

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
 * Record one transition. A forensic write must never turn a legitimate
 * approval into a 500, so an absent sink is a no-op and a failing sink is
 * swallowed — the same rule the admin trail already follows.
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
  } catch {
    // Deliberately swallowed — see above.
  }
}
