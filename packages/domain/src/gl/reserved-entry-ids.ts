const SYSTEM_ENTRY_ID_SEPARATOR = ":";

enum SystemEntryIdSuffix {
  CertificateDeduction = "-DED",
  CertificateDeductionVoid = "-DED-VOID",
}

export class ReservedJournalEntryIdError extends Error {
  readonly code = "JOURNAL_ENTRY_ID_RESERVED";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`المعرّف «${id}» محجوز لقيود النظام: المعرّفات التي تحتوي «:» أو تنتهي بلاحقة قيد آلي لا تُقبل من المستخدم. اختر معرّفاً آخر أو اتركه للنظام.`);
    this.name = "ReservedJournalEntryIdError";
    this.messageEn = `The id "${id}" is reserved for system entries: an id containing ":" or ending in a system entry suffix is not accepted from a caller. Choose another id or let the system assign one.`;
  }
}

// INVARIANT: every id the system mints for an entry of its own carries ":" between its owner and its role (FXR:…, PI-JE:…, …:void, …:REV) or one of the suffixes above; a new minted form must keep to that or be added here, or a caller can post under it.
export function isReservedJournalEntryId(id: string): boolean {
  return id.includes(SYSTEM_ENTRY_ID_SEPARATOR) || Object.values(SystemEntryIdSuffix).some((suffix) => id.endsWith(suffix));
}
