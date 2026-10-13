import type { Context } from "hono";
import {
  LandedCostDateBeforeStockMovementError,
  LandedCostStandsOnDocumentError,
  ApprovalRequestRejectedError,
  DocumentNotFoundError,
  InvalidDocumentError,
  InvalidDocumentTransitionError,
  MissingHookError,
  ReversalNotReversibleError,
  NegativeStockError,
  UncostedDeficitIssueError,
  InvalidStockMovementError,
} from "@mezan/domain";
import { duplicateIdRefusal } from "./duplicate-id.js";
import { DuplicateRecordIdError } from "@mezan/domain";
import { reversalRefusalResponse } from "./document-reversal.js";

/**
 * Shared error → HTTP mapping for every document-framework-backed router
 * (sales/purchase returns, landed costs, installment plans) — the same set of
 * domain errors `DocumentService.confirm/cancel/reverse` can throw, plus the
 * stock-ledger errors a `buildStockPlan` confirm can surface.
 */
export function handleDocumentError(c: Context, err: unknown): Response {
  if (err instanceof DuplicateRecordIdError) return duplicateIdRefusal(c, err);
  const refuse = (e: Error & { code: string; messageEn?: string }, status: 404 | 409 | 422 | 500) =>
    c.json({ error: e.code, message: e.message, ...(e.messageEn ? { messageEn: e.messageEn } : {}) }, status);
  const postingRefusal = reversalRefusalResponse(c, err);
  if (postingRefusal) return postingRefusal;
  if (err instanceof DocumentNotFoundError) {
    return refuse(err, 404);
  }
  if (err instanceof ApprovalRequestRejectedError) {
    return refuse(err, 409);
  }
  if (err instanceof InvalidDocumentTransitionError) {
    return refuse(err, 409);
  }
  if (
    err instanceof LandedCostDateBeforeStockMovementError ||
    err instanceof LandedCostStandsOnDocumentError
  ) {
    return c.json(
      {
        error: err.code,
        message: err.message,
        messageEn: err.messageEn,
        ...(err instanceof LandedCostDateBeforeStockMovementError ? { earliestAllowedDate: err.earliestAllowedDate } : {}),
      },
      422,
    );
  }
  if (err instanceof InvalidDocumentError || err instanceof ReversalNotReversibleError) {
    return refuse(err, 422);
  }
  if (err instanceof MissingHookError) {
    return refuse(err, 500);
  }
  if (err instanceof NegativeStockError) {
    return c.json(
      { error: err.code, message: err.message, onHand: err.onHand.toString(), requested: err.requested.toString() },
      422,
    );
  }
  if (err instanceof UncostedDeficitIssueError) {
    return c.json({ error: err.code, message: err.message, requested: err.requested.toString() }, 422);
  }
  if (err instanceof InvalidStockMovementError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  throw err;
}
