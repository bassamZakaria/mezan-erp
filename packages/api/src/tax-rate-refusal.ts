import type { Context } from "hono";
import {
  InactiveTaxRateError,
  JournalTaxTagUnsupportedError,
  PostedLineNotFoundError,
  TaxClassificationAlreadyFiledError,
  TaxClassificationNotPostedError,
  TaxClassificationSharedPostingError,
  TaxRateAlreadyClassifiedError,
  TaxRateClassificationPercentError,
  TaxRateNotFoundError,
  TaxRatePercentMismatchError,
  TaxRateUnverifiableError,
  VatPeriodAlreadyFiledError,
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

export function taxClassificationRefusal(c: Context, err: unknown): Response | null {
  if (err instanceof PostedLineNotFoundError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 404);
  }
  if (err instanceof TaxClassificationSharedPostingError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, sharedLineIds: err.sharedLineRefs }, 409);
  }
  if (err instanceof TaxClassificationNotPostedError || err instanceof TaxClassificationAlreadyFiledError) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn }, 409);
  }
  if (err instanceof VatPeriodAlreadyFiledError || err instanceof JournalTaxTagUnsupportedError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  return taxRateRefusal(c, err);
}
