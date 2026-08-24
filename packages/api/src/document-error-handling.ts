import type { Context } from "hono";
import {
  ApprovalRequestRejectedError,
  DocumentNotFoundError,
  DuplicateDocumentError,
  InvalidDocumentError,
  InvalidDocumentTransitionError,
  MissingHookError,
  NegativeStockError,
  InvalidStockMovementError,
} from "@mezan/domain";

/**
 * Shared error → HTTP mapping for every document-framework-backed router
 * (sales/purchase returns, landed costs, installment plans) — the same set of
 * domain errors `DocumentService.confirm/cancel/reverse` can throw, plus the
 * stock-ledger errors a `buildStockPlan` confirm can surface.
 */
export function handleDocumentError(c: Context, err: unknown): Response {
  if (err instanceof DocumentNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  if (err instanceof DuplicateDocumentError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof ApprovalRequestRejectedError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidDocumentTransitionError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof InvalidDocumentError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof MissingHookError) {
    return c.json({ error: err.code, message: err.message }, 500);
  }
  if (err instanceof NegativeStockError) {
    return c.json(
      { error: err.code, message: err.message, onHand: err.onHand.toString(), requested: err.requested.toString() },
      422,
    );
  }
  if (err instanceof InvalidStockMovementError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  throw err;
}
