// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { SUBSCRIPTION_BILLING_FEATURE } from "@mezan/domain";
import { BillingScreen } from "./BillingScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const ENTITLEMENTS = { plan: "pro", activeModules: ["sales", "admin"], seats: 5, expiresAt: null };

function open(features: Record<string, boolean>) {
  const asked: string[] = [];
  const base = stubTransport({
    "GET /entitlements": () => ({ body: { ...ENTITLEMENTS, features } }),
    "GET /billing/subscription": () => ({
      body: {
        cardCheckout: false, testMode: false, canRenew: false, subscription: null, today: "2026-10-14", month: "2026-10",
        trialEndsAt: null, trialDaysLeft: null, moduleTrialDays: 0, quotas: [], limits: [], modules: [], plans: [], checkouts: [],
      },
    }),
  });
  renderWithProviders(<BillingScreen />, {
    transport: (path, init) => {
      asked.push(path.split("?")[0] ?? path);
      return base(path, init);
    },
    initialSession: testAdminSession,
  });
  return asked;
}

describe("BillingScreen — opened by its address on an edition without subscription billing", () => {
  it("says this edition runs on a licence, and asks the server for no subscription", async () => {
    const asked = open({});
    expect(await screen.findByText(/تعمل بترخيص وليس باشتراك/)).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked).not.toContain("/billing/subscription");
  });

  it("reads the subscription on a cloud tenant and shows no such notice", async () => {
    const asked = open({ [SUBSCRIPTION_BILLING_FEATURE]: true });
    await waitFor(() => expect(asked).toContain("/billing/subscription"));
    expect(screen.queryByText(/تعمل بترخيص وليس باشتراك/)).not.toBeInTheDocument();
  });
});
