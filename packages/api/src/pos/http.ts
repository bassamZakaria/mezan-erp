import type { Context } from "hono";
import type { ZodError } from "zod";
import {
  InvalidPosPaymentMethodError,
  InvalidPosSettingsError,
  InvalidPosTerminalError,
  InvalidShiftTemplateError,
} from "@mezan/domain";

export function validationError(c: Context, error: ZodError): Response {
  return c.json({ error: "VALIDATION_ERROR", message: "البيانات المرسلة غير مكتملة أو غير صالحة", messageEn: "The submitted data is incomplete or invalid", details: error.flatten() }, 400);
}

export function posDomainError(c: Context, err: unknown): Response {
  if (
    err instanceof InvalidPosTerminalError ||
    err instanceof InvalidPosPaymentMethodError ||
    err instanceof InvalidPosSettingsError ||
    err instanceof InvalidShiftTemplateError
  ) {
    return c.json({ error: err.code, message: err.message, messageEn: err.messageEn, reasons: err.reasons }, 422);
  }
  throw err;
}

export async function readJson(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}
