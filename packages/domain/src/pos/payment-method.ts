import type { EtaReceiptPaymentMethod } from "../eta/receipt.js";

export const POS_PAYMENT_METHOD_KINDS = ["cash", "card", "wallet", "transfer", "on_account"] as const;
export type PosPaymentMethodKind = (typeof POS_PAYMENT_METHOD_KINDS)[number];

export const POS_PAYMENT_ACCOUNT_TYPES = ["cash", "bank"] as const;
export type PosPaymentAccountType = (typeof POS_PAYMENT_ACCOUNT_TYPES)[number];

export const POS_CASH_METHOD_ID = "PM-CASH";
export const POS_CARD_METHOD_ID = "PM-CARD";

/**
 * طريقة دفع — defined once for every till («شبكة، فوري، فودافون كاش…») so the
 * same name reaches every device and report. `code` is what a sale records and
 * never changes after creation.
 */
export interface PosPaymentMethod {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly kind: PosPaymentMethodKind;
  /** Null only for `cash` (always the terminal's own drawer) and `on_account` (no money moves). */
  readonly accountType: PosPaymentAccountType | null;
  readonly defaultTreasuryAccountId: string | null;
  readonly builtIn: boolean;
  readonly active: boolean;
}

export const BUILT_IN_POS_PAYMENT_METHODS: readonly PosPaymentMethod[] = [
  {
    id: POS_CASH_METHOD_ID,
    code: "CASH",
    nameAr: "نقدي",
    nameEn: "Cash",
    kind: "cash",
    accountType: null,
    defaultTreasuryAccountId: null,
    builtIn: true,
    active: true,
  },
  {
    id: POS_CARD_METHOD_ID,
    code: "CARD",
    nameAr: "بطاقة",
    nameEn: "Card",
    kind: "card",
    accountType: "bank",
    defaultTreasuryAccountId: null,
    builtIn: true,
    active: true,
  },
];

const ETA_METHOD_BY_KIND: Record<PosPaymentMethodKind, EtaReceiptPaymentMethod> = {
  cash: "cash",
  card: "card",
  wallet: "wallet",
  transfer: "transfer",
  on_account: "other",
};

/** The authority's `paymentMethod` for a tender of this kind (e-receipt). */
export function etaPaymentMethodForKind(kind: PosPaymentMethodKind): EtaReceiptPaymentMethod {
  return ETA_METHOD_BY_KIND[kind];
}

export class InvalidPosPaymentMethodError extends Error {
  readonly code = "INVALID_POS_PAYMENT_METHOD";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidPosPaymentMethodError";
  }
}

export interface CreatePosPaymentMethodInput {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly kind: PosPaymentMethodKind;
  readonly accountType?: PosPaymentAccountType | null;
  readonly defaultTreasuryAccountId?: string | null;
  readonly active?: boolean;
}

const CODE_PATTERN = /^[A-Z0-9_-]{1,20}$/;

function validate(method: PosPaymentMethod): string[] {
  const reasons: string[] = [];
  if (!CODE_PATTERN.test(method.code)) reasons.push("كود طريقة الدفع حروف لاتينية كبيرة وأرقام فقط (حتى 20 حرفاً)");
  if (method.nameAr.trim() === "") reasons.push("اسم طريقة الدفع مطلوب");
  if (!POS_PAYMENT_METHOD_KINDS.includes(method.kind)) reasons.push("نوع طريقة الدفع غير معروف");
  if (method.kind === "cash") {
    if (method.accountType !== null || method.defaultTreasuryAccountId !== null) {
      reasons.push("الدفع النقدي يدخل درج الجهاز نفسه دائماً ولا يُربط بحساب آخر");
    }
  } else if (method.kind === "on_account") {
    if (method.accountType !== null || method.defaultTreasuryAccountId !== null) {
      reasons.push("البيع الآجل يُقيَّد على حساب العميل ولا يُربط بحساب خزينة");
    }
  } else if (method.accountType === null || !POS_PAYMENT_ACCOUNT_TYPES.includes(method.accountType)) {
    reasons.push("حدد نوع الحساب الذي تستقبل عليه هذه الطريقة (نقدي أو بنكي)");
  }
  return reasons;
}

export function createPosPaymentMethod(input: CreatePosPaymentMethodInput): PosPaymentMethod {
  const holdsAccount = input.kind !== "cash" && input.kind !== "on_account";
  const method: PosPaymentMethod = {
    id: input.id,
    code: input.code.trim().toUpperCase(),
    nameAr: input.nameAr.trim(),
    nameEn: input.nameEn?.trim() ? input.nameEn.trim() : null,
    kind: input.kind,
    accountType: holdsAccount ? (input.accountType ?? "bank") : null,
    defaultTreasuryAccountId: holdsAccount ? (input.defaultTreasuryAccountId ?? null) : null,
    builtIn: false,
    active: input.active ?? true,
  };
  if (method.kind === "cash") {
    throw new InvalidPosPaymentMethodError(["طريقة الدفع النقدي موجودة بالفعل — النقدية تدخل درج الجهاز دائماً"]);
  }
  const reasons = validate(method);
  if (reasons.length > 0) throw new InvalidPosPaymentMethodError(reasons);
  return method;
}

export interface UpdatePosPaymentMethodPatch {
  readonly nameAr?: string;
  readonly nameEn?: string | null;
  readonly accountType?: PosPaymentAccountType | null;
  readonly defaultTreasuryAccountId?: string | null;
  readonly active?: boolean;
}

/** The code and the kind are fixed at creation: every recorded sale carries them. */
export function updatePosPaymentMethod(current: PosPaymentMethod, patch: UpdatePosPaymentMethodPatch): PosPaymentMethod {
  const holdsAccount = current.kind !== "cash" && current.kind !== "on_account";
  const next: PosPaymentMethod = {
    ...current,
    nameAr: patch.nameAr !== undefined ? patch.nameAr.trim() : current.nameAr,
    nameEn: patch.nameEn !== undefined ? (patch.nameEn?.trim() ? patch.nameEn.trim() : null) : current.nameEn,
    accountType: holdsAccount ? (patch.accountType !== undefined ? patch.accountType : current.accountType) : null,
    defaultTreasuryAccountId: holdsAccount
      ? patch.defaultTreasuryAccountId !== undefined
        ? patch.defaultTreasuryAccountId
        : current.defaultTreasuryAccountId
      : null,
    active: patch.active ?? current.active,
  };
  const reasons = validate(next);
  if (current.id === POS_CASH_METHOD_ID && !next.active) reasons.push("لا يمكن تعطيل الدفع النقدي — كل جهاز يستلم النقدية في درجه");
  if (reasons.length > 0) throw new InvalidPosPaymentMethodError(reasons);
  return next;
}

export function assertPosPaymentMethodDeletable(method: PosPaymentMethod, usedByTerminalCodes: readonly string[]): void {
  if (method.builtIn) throw new InvalidPosPaymentMethodError(["طريقة أساسية في النظام — لا يمكن حذفها"]);
  if (usedByTerminalCodes.length > 0) {
    throw new InvalidPosPaymentMethodError([
      `الطريقة مفعّلة على الأجهزة ${usedByTerminalCodes.join("، ")} — عطّلها بدلاً من حذفها`,
    ]);
  }
}
