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
export { hasAnyPartOf, hasReadOnlyModule, heldModuleIds, type EntitlementModuleTrial } from "./entitlements.js";
export { FREE_SUB_MODULES, HrSubModule, SUB_MODULES, SUB_MODULE_NAMES, isSubModule, parentOf } from "./sub-modules.js";
export { MODULE_NAME_AR, MODULE_NAME_EN, moduleNotLicensedMessageAr, moduleNotLicensedMessageEn } from "./module-refusal.js";
