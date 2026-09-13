export { MODULE_CATALOG, isKnownModule, type ModuleId } from "./module-catalog.js";
export * from "./errors.js";
export { isValidSlug } from "./slug.js";
export {
  createTenant, activateTenant, suspendTenant, resumeTenant, archiveTenant,
  tenantDbFile,
  type Tenant, type TenantStatus, type TenantRepository,
  type CreateTenantCommand, type TenantTransitionCommand,
} from "./tenant.js";
export {
  createPlan, updatePlan, retirePlan, dedupeModules,
  type Plan, type PlanStatus, type PlanRepository,
  type CreatePlanCommand, type UpdatePlanCommand, type HasLiveSubscribers,
} from "./plan.js";
export {
  addPeriod, addDays, DEFAULT_GRACE_DAYS,
  startSubscription, renewSubscription, changePlan, markPastDue,
  suspendSubscription, resumeSubscription, cancelSubscription,
  type Subscription, type SubscriptionStatus, type BillingCycle, type SubscriptionRepository,
  type StartSubscriptionCommand, type SubscriptionCommand, type ChangePlanCommand,
} from "./subscription.js";
export {
  deriveEntitlements, subscriptionLicenseState, subscriptionExpiresAt,
  type SubscriptionLicenseState, type SubscriptionLicenseStateName, type SubscriptionLicenseReason,
} from "./derive.js";
export {
  createPlatformUser, MIN_PLATFORM_PASSWORD_LENGTH,
  type PlatformUser, type PlatformRole, type PlatformUserStatus,
  type PlatformUserRepository, type CreatePlatformUserCommand,
} from "./platform-user.js";
