import type { Context } from "hono";
import {
  InactiveTaxRateError,
  TaxRateAlreadyClassifiedError,
  TaxRateClassificationPercentError,
  TaxRateNotFoundError,
  TaxRatePercentMismatchError,
  TaxRateUnverifiableError,
} from "@mezan/domain";

export function taxRateRefusal(c: Context, err: unknown): Response | null {
  if (err instanceof TaxRateAlreadyClassifiedError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, taxRateId: err.taxRateId }, 409);
  }
  if (
    err instanceof TaxRateNotFoundError ||
    err instanceof InactiveTaxRateError ||
    err instanceof TaxRateUnverifiableError ||
    err instanceof TaxRatePercentMismatchError ||
    err instanceof TaxRateClassificationPercentError
  ) {
    return c.json(
      { error: err.code, message: err.message, messageEn: err.messageEn, taxRateId: err.taxRateId },
      422,
    );
  }
  return null;
}
