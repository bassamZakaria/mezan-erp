/** Entitlements — the shared capability object read by every gate. */

export {
  createEntitlements,
  hasModule,
  hasFeature,
  UNLICENSED_ENTITLEMENTS,
  type Entitlements,
  type EntitlementsView,
  type EntitlementLimits,
} from "./entitlements.js";
export { hasReadOnlyModule, type EntitlementModuleTrial } from "./entitlements.js";
export { MODULE_NAME_AR, moduleNotLicensedMessageAr } from "./module-refusal.js";
