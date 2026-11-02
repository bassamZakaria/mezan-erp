import type { EtaReceiptPaymentMethod } from "../eta/receipt.js";
import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";

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
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The payment method data is invalid.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
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

function validate(method: PosPaymentMethod): ReasonInput[] {
  const reasons: ReasonInput[] = [];
  if (!CODE_PATTERN.test(method.code)) reasons.push({ ar: "كود طريقة الدفع حروف لاتينية كبيرة وأرقام فقط (حتى 20 حرفاً)", en: "The payment method code must be capital Latin letters and digits only (up to 20 characters)" });
  if (method.nameAr.trim() === "") reasons.push({ ar: "اسم طريقة الدفع مطلوب", en: "The payment method name is required" });
  if (!POS_PAYMENT_METHOD_KINDS.includes(method.kind)) reasons.push({ ar: "نوع طريقة الدفع غير معروف", en: "The payment method type is not recognised" });
  if (method.kind === "cash") {
    if (method.accountType !== null || method.defaultTreasuryAccountId !== null) {
      reasons.push({ ar: "الدفع النقدي يدخل درج الجهاز نفسه دائماً ولا يُربط بحساب آخر", en: "Cash payment always goes into the terminal's own drawer and is not linked to another account" });
    }
  } else if (method.kind === "on_account") {
    if (method.accountType !== null || method.defaultTreasuryAccountId !== null) {
      reasons.push({ ar: "البيع الآجل يُقيَّد على حساب العميل ولا يُربط بحساب خزينة", en: "A sale on account is booked to the customer's account and is not linked to a treasury account" });
    }
  } else if (method.accountType === null || !POS_PAYMENT_ACCOUNT_TYPES.includes(method.accountType)) {
    reasons.push({ ar: "حدد نوع الحساب الذي تستقبل عليه هذه الطريقة (نقدي أو بنكي)", en: "Choose the type of account this method receives into (cash or bank)" });
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
    throw new InvalidPosPaymentMethodError([{ ar: "طريقة الدفع النقدي موجودة بالفعل — النقدية تدخل درج الجهاز دائماً", en: "A cash payment method already exists — cash always goes into the terminal's drawer" }]);
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
  if (current.id === POS_CASH_METHOD_ID && !next.active) reasons.push({ ar: "لا يمكن تعطيل الدفع النقدي — كل جهاز يستلم النقدية في درجه", en: "Cash payment cannot be disabled — every terminal receives cash in its drawer" });
  if (reasons.length > 0) throw new InvalidPosPaymentMethodError(reasons);
  return next;
}

export function assertPosPaymentMethodDeletable(method: PosPaymentMethod, usedByTerminalCodes: readonly string[]): void {
  if (method.builtIn) throw new InvalidPosPaymentMethodError([{ ar: "طريقة أساسية في النظام — لا يمكن حذفها", en: "This is a built-in method of the system — it cannot be deleted" }]);
  if (usedByTerminalCodes.length > 0) {
    throw new InvalidPosPaymentMethodError([
      { ar: `الطريقة مفعّلة على الأجهزة ${usedByTerminalCodes.join("، ")} — عطّلها بدلاً من حذفها`, en: `The method is enabled on terminals ${usedByTerminalCodes.join(", ")} — disable it instead of deleting it` },
    ]);
  }
}
