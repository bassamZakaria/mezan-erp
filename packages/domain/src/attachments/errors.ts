export class AttachmentNotFoundError extends Error {
  readonly code = "ATTACHMENT_NOT_FOUND";
  readonly messageEn: string;
  constructor(id: string) {
    super(`المرفق '${id}' غير موجود.`);
    this.messageEn = `Attachment '${id}' was not found.`;
    this.name = "AttachmentNotFoundError";
  }
}

export class InvalidAttachmentError extends Error {
  readonly code = "INVALID_ATTACHMENT";
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly string[]) {
    super(`تم رفض المرفق: ${reasons.join("، ")}`);
    this.messageEn = `Attachment rejected: ${reasons.join("; ")}`;
    this.name = "InvalidAttachmentError";
    this.reasons = reasons;
  }
}
