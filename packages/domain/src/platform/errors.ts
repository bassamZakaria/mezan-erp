export class InvalidTenantError extends Error {
  readonly code = "INVALID_TENANT";
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
    this.name = "InvalidTenantError";
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
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
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
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
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

export class InvalidPlatformUserError extends Error {
  readonly code = "INVALID_PLATFORM_USER";
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
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
