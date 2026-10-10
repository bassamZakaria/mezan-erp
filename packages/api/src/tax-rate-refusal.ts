import type { Context } from "hono";
import { InactiveTaxRateError, TaxRateNotFoundError, TaxRatePercentMismatchError } from "@mezan/domain";

export function taxRateRefusal(c: Context, err: unknown): Response | null {
  if (
    err instanceof TaxRateNotFoundError ||
    err instanceof InactiveTaxRateError ||
    err instanceof TaxRatePercentMismatchError
  ) {
    return c.json(
      { error: err.code, message: err.message, messageEn: err.messageEn, taxRateId: err.taxRateId },
      422,
    );
  }
  return null;
}
