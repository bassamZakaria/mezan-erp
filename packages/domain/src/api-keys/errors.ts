export class InvalidApiKeyError extends Error {
  readonly code = "INVALID_API_KEY";
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
    this.name = "InvalidApiKeyError";
  }
}

export class ApiKeyNotFoundError extends Error {
  readonly code = "API_KEY_NOT_FOUND";
  constructor(readonly id: string) {
    super(`مفتاح API "${id}" غير موجود`);
    this.name = "ApiKeyNotFoundError";
  }
}

export class ApiKeyAlreadyRevokedError extends Error {
  readonly code = "API_KEY_ALREADY_REVOKED";
  constructor(readonly id: string) {
    super(`مفتاح API "${id}" ملغى بالفعل`);
    this.name = "ApiKeyAlreadyRevokedError";
  }
}
