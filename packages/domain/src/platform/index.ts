export { MODULE_CATALOG, isKnownModule, type ModuleId } from "./module-catalog.js";
export * from "./errors.js";
export { isValidSlug } from "./slug.js";
export { COMPANY_NAME_MAX_LENGTH, CompanyNameProblem, companyNameProblem, companyNameProblemAr } from "./company-name.js";
export {
  createTenant, activateTenant, suspendTenant, resumeTenant, archiveTenant, followTenantOwnerEmail,
  tenantDbFile,
  TenantStatusCode,
  type Tenant, type TenantStatus, type TenantRepository,
  type CreateTenantCommand, type TenantTransitionCommand, type ChangeTenantOwnerEmailCommand,
} from "./tenant.js";
export {
  createPlan, updatePlan, retirePlan, dedupeModules,
  type Plan, type PlanStatus, type PlanRepository,
  type CreatePlanCommand, type UpdatePlanCommand, type HasLiveSubscribers,
} from "./plan.js";
export {
  DEFAULT_GRACE_DAYS, SUBSCRIPTION_STATUSES,
  startSubscription, renewSubscription, applyRenewal, changePlan, markPastDue,
  suspendSubscription, resumeSubscription, cancelSubscription,
  type Subscription, type SubscriptionStatus, type BillingCycle, type SubscriptionRepository,
  type StartSubscriptionCommand, type SubscriptionCommand, type ChangePlanCommand,
} from "./subscription.js";
export {
  deriveEntitlements, subscriptionLicenseState, subscriptionExpiresAt,
  type SubscriptionLicenseState, type SubscriptionLicenseStateName, type SubscriptionLicenseReason,
} from "./derive.js";
export {
  createPlatformUser, verifyPlatformLogin, deactivatePlatformUser, MIN_PLATFORM_PASSWORD_LENGTH,
  type PlatformUser, type PlatformRole, type PlatformUserStatus,
  type PlatformUserRepository, type CreatePlatformUserCommand,
  type VerifyPlatformLoginCommand, type DeactivatePlatformUserCommand,
} from "./platform-user.js";
export {
  recordPayment,
  type Payment, type PaymentRepository,
  type RecordPaymentCommand, type RecordPaymentResult,
} from "./payment.js";
export type {
  PaymentProvider, PaymentProviderId, CheckoutRequest, CheckoutSession,
  ProviderTransactionOutcome, VerifiedProviderTransaction,
} from "./payment-provider.js";
export {
  PAYMOB_TRANSACTION_HMAC_FIELDS, paymobTransactionHmacMessage, hasPaymobSignedShape, parsePaymobTransaction,
  classifyPaymobTransaction, moneyToPaymobCents, paymobCentsToMoney,
  type PaymobTransactionObject, type ParsedPaymobTransaction,
} from "./paymob.js";
export {
  cardCheckoutAmount, CardCheckoutUnavailableError,
  type CardCheckout, type CardCheckoutStatus, type CardCheckoutRepository, type CardCheckoutSettlement,
} from "./card-checkout.js";
export {
  startSignup, verifySignup, isDisposableEmailDomain, DISPOSABLE_EMAIL_DOMAINS, SignupRequestStatus,
  type SignupRequest, type SignupRequestRepository, type StartSignupCommand,
} from "./signup.js";
export {
  PlanKind, QuotaKind, QUOTA_KINDS, normalizeQuotas, isFreePlan, topPublicPaidPlan, defaultFreePlan,
  type PlanQuotas,
} from "./plan.js";
export {
  SubscriptionTransition, PlanChangeActor, trialHasEnded, applyTrialEndToFree, effectiveSubscription,
  needsTrialEndMaterialised, type SubscriptionTransitionRepository,
} from "./subscription.js";
export { MODULE_NAMES, moduleName, type ModuleName } from "./module-catalog.js";
export {
  MODULE_TRIAL_DAYS, ModuleTrialState, moduleTrialState, liveTrialModules, startModuleTrial,
  type ModuleTrial, type ModuleTrialRepository, type StartModuleTrialCommand,
} from "./module-trial.js";
export type { DeriveEntitlementsContext } from "./derive.js";
export {
  LimitKind, LIMIT_OF_QUOTA, UsageRefusalCode, limitRefusal, moduleReadOnlyRefusal, locationOverLimitRefusal,
  seatsOverLimitRefusal, tenantMonthOf,
  type LimitRefusal, type ModuleReadOnlyRefusal, type LocationOverLimitRefusal, type SeatsOverLimitRefusal, type PlanLabel,
} from "./usage-limits.js";
