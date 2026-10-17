import { PricingGuardBreachKind, type PricingGuardLineEvaluation } from "./types.js";

export enum PricingGuardErrorCode {
  Blocked = "PRICING_GUARD_BLOCKED",
  ApprovalUnconfigured = "PRICING_GUARD_APPROVAL_UNCONFIGURED",
  Changed = "PRICING_GUARD_CHANGED",
  InvalidRule = "INVALID_PRICING_GUARD_RULE",
  RuleNotFound = "PRICING_GUARD_RULE_NOT_FOUND",
}

export interface PricingGuardRefusedLine {
  readonly lineId: string;
  readonly itemId: string;
  readonly kinds: readonly PricingGuardBreachKind[];
  readonly ruleIds: readonly string[];
}

function refusedLinesOf(lines: readonly PricingGuardLineEvaluation[]): PricingGuardRefusedLine[] {
  return lines
    .filter((line) => line.breaches.length > 0)
    .map((line) => ({
      lineId: line.lineId,
      itemId: line.itemId,
      kinds: [...new Set(line.breaches.map((breach) => breach.kind))],
      ruleIds: [...new Set(line.breaches.map((breach) => breach.ruleId))],
    }));
}

export class PricingGuardBlockedError extends Error {
  readonly code = PricingGuardErrorCode.Blocked;
  readonly messageEn: string;
  readonly lines: readonly PricingGuardRefusedLine[];
  constructor(evaluated: readonly PricingGuardLineEvaluation[]) {
    const lines = refusedLinesOf(evaluated);
    super(`سعر البيع أقل من الحد الأدنى المسموح أو هامش الربح أقل من المطلوب في ${lines.length} بند، وقاعدة التسعير تمنع ذلك. عدّل السعر أو راجع مدير المبيعات.`);
    this.messageEn = `${lines.length} line(s) sell below the floor price or the minimum margin, and the pricing rule blocks it. Change the price or ask the sales manager.`;
    this.lines = lines;
    this.name = "PricingGuardBlockedError";
  }
}

export class PricingGuardApprovalUnconfiguredError extends Error {
  readonly code = PricingGuardErrorCode.ApprovalUnconfigured;
  readonly messageEn: string;
  readonly lines: readonly PricingGuardRefusedLine[];
  constructor(evaluated: readonly PricingGuardLineEvaluation[]) {
    const lines = refusedLinesOf(evaluated);
    super("البيع دون الحد الأدنى يحتاج اعتماداً، ولا توجد سلسلة موافقات لـ«اعتماد بيع دون الحد الأدنى للسعر». أضفها من إعدادات سير العمل أو عدّل السعر.");
    this.messageEn = "Selling below the floor needs approval, and no approval chain is set up for “Approve a sale below the price floor”. Add one under workflow settings or change the price.";
    this.lines = lines;
    this.name = "PricingGuardApprovalUnconfiguredError";
  }
}

export class PricingGuardChangedError extends Error {
  readonly code = PricingGuardErrorCode.Changed;
  readonly messageEn: string;
  constructor() {
    super("تغيّرت نتيجة رقابة الأسعار أثناء التأكيد (تكلفة أو قاعدة جديدة). أعد المحاولة.");
    this.messageEn = "The price check changed while confirming (a new cost or rule). Try again.";
    this.name = "PricingGuardChangedError";
  }
}

export class InvalidPricingGuardRuleError extends Error {
  readonly code = PricingGuardErrorCode.InvalidRule;
  readonly messageEn: string;
  constructor(readonly reasonsAr: readonly string[], readonly reasonsEn: readonly string[]) {
    super(`قاعدة التسعير غير صالحة: ${reasonsAr.join("، ")}`);
    this.messageEn = `Invalid pricing rule: ${reasonsEn.join("; ")}`;
    this.name = "InvalidPricingGuardRuleError";
  }
}

export class PricingGuardRuleNotFoundError extends Error {
  readonly code = PricingGuardErrorCode.RuleNotFound;
  readonly messageEn: string;
  constructor(readonly ruleId: string) {
    super(`قاعدة التسعير "${ruleId}" غير موجودة.`);
    this.messageEn = `Pricing rule "${ruleId}" was not found.`;
    this.name = "PricingGuardRuleNotFoundError";
  }
}
