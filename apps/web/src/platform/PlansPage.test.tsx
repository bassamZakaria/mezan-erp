// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { PlanDTO } from "@mezan/contracts";
import { PlatformShell } from "./PlatformShell";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";

const supportSession = { ...testPlatformSession, user: { ...testPlatformSession.user, role: "support" as const } };

const starterPlan: PlanDTO = {
  id: "PLAN-1",
  code: "starter",
  nameAr: "الأساسية",
  nameEn: "Starter",
  modules: ["dashboard", "sales"],
  features: {},
  seatsIncluded: 5,
  branchesIncluded: 1,
  warehousesIncluded: 1,
  priceMonthly: "500.00",
  priceYearly: "5000.00",
  trialDays: 14,
  isPublic: true,
  sortOrder: 1,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function renderShell(initialPlans: PlanDTO[], route = "/platform/plans", session = testPlatformSession) {
  const plans = [...initialPlans];
  return renderWithPlatformProviders(<PlatformShell />, {
    route,
    initialSession: session,
    transport: stubPlatformTransport({
      "GET /plans": () => ({ body: plans }),
      "POST /plans/PLAN-1/retire": () => {
        const current = plans[0];
        if (!current) throw new Error("missing plan");
        plans[0] = { ...current, status: "retired" };
        return { body: plans[0] };
      },
    }),
  });
}

describe("PlansPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows code, names, modules count, seats, prices and status", async () => {
    renderShell([starterPlan]);
    expect(await screen.findByText("الأساسية")).toBeInTheDocument();
    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("starter")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "الباقات" })).toBeInTheDocument();
  });

  it("«باقة جديدة» opens the plan editor", async () => {
    renderShell([starterPlan]);
    await screen.findByText("الأساسية");
    fireEvent.click(screen.getByRole("button", { name: "باقة جديدة" }));
    expect(await screen.findByRole("heading", { name: "باقة جديدة" })).toBeInTheDocument();
  });

  it("retires an active plan", async () => {
    renderShell([starterPlan]);
    await screen.findByText("الأساسية");
    fireEvent.click(screen.getByRole("button", { name: "إيقاف الباقة" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "إيقاف الباقة" })).not.toBeInTheDocument());
  });

  it("support role sees no write buttons", async () => {
    renderShell([starterPlan], "/platform/plans", supportSession);
    await screen.findByText("الأساسية");
    expect(screen.queryByRole("button", { name: "باقة جديدة" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تعديل" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إيقاف الباقة" })).not.toBeInTheDocument();
  });
});
