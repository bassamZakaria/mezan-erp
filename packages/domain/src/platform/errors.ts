import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";
const TENANT_STATUS_LABELS: Readonly<Record<string, { readonly ar: string; readonly en: string }>> = {
  provisioning: { ar: "قيد التجهيز", en: "provisioning" },
  active: { ar: "نشطة", en: "active" },
  suspended: { ar: "موقوفة", en: "suspended" },
  archived: { ar: "مؤرشفة", en: "archived" },
};

const SUBSCRIPTION_STATUS_LABELS: Readonly<Record<string, { readonly ar: string; readonly en: string }>> = {
  trialing: { ar: "تجريبي", en: "trial" },
  active: { ar: "نشط", en: "active" },
  past_due: { ar: "متأخر السداد", en: "past due" },
  suspended: { ar: "موقوف", en: "suspended" },
  cancelled: { ar: "ملغى", en: "cancelled" },
};

export function subscriptionStatusLabel(status: string): { readonly ar: string; readonly en: string } {
  return SUBSCRIPTION_STATUS_LABELS[status] ?? { ar: status, en: status };
}

export class InvalidTenantError extends Error {
  readonly code = "INVALID_TENANT";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "the company failed validation");
    super(`بيانات المنشأة غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid company: ${split.en}`;
    this.name = "InvalidTenantError";
  }
}

export class TenantNotFoundError extends Error {
  readonly code = "TENANT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`المنشأة "${id}" غير موجودة`);
    this.messageEn = `Company "${id}" was not found`;
    this.name = "TenantNotFoundError";
  }
}

export class TenantCodeTakenError extends Error {
  readonly code = "TENANT_CODE_TAKEN";
  readonly messageEn: string;
  constructor(readonly tenantCode: string) {
    super(`رمز المنشأة "${tenantCode}" مستخدم بالفعل`);
    this.messageEn = `Company code "${tenantCode}" is already in use`;
    this.name = "TenantCodeTakenError";
  }
}

export class OwnerEmailInAnotherCompanyError extends Error {
  readonly code = "OWNER_EMAIL_IN_ANOTHER_COMPANY";
  readonly messageEn = "This email already signs in to a company on Mezan. Sign in with it, or use another email for the new company.";
  constructor() {
    super("هذا البريد الإلكتروني يدخل بالفعل إلى منشأة على ميزان. سجّل الدخول به، أو استخدم بريدًا آخر للمنشأة الجديدة.");
    this.name = "OwnerEmailInAnotherCompanyError";
  }
}

export class InvalidTenantTransitionError extends Error {
  readonly code = "INVALID_TENANT_TRANSITION";
  readonly messageEn: string;
  constructor(readonly from: string, readonly to: string) {
    super(`لا يمكن نقل المنشأة من الحالة "${TENANT_STATUS_LABELS[from]?.ar ?? from}" إلى "${TENANT_STATUS_LABELS[to]?.ar ?? to}"`);
    this.messageEn = `A company cannot move from status "${TENANT_STATUS_LABELS[from]?.en ?? from}" to "${TENANT_STATUS_LABELS[to]?.en ?? to}"`;
    this.name = "InvalidTenantTransitionError";
  }
}

export class InvalidPlanError extends Error {
  readonly code = "INVALID_PLAN";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "the plan failed validation");
    super(`بيانات الباقة غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid plan: ${split.en}`;
    this.name = "InvalidPlanError";
  }
}

export class PlanNotFoundError extends Error {
  readonly code = "PLAN_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`الباقة "${id}" غير موجودة`);
    this.messageEn = `Plan "${id}" was not found`;
    this.name = "PlanNotFoundError";
  }
}

export class PlanCodeTakenError extends Error {
  readonly code = "PLAN_CODE_TAKEN";
  readonly messageEn: string;
  constructor(readonly planCode: string) {
    super(`رمز الباقة "${planCode}" مستخدم بالفعل`);
    this.messageEn = `Plan code "${planCode}" is already in use`;
    this.name = "PlanCodeTakenError";
  }
}

export class PlanRetiredError extends Error {
  readonly code = "PLAN_RETIRED";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`الباقة "${id}" متوقفة ولا تقبل اشتراكات جديدة`);
    this.messageEn = `Plan "${id}" is retired and does not accept new subscriptions`;
    this.name = "PlanRetiredError";
  }
}

export class InvalidSubscriptionError extends Error {
  readonly code = "INVALID_SUBSCRIPTION";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "the subscription failed validation");
    super(`بيانات الاشتراك غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid subscription: ${split.en}`;
    this.name = "InvalidSubscriptionError";
  }
}

export class SubscriptionNotFoundError extends Error {
  readonly code = "SUBSCRIPTION_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`الاشتراك "${id}" غير موجود`);
    this.messageEn = `Subscription "${id}" was not found`;
    this.name = "SubscriptionNotFoundError";
  }
}

export class TenantAlreadySubscribedError extends Error {
  readonly code = "TENANT_ALREADY_SUBSCRIBED";
  readonly messageEn: string;
  constructor(readonly tenantId: string) {
    super(`المنشأة "${tenantId}" لديها اشتراك ساري بالفعل`);
    this.messageEn = `Company "${tenantId}" already has an active subscription`;
    this.name = "TenantAlreadySubscribedError";
  }
}

export class InvalidSubscriptionTransitionError extends Error {
  readonly code = "INVALID_SUBSCRIPTION_TRANSITION";
  readonly messageEn: string;
  constructor(readonly from: string, readonly to: string) {
    super(`لا يمكن نقل الاشتراك من الحالة "${SUBSCRIPTION_STATUS_LABELS[from]?.ar ?? from}" إلى "${SUBSCRIPTION_STATUS_LABELS[to]?.ar ?? to}"`);
    this.messageEn = `A subscription cannot move from status "${SUBSCRIPTION_STATUS_LABELS[from]?.en ?? from}" to "${SUBSCRIPTION_STATUS_LABELS[to]?.en ?? to}"`;
    this.name = "InvalidSubscriptionTransitionError";
  }
}

