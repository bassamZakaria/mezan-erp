import type { BilingualReason } from "./collections/errors.js";

export type ReasonInput = string | BilingualReason;

export function splitReasons(
  reasons: readonly ReasonInput[],
  fallbackEn: string,
  separatorEn = "; ",
): { readonly ar: readonly string[]; readonly en: string } {
  const ar = reasons.map((reason) => (typeof reason === "string" ? reason : reason.ar));
  const en = reasons.map((reason) => (typeof reason === "string" ? reason : reason.en).replace(/\.$/, ""));
  return { ar, en: en.length > 0 ? en.join(separatorEn) : fallbackEn };
}
