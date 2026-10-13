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
export { hasReadOnlyModule, type EntitlementModuleTrial } from "./entitlements.js";