export class InvalidPaymentError extends Error {
  readonly code = "INVALID_PAYMENT";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "the payment failed validation");
    super(`بيانات الدفعة غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid payment: ${split.en}`;
    this.name = "InvalidPaymentError";
  }
}

export class PaymentIdempotencyConflictError extends Error {
  readonly code = "PAYMENT_IDEMPOTENCY_CONFLICT";
  readonly messageEn: string;
  constructor(readonly idempotencyKey: string) {
    super("سبق تسجيل هذه العملية نفسها بمبلغ أو مرجع أو اشتراك مختلف؛ أعد فتح نموذج تسجيل الدفعة وأدخلها من جديد");
    this.messageEn = "This same submission was already recorded with a different amount, reference or subscription; reopen the payment form and enter it again";
    this.name = "PaymentIdempotencyConflictError";
  }
}

export interface RecordedPaymentSummary {
  readonly id: string;
  readonly amount: string;
  readonly paidAt: string;
  readonly recordedAt: string;
}

export class PaymentReferenceAlreadyRecordedError extends Error {
  readonly code = "PAYMENT_REFERENCE_ALREADY_RECORDED";
  readonly messageEn: string;
  constructor(readonly reference: string, readonly recorded: RecordedPaymentSummary) {
    const day = recorded.recordedAt.slice(0, 10);
    const amount = recorded.amount.replace(/(\.\d{2}\d*?)0+$/, "$1");
    super(`المرجع "${reference}" مسجَّل من قبل لهذه المنشأة بتاريخ ${day} بمبلغ ${amount} ج.م. إن كانت هذه دفعة أخرى فعلًا فأكِّد تسجيلها`);
    this.messageEn = `Reference "${reference}" was already recorded for this tenant on ${day} for EGP ${amount}. If this really is another payment, confirm to record it`;
    this.name = "PaymentReferenceAlreadyRecordedError";
  }
}

export class InvalidPlatformUserError extends Error {
  readonly code = "INVALID_PLATFORM_USER";
  readonly messageEn: string;
  readonly reasons: readonly string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "the platform user failed validation");
    super(`بيانات مستخدم المنصة غير صالحة: ${split.ar.join("، ")}`);
    this.reasons = split.ar;
    this.messageEn = `Invalid platform user: ${split.en}`;
    this.name = "InvalidPlatformUserError";
  }
}

export class PlatformUserEmailTakenError extends Error {
  readonly code = "PLATFORM_USER_EMAIL_TAKEN";
  readonly messageEn: string;
  constructor(readonly email: string) {
    super(`البريد "${email}" مستخدم بالفعل`);
    this.messageEn = `Email "${email}" is already in use`;
    this.name = "PlatformUserEmailTakenError";
  }
}

export class PlatformUserNotFoundError extends Error {
  readonly code = "PLATFORM_USER_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly id: string) {
    super(`مستخدم المنصة "${id}" غير موجود`);
    this.messageEn = `Platform user "${id}" was not found`;
    this.name = "PlatformUserNotFoundError";
  }
}

export enum FreePlanRemoval {
  Retired = "retired",
  MadePaid = "made-paid",
}

const FREE_PLAN_REMOVAL_AR: Readonly<Record<FreePlanRemoval, string>> = {
  [FreePlanRemoval.Retired]: "لا يمكن إيقاف الباقة المجانية الوحيدة",
  [FreePlanRemoval.MadePaid]: "لا يمكن تحويل الباقة المجانية الوحيدة إلى باقة مدفوعة",
};

const FREE_PLAN_REMOVAL_EN: Readonly<Record<FreePlanRemoval, string>> = {
  [FreePlanRemoval.Retired]: "cannot be retired",
  [FreePlanRemoval.MadePaid]: "cannot be turned into a paid plan",
};

export class FreePlanRequiredError extends Error {
  readonly code = "FREE_PLAN_REQUIRED";
  readonly messageEn: string;
  constructor(readonly id: string, readonly removal: FreePlanRemoval = FreePlanRemoval.Retired) {
    super(`${FREE_PLAN_REMOVAL_AR[removal]} "${id}": كل تجربة تنتهي إليها`);
    this.messageEn = `The only free plan "${id}" ${FREE_PLAN_REMOVAL_EN[removal]}: every trial ends on it`;
    this.name = "FreePlanRequiredError";
  }
}

export class ModuleTrialUnavailableError extends Error {
  readonly code = "MODULE_TRIAL_UNAVAILABLE";
  readonly messageEn: string;
  constructor(readonly module: string, reasonAr: string, reasonEn: string) {
    super(reasonAr);
    this.messageEn = reasonEn;
    this.name = "ModuleTrialUnavailableError";
  }
}

export class ModuleTrialAlreadyUsedError extends Error {
  readonly code = "MODULE_TRIAL_ALREADY_USED";
  readonly messageEn: string;
  constructor(readonly module: string, moduleNameAr: string, moduleNameEn: string, readonly endedAt: string) {
    super(`سبق تجربة وحدة ${moduleNameAr} لهذه المنشأة، والتجربة متاحة مرة واحدة لكل وحدة. للاستمرار اشترك في باقة تشملها.`);
    this.messageEn = `The ${moduleNameEn} module has already been tried by this company; each module can be tried once. Subscribe to a plan that includes it to keep using it.`;
    this.name = "ModuleTrialAlreadyUsedError";
  }
}
