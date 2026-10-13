import { z } from "zod";

export const CLIENT_SUPPLIED_ID_DESCRIPTION = "client-supplied-id";
export const CLIENT_SUPPLIED_ID_MAX_LENGTH = 128;
export const CLIENT_SUPPLIED_ID_REFUSAL_CODE = "JOURNAL_ENTRY_ID_RESERVED";
export const CLIENT_SUPPLIED_ID_REFUSAL_MESSAGE =
  "المعرّف المرسل غير مقبول: المعرّفات التي تحتوي «:» أو تنتهي بلاحقة قيد آلي محجوزة لقيود النظام، ولا يُقبل إلا الحروف والأرقام و« . _ - » بطول لا يتجاوز ١٢٨ حرفاً. اختر معرّفاً آخر أو اتركه للنظام.";
export const CLIENT_SUPPLIED_ID_REFUSAL_MESSAGE_EN =
  'The id sent is not accepted: an id containing ":" or ending in a system entry suffix is reserved for system entries, and only letters, digits and ". _ -" up to 128 characters are allowed. Choose another id or let the system assign one.';

const ALLOWED = /^[\p{L}\p{M}\p{N}._-]+$/u;
const SYSTEM_SUFFIXES = ["-DED", "-DED-VOID"] as const;

export function isAcceptableClientSuppliedId(id: string): boolean {
  return id.length > 0 && id.length <= CLIENT_SUPPLIED_ID_MAX_LENGTH && ALLOWED.test(id) && !SYSTEM_SUFFIXES.some((suffix) => id.endsWith(suffix));
}

// INVARIANT: every field of a request schema that names a NEW record (a document, an allocation, an adjustment, a reversal…) is this schema, because the system mints its own journal-entry ids from those names with ":" and the suffixes above; client-supplied-id.structure.test.ts fails when a create schema carries such a field without it.
export const clientSuppliedId = z.string().refine(isAcceptableClientSuppliedId, { message: CLIENT_SUPPLIED_ID_REFUSAL_MESSAGE }).describe(CLIENT_SUPPLIED_ID_DESCRIPTION);
