export class InvalidWebhookError extends Error {
  readonly code = "INVALID_WEBHOOK";
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
    this.name = "InvalidWebhookError";
  }
}

export class WebhookNotFoundError extends Error {
  readonly code = "WEBHOOK_NOT_FOUND";
  constructor(readonly id: string) {
    super(`الويب هوك "${id}" غير موجود`);
    this.name = "WebhookNotFoundError";
  }
}
