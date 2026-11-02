/** Credit-control errors. Stable `code` so the api/UI can branch on it. */

export class CreditLimitExceededError extends Error {
  readonly code = "CREDIT_LIMIT_EXCEEDED";
  readonly messageEn: string;
  constructor(
    readonly customerId: string,
    message: string,
    messageEn = "The customer's credit limit is exceeded.",
  ) {
    super(message);
    this.messageEn = messageEn;
    this.name = "CreditLimitExceededError";
  }
}
