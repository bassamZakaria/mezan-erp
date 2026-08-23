/**
 * Persisted document-workflow gate — an adapter over the pure engine
 * (`gate.ts`) that ALSO durably saves the resulting {@link ApprovalRequest}, so
 * a later `decide()` (approve/reject, driven by the `/workflow` API) has state
 * to act on.
 *
 * `createDocumentWorkflowGate` in `../documents/journal-document.ts` evaluates
 * the gate too, but only returns `{granted, requestId}` and discards the
 * request itself — fine for a document type that never needs a queryable
 * inbox, but the approvals surface needs the request to survive past the one
 * `evaluate()` call. This is the same evaluation, wired to a store.
 */

import { startApproval, type ApprovalRequest, type GateConfig } from "./gate.js";
import type { GateableActionType } from "./action-types.js";
import type {
  DocumentWorkflowDecision,
  DocumentWorkflowGate,
  DocumentWorkflowInput,
} from "../documents/hooks.js";

/** The persistence port this adapter needs — one write, no reads (queries go through the API's own store). */
export interface ApprovalRequestStore {
  save(request: ApprovalRequest): Promise<void>;
}

/**
 * Same contract as {@link DocumentWorkflowGate} plus a `store` the caller binds
 * to a real repository (SQLite in `@mezan/persistence`). `resolveConfig` reads
 * the tenant's configured chain for an action type; no steps (or an admin
 * submitter) grants immediately, same as the non-persisted adapter.
 */
export function createPersistedDocumentWorkflowGate(
  resolveConfig: (actionType: GateableActionType) => GateConfig | null,
  store: ApprovalRequestStore,
): DocumentWorkflowGate {
  return {
    async evaluate(input: DocumentWorkflowInput): Promise<DocumentWorkflowDecision> {
      const config = resolveConfig(input.actionType) ?? { actionType: input.actionType, steps: [] };
      const { request } = startApproval(config, {
        requestId: input.requestId,
        submittedBy: input.submittedBy,
        submitterRoles: input.submitterRoles,
      });
      await store.save(request);
      return { granted: request.status === "approved", requestId: request.id };
    },
  };
}
