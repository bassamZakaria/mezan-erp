import { fiscalPeriodLabel, quotedFiscalPeriod, type FiscalPeriodRef } from "../fiscal-periods/labels.js";
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
  readonly closedBy: string | null;
  readonly singleOperatorMode: boolean;
  readonly wildcardAdmin: boolean;
}

function lockedByItsCloser(input: PeriodCloseDecisionInput): boolean {
  return input.action === PeriodCloseAction.Lock && input.closedBy !== null && input.closedBy === input.actor;
}

function singleOperatorWaiver(input: PeriodCloseDecisionInput): boolean {
  return input.singleOperatorMode && input.wildcardAdmin;
}

export function decidePeriodClose(input: PeriodCloseDecisionInput): PeriodCloseDecision {
  if (input.blocking.length === 0) return PeriodCloseDecision.Allowed;
  if (input.overrideReason === null) return PeriodCloseDecision.Blocked;
  if (!input.canOverride) return PeriodCloseDecision.OverrideNotPermitted;
  if (lockedByItsCloser(input) && !singleOperatorWaiver(input)) return PeriodCloseDecision.LockOverrideNeedsSecondPerson;
  return PeriodCloseDecision.Overridden;
}

export function lockedUnderSingleOperatorWaiver(input: PeriodCloseDecisionInput): boolean {
  return decidePeriodClose(input) === PeriodCloseDecision.Overridden && lockedByItsCloser(input);
}

type RefusalWording = (period: { readonly ar: string; readonly en: string }) => { readonly ar: string; readonly en: string };

export abstract class PeriodCloseRefusal extends Error {
  abstract readonly code: PeriodCloseErrorCode;
  readonly messageEn: string;
  readonly periodId: string;
  constructor(period: FiscalPeriodRef, wording: RefusalWording) {
    const text = wording({ ar: quotedFiscalPeriod(period).ar, en: fiscalPeriodLabel(period).en });
    super(text.ar);
    this.messageEn = text.en;
    this.periodId = period.id;
  }
}

export class PeriodCloseBlockedError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.Blocked;
  constructor(
    period: FiscalPeriodRef,
    readonly blocking: readonly PeriodCloseCheckCode[],
  ) {
    super(period, (name) => ({
      ar: `لا يمكن إقفال ${name.ar}: عدد فحوص الإقفال غير المكتملة ${blocking.length}. عالجها من مساحة الإقفال أو اطلب تجاوزاً مسبَّباً.`,
      en: `Fiscal period ${name.en} cannot be closed: ${blocking.length} pre-close check(s) are not clear. Resolve them in the close workspace, or ask for an override with a reason.`,
    }));
    this.name = "PeriodCloseBlockedError";
  }
}

export class PeriodCloseOverrideNotPermittedError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.OverrideNotPermitted;
  constructor(
    period: FiscalPeriodRef,
    readonly blocking: readonly PeriodCloseCheckCode[],
  ) {
    super(period, (name) => ({
      ar: `تجاوز فحوص إقفال ${name.ar} يتطلب صلاحية «تجاوز فحوص الإقفال» غير المتاحة لحسابك.`,
      en: `Overriding the pre-close checks of fiscal period ${name.en} needs the “override close checks” permission, which your account does not have.`,
    }));
    this.name = "PeriodCloseOverrideNotPermittedError";
  }
}

export class PeriodLockOverrideSameUserError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.LockOverrideSameUser;
  constructor(
    period: FiscalPeriodRef,
    readonly blocking: readonly PeriodCloseCheckCode[],
  ) {
    super(period, (name) => ({
      ar: `قفل ${name.ar} نهائياً فوق فحوص غير مكتملة يتطلب مستخدماً غير الذي أقفلها. اطلب من مستخدم آخر يملك الصلاحية تنفيذ القفل، أو عالج الفحوص أولاً.`,
      en: `Locking fiscal period ${name.en} over failing checks needs a different user from the one who closed it. Ask another permitted user to lock it, or clear the checks first.`,
    }));
    this.name = "PeriodLockOverrideSameUserError";
  }
}

export class PeriodCloseChecksUnavailableError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.ChecksUnavailable;
  constructor(period: FiscalPeriodRef) {
    super(period, (name) => ({
      ar: `تعذّر تشغيل فحوص إقفال ${name.ar}، فلا يمكن إقفالها أو قفلها الآن.`,
      en: `The pre-close checks for fiscal period ${name.en} are not available, so it cannot be closed or locked now.`,
    }));
    this.name = "PeriodCloseChecksUnavailableError";
  }
}

export class PeriodCloseUnauditableError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.Unauditable;
  constructor(period: FiscalPeriodRef) {
    super(period, (name) => ({
      ar: `تعذّر تسجيل إقفال ${name.ar} في سجل المراجعة، فلم يُنفَّذ الإقفال.`,
      en: `The close of fiscal period ${name.en} could not be written to the audit trail, so it was not carried out.`,
    }));
    this.name = "PeriodCloseUnauditableError";
  }
}

export class PeriodCloseContendedError extends PeriodCloseRefusal {
  readonly code = PeriodCloseErrorCode.Contended;
  constructor(period: FiscalPeriodRef) {
    super(period, (name) => ({
      ar: `تغيّرت بيانات المنشأة أثناء فحص ${name.ar}. أعد المحاولة بعد لحظات.`,
      en: `The books changed while fiscal period ${name.en} was being checked. Try again in a moment.`,
    }));
    this.name = "PeriodCloseContendedError";
  }
}
