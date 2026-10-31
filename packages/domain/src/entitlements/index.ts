/** Entitlements — the shared capability object read by every gate. */

export {
  createEntitlements,
  hasModule,
  hasFeature,
  UNLICENSED_ENTITLEMENTS,
  SUBSCRIPTION_BILLING_FEATURE,
  withSubscriptionBilling,
  type Entitlements,
  type EntitlementsView,
  type EntitlementLimits,
} from "./entitlements.js";
export { hasAnyPartOf, hasReadOnlyModule, type EntitlementModuleTrial } from "./entitlements.js";
export { FREE_SUB_MODULES, HrSubModule, SUB_MODULES, SUB_MODULE_NAMES, isSubModule, parentOf } from "./sub-modules.js";
export { MODULE_NAME_AR, moduleNotLicensedMessageAr } from "./module-refusal.js";
