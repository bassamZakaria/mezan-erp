/**
 * Branch attribution for the audit trail.
 *
 * There is exactly ONE place the server learns the caller's active branch: the
 * `branchScope` on the request's `AuthContext`, which the shell's working-branch
 * selector narrows to a single id (apps/web/src/data/session.ts sends it as
 * `x-branch-scope`; packages/api/src/permission-gate.ts resolves it). These two
 * helpers reuse that and add no second mechanism.
 */

import { ALL_SCOPE, type ScopeSelection } from "../permissions/auth-context.js";
import type { AuditEvent, AuditSink } from "./audit-event.js";

/**
 * The single branch an audited action happened in, or `null` when the request
 * is not narrowed to one. `"*"` and a multi-branch grant both yield `null`:
 * the caller *may* act in several branches, so naming any one of them would be
 * a guess, and a guess in an append-only forensic log is worse than a gap.
 */
export function auditBranchFromScope(branchScope: ScopeSelection): string | null {
  if (branchScope === ALL_SCOPE) return null;
  return branchScope.length === 1 ? (branchScope[0] ?? null) : null;
}

/**
 * Wraps a sink so every event appended through it carries `branchId`, without
 * each recording site having to thread it. An event that already names a branch
 * keeps its own — the caller's knowledge beats the request scope.
 */
export function branchScopedAuditSink(sink: AuditSink, branchId: string | null): AuditSink {
  if (branchId === null) return sink;
  return {
    append(event: AuditEvent): Promise<void> {
      return sink.append(event.branchId === null ? { ...event, branchId } : event);
    },
    query: sink.query.bind(sink),
  };
}
