import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";

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
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "it failed validation");
    super(`تم رفض المرفق: ${split.ar.join("، ")}`);
    this.messageEn = `Attachment rejected: ${split.en}`;
    this.name = "InvalidAttachmentError";
    this.reasons = split.ar;
  }
}
