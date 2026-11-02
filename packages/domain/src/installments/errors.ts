import { FOLLOW_UP_STATUS_LABELS_AR, FOLLOW_UP_STATUS_LABELS_EN, type FollowUpStatus } from "./follow-up.js";
import type { Money } from "../money/index.js";

/** Errors raised by the installments module (docs/archive/catalog/05 §"خطط الأقساط"). */

export class InvalidInstallmentScheduleError extends Error {
  readonly code = "INVALID_INSTALLMENT_SCHEDULE";
  readonly messageEn: string;
  constructor(message: string, messageEn = "The installment schedule is invalid.") {
    super(message);
    this.messageEn = messageEn;
    this.name = "InvalidInstallmentScheduleError";
  }
}

export class FollowUpNotFoundError extends Error {
  readonly code = "FOLLOW_UP_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`متابعة التحصيل "${id}" غير موجودة.`);
    this.messageEn = `Collection follow-up "${id}" was not found.`;
    this.name = "FollowUpNotFoundError";
  }
}

export class InvalidFollowUpTransitionError extends Error {
  readonly code = "INVALID_FOLLOW_UP_TRANSITION";
  readonly messageEn: string;
  constructor(
    readonly id: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`لا يمكن نقل المتابعة ${id} من "${FOLLOW_UP_STATUS_LABELS_AR[from as FollowUpStatus] ?? from}" إلى "${FOLLOW_UP_STATUS_LABELS_AR[to as FollowUpStatus] ?? to}".`);
    this.messageEn = `Follow-up ${id} cannot move from "${FOLLOW_UP_STATUS_LABELS_EN[from as FollowUpStatus] ?? from}" to "${FOLLOW_UP_STATUS_LABELS_EN[to as FollowUpStatus] ?? to}".`;
    this.name = "InvalidFollowUpTransitionError";
  }
}

export class InstallmentPlanNotCollectableError extends Error {
  readonly code = "INSTALLMENT_PLAN_NOT_COLLECTABLE";
  readonly messageEn = "Collection cannot be made on an installment plan that is not confirmed.";
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
  readonly messageEn: string;
  constructor(
    readonly planId: string,
    message: string,
    messageEn = "This installment cannot be collected.",
  ) {
    super(message);
    this.messageEn = messageEn;
    this.name = "InstallmentLineNotCollectableError";
  }
}

export class InstallmentOverpaymentError extends Error {
  readonly code = "INSTALLMENT_OVERPAYMENT";
  readonly messageEn: string;
  constructor(
    readonly planId: string,
    readonly amount: Money,
    readonly collectable: Money,
  ) {
    super(`قيمة التحصيل ${amount.toString()} تتجاوز المتبقي على الخطة ${collectable.toString()}.`);
    this.messageEn = `The collection amount ${amount.toString()} exceeds the remaining balance on the plan ${collectable.toString()}.`;
    this.name = "InstallmentOverpaymentError";
  }
}
