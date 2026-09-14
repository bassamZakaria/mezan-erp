import { FOLLOW_UP_STATUS_LABELS_AR, type FollowUpStatus } from "./follow-up.js";
import type { Money } from "../money/index.js";

/** Errors raised by the installments module (docs/archive/catalog/05 §"خطط الأقساط"). */

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
    super(`لا يمكن نقل المتابعة ${id} من "${FOLLOW_UP_STATUS_LABELS_AR[from as FollowUpStatus] ?? from}" إلى "${FOLLOW_UP_STATUS_LABELS_AR[to as FollowUpStatus] ?? to}".`);
    this.name = "InvalidFollowUpTransitionError";
  }
}

export class InstallmentPlanNotCollectableError extends Error {
  readonly code = "INSTALLMENT_PLAN_NOT_COLLECTABLE";
  constructor(
    readonly planId: string,
    readonly status: string,
  ) {
    super("لا يمكن التحصيل على خطة أقساط غير مؤكدة.");
    this.name = "InstallmentPlanNotCollectableError";
  }
}

export class InstallmentLineNotCollectableError extends Error {
  readonly code = "INSTALLMENT_LINE_NOT_COLLECTABLE";
  constructor(
    readonly planId: string,
    message: string,
  ) {
    super(message);
    this.name = "InstallmentLineNotCollectableError";
  }
}

export class InstallmentOverpaymentError extends Error {
  readonly code = "INSTALLMENT_OVERPAYMENT";
  constructor(
    readonly planId: string,
    readonly amount: Money,
    readonly collectable: Money,
  ) {
    super(`قيمة التحصيل ${amount.toString()} تتجاوز المتبقي على الخطة ${collectable.toString()}.`);
    this.name = "InstallmentOverpaymentError";
  }
}
