import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_BILLING_FEATURE, UNLICENSED_ENTITLEMENTS, createEntitlements, withSubscriptionBilling } from "../entitlements/index.js";
import { SHELL_REQUESTS, ShellRequest, planServesShellRequest } from "./shell-requests.js";

const LICENCE = createEntitlements({ plan: "DESKTOP", activeModules: ["sales", "accounting", "hr"], features: {}, seats: 5, expiresAt: null });

describe("the subscription request is asked only where subscription billing exists", () => {
  it("is not served under an on-premises licence, which carries no subscription", () => {
    expect(planServesShellRequest(LICENCE, ShellRequest.Subscription)).toBe(false);
  });

  it("is served once the edition stamps subscription billing onto the entitlements", () => {
    const cloud = withSubscriptionBilling(LICENCE);
    expect(cloud.features[SUBSCRIPTION_BILLING_FEATURE]).toBe(true);
    expect(planServesShellRequest(cloud, ShellRequest.Subscription)).toBe(true);
  });

  it("stays served for a cloud tenant whose subscription could not be resolved — that tenant needs the billing page most", () => {
    expect(planServesShellRequest(withSubscriptionBilling(UNLICENSED_ENTITLEMENTS), ShellRequest.Subscription)).toBe(true);
  });

  it("keeps every other grant of the entitlements it stamps", () => {
    const cloud = withSubscriptionBilling(createEntitlements({ ...LICENCE, features: { "lan.multi_till": true }, planKind: "paid" }));
    expect(cloud).toMatchObject({ plan: "DESKTOP", activeModules: ["sales", "accounting", "hr"], seats: 5, planKind: "paid" });
    expect(cloud.features["lan.multi_till"]).toBe(true);
    expect(cloud.has("hr")).toBe(true);
  });

  it("names a feature only on the request the tenant backend does not serve", () => {
    const gated = Object.values(ShellRequest).filter((request) => SHELL_REQUESTS[request].feature !== null);
    expect(gated).toEqual([ShellRequest.Subscription]);
    expect(SHELL_REQUESTS[ShellRequest.Subscription].servedByTenant).toBe(false);
  });

  it("still gates a module request on its module alone", () => {
    expect(planServesShellRequest(LICENCE, ShellRequest.Employees)).toBe(true);
    // The staff list is the free hr.people part: every plan serves it to other modules' pickers.
    expect(planServesShellRequest({ activeModules: ["sales"] }, ShellRequest.Employees)).toBe(true);
    expect(planServesShellRequest({ activeModules: [] }, ShellRequest.Settings)).toBe(true);
  });
});
