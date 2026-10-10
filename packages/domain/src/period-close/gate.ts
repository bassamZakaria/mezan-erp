import { PeriodCloseAction, type PeriodCloseCheckCode } from "./types.js";

export const PERIOD_CLOSE_OVERRIDE_PERMISSION = "accounting.period.override_close";

export enum PeriodCloseDecision {
  Allowed = "allowed",
  Overridden = "overridden",
  Blocked = "blocked",
  OverrideNotPermitted = "override_not_permitted",
  LockOverrideNeedsSecondPerson = "lock_override_needs_second_person",
}

export enum PeriodCloseErrorCode {
  Blocked = "PERIOD_CLOSE_BLOCKED",
  OverrideNotPermitted = "PERIOD_CLOSE_OVERRIDE_NOT_PERMITTED",
  LockOverrideSameUser = "PERIOD_LOCK_OVERRIDE_SAME_USER",
  ChecksUnavailable = "PERIOD_CLOSE_CHECKS_UNAVAILABLE",
  Unauditable = "PERIOD_CLOSE_UNAUDITABLE",
  Contended = "PERIOD_CLOSE_CONTENDED",
}

export interface PeriodCloseDecisionInput {
  readonly action: PeriodCloseAction;
  readonly blocking: readonly PeriodCloseCheckCode[];
  readonly overrideReason: string | null;
  readonly canOverride: boolean;
  readonly actor: string;
  /** Who closed the period being locked; null when no close of it is on record. */
  readonly closedBy: string | null;
  readonly singleOperatorMode: boolean;
}

// A lock cannot be undone, so overriding its checks takes a second person: the one who closed the month may not also lock it over a failing check.
export function decidePeriodClose(input: PeriodCloseDecisionInput): PeriodCloseDecision {
  if (input.blocking.length === 0) return PeriodCloseDecision.Allowed;
  if (input.overrideReason === null) return PeriodCloseDecision.Blocked;
  if (!input.canOverride) return PeriodCloseDecision.OverrideNotPermitted;
  if (input.action === PeriodCloseAction.Lock && !input.singleOperatorMode && (input.closedBy === null || input.closedBy === input.actor)) {
    return PeriodCloseDecision.LockOverrideNeedsSecondPerson;
  }
  return PeriodCloseDecision.Overridden;
}

export abstract class PeriodCloseRefusal extends Error {
  abstract readonly code: PeriodCloseErrorCode;
  constructor(
    message: string,
    readonly messageEn: string,
  ) {
    super(message);
  }
}

export class PeriodCloseBlockedError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.Blocked;
  constructor(
    readonly periodId: string,
    readonly blocking: readonly PeriodCloseCheckCode[],
  ) {
    super(
      `لا يمكن إقفال الفترة المحاسبية "${periodId}": عدد فحوص الإقفال غير المكتملة ${blocking.length}. عالجها من مساحة الإقفال أو اطلب تجاوزاً مسبَّباً.`,
      `Fiscal period "${periodId}" cannot be closed: ${blocking.length} pre-close check(s) are not clear. Resolve them in the close workspace, or ask for an override with a reason.`,
    );
    this.name = "PeriodCloseBlockedError";
  }
}

export class PeriodCloseOverrideNotPermittedError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.OverrideNotPermitted;
  constructor(
    readonly periodId: string,
    readonly blocking: readonly PeriodCloseCheckCode[],
  ) {
    super(
      `تجاوز فحوص إقفال الفترة المحاسبية "${periodId}" يتطلب صلاحية «تجاوز فحوص الإقفال» غير المتاحة لحسابك.`,
      `Overriding the pre-close checks of fiscal period "${periodId}" needs the “override close checks” permission, which your account does not have.`,
    );
    this.name = "PeriodCloseOverrideNotPermittedError";
  }
}

export class PeriodLockOverrideSameUserError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.LockOverrideSameUser;
  constructor(
    readonly periodId: string,
    readonly blocking: readonly PeriodCloseCheckCode[],
  ) {
    super(
      `قفل الفترة المحاسبية "${periodId}" نهائياً فوق فحوص غير مكتملة يتطلب مستخدماً غير الذي أقفلها. اطلب من مستخدم آخر يملك الصلاحية تنفيذ القفل، أو عالج الفحوص أولاً.`,
      `Locking fiscal period "${periodId}" over failing checks needs a different user from the one who closed it. Ask another permitted user to lock it, or clear the checks first.`,
    );
    this.name = "PeriodLockOverrideSameUserError";
  }
}

export class PeriodCloseChecksUnavailableError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.ChecksUnavailable;
  constructor(readonly periodId: string) {
    super(
      `تعذّر تشغيل فحوص إقفال الفترة المحاسبية "${periodId}"، فلا يمكن إقفالها أو قفلها الآن.`,
      `The pre-close checks for fiscal period "${periodId}" are not available, so it cannot be closed or locked now.`,
    );
    this.name = "PeriodCloseChecksUnavailableError";
  }
}

export class PeriodCloseUnauditableError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.Unauditable;
  constructor(readonly periodId: string) {
    super(
      `تعذّر تسجيل إقفال الفترة المحاسبية "${periodId}" في سجل المراجعة، فلم يُنفَّذ الإقفال.`,
      `The close of fiscal period "${periodId}" could not be written to the audit trail, so it was not carried out.`,
    );
    this.name = "PeriodCloseUnauditableError";
  }
}

export class PeriodCloseContendedError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.Contended;
  constructor(readonly periodId: string) {
    super(
      `تغيّرت بيانات المنشأة أثناء فحص الفترة المحاسبية "${periodId}". أعد المحاولة بعد لحظات.`,
      `The books changed while fiscal period "${periodId}" was being checked. Try again in a moment.`,
    );
    this.name = "PeriodCloseContendedError";
  }
}
