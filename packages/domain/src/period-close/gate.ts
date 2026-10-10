import type { PeriodCloseCheckCode } from "./types.js";

export const PERIOD_CLOSE_OVERRIDE_PERMISSION = "accounting.period.override_close";

export enum PeriodCloseDecision {
  Allowed = "allowed",
  Overridden = "overridden",
  Blocked = "blocked",
  OverrideNotPermitted = "override_not_permitted",
}

export interface PeriodCloseDecisionInput {
  readonly blocking: readonly PeriodCloseCheckCode[];
  readonly overrideReason: string | null;
  readonly canOverride: boolean;
}

export function decidePeriodClose(input: PeriodCloseDecisionInput): PeriodCloseDecision {
  if (input.blocking.length === 0) return PeriodCloseDecision.Allowed;
  if (input.overrideReason === null) return PeriodCloseDecision.Blocked;
  return input.canOverride ? PeriodCloseDecision.Overridden : PeriodCloseDecision.OverrideNotPermitted;
}

export class PeriodCloseBlockedError extends Error {
  readonly code = "PERIOD_CLOSE_BLOCKED";
  readonly messageEn: string;
  constructor(
    readonly periodId: string,
    readonly blocking: readonly PeriodCloseCheckCode[],
  ) {
    super(`لا يمكن إقفال الفترة المحاسبية "${periodId}": ${blocking.length} من فحوص الإقفال لم تكتمل. عالجها من مساحة الإقفال أو اطلب تجاوزاً مسبَّباً.`);
    this.name = "PeriodCloseBlockedError";
    this.messageEn = `Fiscal period "${periodId}" cannot be closed: ${blocking.length} pre-close check(s) are not clear. Resolve them in the close workspace, or ask for an override with a reason.`;
  }
}

export class PeriodCloseOverrideNotPermittedError extends Error {
  readonly code = "PERIOD_CLOSE_OVERRIDE_NOT_PERMITTED";
  readonly messageEn: string;
  constructor(
    readonly periodId: string,
    readonly blocking: readonly PeriodCloseCheckCode[],
  ) {
    super(`تجاوز فحوص إقفال الفترة المحاسبية "${periodId}" يتطلب صلاحية «تجاوز فحوص الإقفال» غير المتاحة لحسابك.`);
    this.name = "PeriodCloseOverrideNotPermittedError";
    this.messageEn = `Overriding the pre-close checks of fiscal period "${periodId}" needs the “override close checks” permission, which your account does not have.`;
  }
}
