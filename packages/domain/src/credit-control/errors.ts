/** Credit-control errors. Stable `code` so the api/UI can branch on it. */

export class CreditLimitExceededError extends Error {
  readonly code = "CREDIT_LIMIT_EXCEEDED";
  constructor(
    readonly customerId: string,
    message: string,
  ) {
    super(message);
    this.name = "CreditLimitExceededError";
  }
}
