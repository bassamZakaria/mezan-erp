export class AttachmentNotFoundError extends Error {
  readonly code = "ATTACHMENT_NOT_FOUND";
  constructor(id: string) {
    super(`Attachment '${id}' was not found.`);
    this.name = "AttachmentNotFoundError";
  }
}

export class DuplicateAttachmentIdError extends Error {
  readonly code = "DUPLICATE_ATTACHMENT_ID";
  constructor(id: string) {
    super(`Attachment '${id}' already exists.`);
    this.name = "DuplicateAttachmentIdError";
  }
}

export class InvalidAttachmentError extends Error {
  readonly code = "INVALID_ATTACHMENT";
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super(`Attachment rejected: ${reasons.join("; ")}`);
    this.name = "InvalidAttachmentError";
    this.reasons = reasons;
  }
}
