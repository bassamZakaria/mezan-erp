export enum RecordErrorCode {
  DuplicateId = "DUPLICATE_ID",
}

export class DuplicateRecordIdError extends Error {
  readonly code = RecordErrorCode.DuplicateId;
  readonly messageEn: string;
  constructor(readonly recordId: string) {
    super(`المعرّف "${recordId}" مستخدم لسجل موجود بالفعل؛ الإنشاء لا يستبدل سجلاً قائماً.`);
    this.messageEn = `The id "${recordId}" already belongs to an existing record; a create never replaces one.`;
    this.name = "DuplicateRecordIdError";
  }
}

export function assertRecordIdIsNew(existing: unknown, recordId: string): void {
  if (existing !== null && existing !== undefined) throw new DuplicateRecordIdError(recordId);
}
