/** Errors raised by the installments module (docs/catalog/05 §"خطط الأقساط"). */

export class InvalidInstallmentScheduleError extends Error {
  readonly code = "INVALID_INSTALLMENT_SCHEDULE";
  constructor(message: string) {
    super(message);
    this.name = "InvalidInstallmentScheduleError";
  }
}

export class FollowUpNotFoundError extends Error {
  readonly code = "FOLLOW_UP_NOT_FOUND";
  constructor(readonly id: string) {
    super(`Collection follow-up "${id}" was not found.`);
    this.name = "FollowUpNotFoundError";
  }
}

export class InvalidFollowUpTransitionError extends Error {
  readonly code = "INVALID_FOLLOW_UP_TRANSITION";
  constructor(
    readonly id: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Follow-up "${id}" cannot transition ${from} → ${to}.`);
    this.name = "InvalidFollowUpTransitionError";
  }
}
