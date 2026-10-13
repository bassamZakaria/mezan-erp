export class InvalidTenantError extends Error {
  readonly code = "INVALID_TENANT";
  readonly messageEn: string;
  constructor(readonly reasons: string[]) {
    super(`بيانات المنشأة غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid tenant: ${reasons.join("; ")}`;
    this.name = "InvalidTenantError";
  }
}

export class InvalidSignupError extends Error {
  readonly code = "INVALID_SIGNUP";
  readonly messageEn: string;
  constructor(readonly reasons: string[]) {
    super(`بيانات التسجيل غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid signup: ${reasons.join("; ")}`;
    this.name = "InvalidSignupError";
  }
}

export class SignupTokenInvalidError extends Error {
  readonly code = "SIGNUP_TOKEN_INVALID";
  constructor() {
    super("رابط التفعيل غير صالح");
    this.name = "SignupTokenInvalidError";
  }
}

export class SignupTokenExpiredError extends Error {
  readonly code = "SIGNUP_TOKEN_EXPIRED";
  constructor() {
    super("انتهت صلاحية رابط التفعيل، أنشئ حسابًا جديدًا");
    this.name = "SignupTokenExpiredError";
  }
}

export class SignupAlreadyActivatedError extends Error {
  readonly code = "SIGNUP_ALREADY_ACTIVATED";
  constructor() {
    super("تم تفعيل هذا الحساب مسبقًا. سجّل الدخول برمز منشأتك وبريدك.");
    this.name = "SignupAlreadyActivatedError";
  }
}

export class SignupActivationIncompleteError extends Error {
  readonly code = "SIGNUP_ACTIVATION_INCOMPLETE";
  constructor() {
    super("لم يكتمل تفعيل هذا الحساب، وانتهت صلاحية رابط التفعيل. تواصل مع الدعم لإكمال التفعيل.");
    this.name = "SignupActivationIncompleteError";
  }
}

export class TenantNotFoundError extends Error {
  readonly code = "TENANT_NOT_FOUND";
  constructor(readonly id: string) {
    super(`المنشأة "${id}" غير موجودة`);
    this.name = "TenantNotFoundError";
  }
}

export class TenantCodeTakenError extends Error {
  readonly code = "TENANT_CODE_TAKEN";
  constructor(readonly tenantCode: string) {
    super(`رمز المنشأة "${tenantCode}" مستخدم بالفعل`);
    this.name = "TenantCodeTakenError";
  }
}

export class InvalidTenantTransitionError extends Error {
  readonly code = "INVALID_TENANT_TRANSITION";
  constructor(readonly from: string, readonly to: string) {
    super(`لا يمكن نقل المنشأة من الحالة "${from}" إلى "${to}"`);
    this.name = "InvalidTenantTransitionError";
  }
}

export class InvalidPlanError extends Error {
  readonly code = "INVALID_PLAN";
  readonly messageEn: string;
  constructor(readonly reasons: string[]) {
    super(`بيانات الباقة غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid plan: ${reasons.join("; ")}`;
    this.name = "InvalidPlanError";
  }
}

export class PlanNotFoundError extends Error {
  readonly code = "PLAN_NOT_FOUND";
  constructor(readonly id: string) {
    super(`الباقة "${id}" غير موجودة`);
    this.name = "PlanNotFoundError";
  }
}

export class PlanCodeTakenError extends Error {
  readonly code = "PLAN_CODE_TAKEN";
  constructor(readonly planCode: string) {
    super(`رمز الباقة "${planCode}" مستخدم بالفعل`);
    this.name = "PlanCodeTakenError";
  }
}

export class PlanRetiredError extends Error {
  readonly code = "PLAN_RETIRED";
  constructor(readonly id: string) {
    super(`الباقة "${id}" متوقفة ولا تقبل اشتراكات جديدة`);
    this.name = "PlanRetiredError";
  }
}

export class PlanInUseError extends Error {
  readonly code = "PLAN_IN_USE";
  constructor(readonly id: string, readonly modules: string[]) {
    super(`لا يمكن إزالة وحدات من الباقة "${id}" وبها اشتراكات سارية: ${modules.join("، ")}`);
    this.name = "PlanInUseError";
  }
}

export class InvalidSubscriptionError extends Error {
  readonly code = "INVALID_SUBSCRIPTION";
  readonly messageEn: string;
  constructor(readonly reasons: string[]) {
    super(`بيانات الاشتراك غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid subscription: ${reasons.join("; ")}`;
    this.name = "InvalidSubscriptionError";
  }
}

export class SubscriptionNotFoundError extends Error {
  readonly code = "SUBSCRIPTION_NOT_FOUND";
  constructor(readonly id: string) {
    super(`الاشتراك "${id}" غير موجود`);
    this.name = "SubscriptionNotFoundError";
  }
}

export class TenantAlreadySubscribedError extends Error {
  readonly code = "TENANT_ALREADY_SUBSCRIBED";
  constructor(readonly tenantId: string) {
    super(`المنشأة "${tenantId}" لديها اشتراك ساري بالفعل`);
    this.name = "TenantAlreadySubscribedError";
  }
}

export class InvalidSubscriptionTransitionError extends Error {
  readonly code = "INVALID_SUBSCRIPTION_TRANSITION";
  constructor(readonly from: string, readonly to: string) {
    super(`لا يمكن نقل الاشتراك من الحالة "${from}" إلى "${to}"`);
    this.name = "InvalidSubscriptionTransitionError";
  }
}

export class InvalidPaymentError extends Error {
  readonly code = "INVALID_PAYMENT";
  readonly messageEn: string;
  constructor(readonly reasons: string[]) {
    super(`بيانات الدفعة غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid payment: ${reasons.join("; ")}`;
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
  constructor(readonly reasons: string[]) {
    super(`بيانات مستخدم المنصة غير صالحة: ${reasons.join("، ")}`);
    this.messageEn = `Invalid platform user: ${reasons.join("; ")}`;
    this.name = "InvalidPlatformUserError";
  }
}

export class PlatformUserEmailTakenError extends Error {
  readonly code = "PLATFORM_USER_EMAIL_TAKEN";
  constructor(readonly email: string) {
    super(`البريد "${email}" مستخدم بالفعل`);
    this.name = "PlatformUserEmailTakenError";
  }
}

export class PlatformUserNotFoundError extends Error {
  readonly code = "PLATFORM_USER_NOT_FOUND";
  constructor(readonly id: string) {
    super(`مستخدم المنصة "${id}" غير موجود`);
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
