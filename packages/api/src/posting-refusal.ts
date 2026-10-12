import type { Context } from "hono";
import { AllocationExceedsError, DocumentChangedError, VatPeriodAlreadyFiledError } from "@mezan/domain";

// INVARIANT: the ONE mapping of the two refusals any posting route can meet —
// the VAT return covering its date is filed, or the document moved under the
// request. No route maps either for itself: a handler asks here, or lets the
// error escape to the app's last net, which asks here too. So every route
// answers them with the same status and the same body, as a refusal the user
// can read and never as a 500 (`posting-refusal.structure.test.ts`).
const ALLOCATION_EXCEEDS_EN = "The amount is more than what is still open on the invoice or unallocated on the voucher.";

export function postingRefusal(c: Context, err: unknown): Response | null {
  if (err instanceof VatPeriodAlreadyFiledError) {
    return c.json({ error: err.code, message: err.message, filingId: err.filingId, date: err.date }, 422);
  }
  if (err instanceof DocumentChangedError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  // Two settlements that each fit the invoice alone and exceed it together:
  // the one that allocates second is refused here, on every route that
  // collects or pays, and is never a 500.
  if (err instanceof AllocationExceedsError) {
    return c.json({ error: err.code, message: err.message, messageEn: ALLOCATION_EXCEEDS_EN }, 422);
  }
  return null;
}
