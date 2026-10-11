import type { Context } from "hono";
import { VatPeriodAlreadyFiledError } from "@mezan/domain";

// INVARIANT: the ONE mapping of a posting refused because the VAT return
// covering its date is filed. Every route that posts — a confirm, a void, a
// return, a voucher, a payroll run — may let the error escape its own handler:
// the app's last net answers it here, as a refusal the user can read, never as
// a 500.
export function postingRefusal(c: Context, err: unknown): Response | null {
  if (err instanceof VatPeriodAlreadyFiledError) {
    return c.json({ error: err.code, message: err.message, filingId: err.filingId, date: err.date }, 422);
  }
  return null;
}
