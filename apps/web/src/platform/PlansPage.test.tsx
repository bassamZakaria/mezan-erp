// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { PlanDTO } from "@mezan/contracts";
import { PlatformShell } from "./PlatformShell";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";

const supportSession = { ...testPlatformSession, user: { ...testPlatformSession.user, role: "support" as const } };

const starterPlan: PlanDTO = {
  id: "PLAN-1",
  code: "starter",
  nameAr: "الأساسية",
  nameEn: "Starter",
  modules: ["accounting", "sales"],
  features: {},
  kind: "paid",
  quotas: {},
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

function renderShell(initialPlans: PlanDTO[], route = "/platform/plans", session = testPlatformSession, tenants: unknown[] = []) {
  const plans = [...initialPlans];
  return renderWithPlatformProviders(<PlatformShell />, {
    route,
    initialSession: session,
    transport: stubPlatformTransport({
      "GET /plans": () => ({ body: plans }),
      "GET /tenants": () => ({ body: tenants }),
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

  it("counts the companies subscribed to each plan", async () => {
    const onPlan = (planId: string | null) => ({ subscription: planId ? { planId } : null });
    renderShell([starterPlan, { ...starterPlan, id: "PLAN-2", code: "pro", nameAr: "المتقدمة", nameEn: "Pro" }], "/platform/plans", testPlatformSession, [
      onPlan("PLAN-1"),
      onPlan("PLAN-1"),
      onPlan("PLAN-1"),
      onPlan(null),
    ]);
    const row = (await screen.findByText("الأساسية")).closest("tr")!;
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByText("المتقدمة").closest("tr")!).getByText("0")).toBeInTheDocument();
  });

  it("«نسخ» opens a new plan prefilled from the copied one", async () => {
    renderShell([starterPlan]);
    await screen.findByText("الأساسية");
    fireEvent.click(screen.getByRole("button", { name: "نسخ" }));
    expect(await screen.findByRole("heading", { name: "باقة جديدة من نسخة" })).toBeInTheDocument();
    expect(screen.getByLabelText("الاسم بالعربية")).toHaveValue("الأساسية");
    expect(screen.getByLabelText("الكود")).toHaveValue("");
  });

  it("support role sees no write buttons", async () => {
    renderShell([starterPlan], "/platform/plans", supportSession);
    await screen.findByText("الأساسية");
    expect(screen.queryByRole("button", { name: "باقة جديدة" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تعديل" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إيقاف الباقة" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "نسخ" })).not.toBeInTheDocument();
  });
});
