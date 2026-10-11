import type { Context } from "hono";
import { DocumentChangedError, VatPeriodAlreadyFiledError } from "@mezan/domain";

// INVARIANT: the ONE mapping of the two refusals any posting route can meet —
// the VAT return covering its date is filed, or the document moved under the
// request. No route maps either for itself: a handler asks here, or lets the
// error escape to the app's last net, which asks here too. So every route
// answers them with the same status and the same body, as a refusal the user
// can read and never as a 500 (`posting-refusal.structure.test.ts`).
export function postingRefusal(c: Context, err: unknown): Response | null {
  if (err instanceof VatPeriodAlreadyFiledError) {
    return c.json({ error: err.code, message: err.message, filingId: err.filingId, date: err.date }, 422);
  }
  if (err instanceof DocumentChangedError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  return null;
}
