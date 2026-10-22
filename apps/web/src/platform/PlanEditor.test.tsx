// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { PlanDTO } from "@mezan/contracts";
import { MODULE_CATALOG } from "@mezan/domain";
import { PlatformShell } from "./PlatformShell";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";

const supportSession = { ...testPlatformSession, user: { ...testPlatformSession.user, role: "support" as const } };

const starterPlan: PlanDTO = {
  id: "PLAN-1",
  code: "starter",
  nameAr: "الأساسية",
  nameEn: "Starter",
  modules: ["sales"],
  features: {},
  kind: "paid",
  quotas: {},
  seatsIncluded: 5,
  branchesIncluded: 1,
  warehousesIncluded: 1,
  priceMonthly: "500",
  priceYearly: "5000",
  trialDays: 14,
  isPublic: true,
  sortOrder: 1,
  status: "active",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("PlanEditor", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("posts planCreateRequest when a new plan is saved", async () => {
    let posted: unknown = null;
    renderWithPlatformProviders(<PlatformShell />, {
      route: "/platform/plans/new",
      initialSession: testPlatformSession,
      transport: stubPlatformTransport({
        "GET /plans": () => ({ body: [] }),
        "POST /plans": (init) => {
          posted = JSON.parse(String(init?.body));
          return { status: 201, body: { ...starterPlan, code: "pro" } };
        },
      }),
    });

    await screen.findByRole("heading", { name: "باقة جديدة" });
    fireEvent.change(screen.getByLabelText("الكود"), { target: { value: "pro" } });
    fireEvent.change(screen.getByLabelText("الاسم بالعربية"), { target: { value: "المتقدمة" } });
    fireEvent.change(screen.getByLabelText("الاسم بالإنجليزية"), { target: { value: "Pro" } });
    fireEvent.click(screen.getByRole("button", { name: "المبيعات" }));
    fireEvent.change(screen.getByLabelText("السعر الشهري (جنيه)"), { target: { value: "900" } });
    fireEvent.blur(screen.getByLabelText("السعر الشهري (جنيه)"));
    fireEvent.change(screen.getByLabelText("السعر السنوي (جنيه)"), { target: { value: "9000" } });
    fireEvent.blur(screen.getByLabelText("السعر السنوي (جنيه)"));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(posted).toEqual({
      code: "pro",
      nameAr: "المتقدمة",
      nameEn: "Pro",
      modules: ["sales"],
      seatsIncluded: 1,
      branchesIncluded: 1,
      warehousesIncluded: 1,
      priceMonthly: "900",
      priceYearly: "9000",
      trialDays: 0,
      isPublic: true,
      sortOrder: 0,
      // DEC-31: the console decides whether a plan is the free one and what it
      // caps, so both travel on every save — never inferred from the price.
      kind: "paid",
      // Untouched, so no quota key is sent at all — an absent key is
      // "unlimited", and posting a 0 the operator never typed would cap the
      // plan at zero invoices a month.
      quotas: {},
    }));
  });

  it("a copy posts the source's settings under a new code, and select all includes every module", async () => {
    let posted: { code?: string; modules?: string[]; seatsIncluded?: number } | null = null;
    renderWithPlatformProviders(<PlatformShell />, {
      route: "/platform/plans/new?from=PLAN-1",
      initialSession: testPlatformSession,
      transport: stubPlatformTransport({
        "GET /plans": () => ({ body: [starterPlan] }),
        "POST /plans": (init) => {
          posted = JSON.parse(String(init?.body));
          return { status: 201, body: { ...starterPlan, id: "PLAN-2", code: "starter-plus" } };
        },
      }),
    });

    await screen.findByRole("heading", { name: "باقة جديدة من نسخة" });
    expect(screen.getByLabelText("الاسم بالعربية")).toHaveValue("الأساسية");
    fireEvent.change(screen.getByLabelText("الكود"), { target: { value: "starter-plus" } });
    fireEvent.click(screen.getByRole("button", { name: "تحديد الكل" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ code: "starter-plus", seatsIncluded: 5, nameAr: "الأساسية" });
    expect(posted!.modules).toEqual([...MODULE_CATALOG]);
  });

  it("prefills the form from the existing plan and PUTs on save", async () => {
    let putBody: unknown = null;
    renderWithPlatformProviders(<PlatformShell />, {
      route: "/platform/plans/PLAN-1",
      initialSession: testPlatformSession,
      transport: stubPlatformTransport({
        "GET /plans": () => ({ body: [starterPlan] }),
        "PUT /plans/PLAN-1": (init) => {
          putBody = JSON.parse(String(init?.body));
          return { body: starterPlan };
        },
      }),
    });

    await screen.findByDisplayValue("الأساسية");
    fireEvent.change(screen.getByLabelText("الاسم بالإنجليزية"), { target: { value: "Starter Plus" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(putBody).toMatchObject({ nameEn: "Starter Plus", nameAr: "الأساسية" }));
  });

  it("a not-found plan id shows an error instead of a blank form", async () => {
    renderWithPlatformProviders(<PlatformShell />, {
      route: "/platform/plans/MISSING",
      initialSession: testPlatformSession,
      transport: stubPlatformTransport({ "GET /plans": () => ({ body: [starterPlan] }) }),
    });
    expect(await screen.findByText("تعذّر العثور على هذه الباقة.")).toBeInTheDocument();
  });

  it("support role sees no save button", async () => {
    renderWithPlatformProviders(<PlatformShell />, {
      route: "/platform/plans/PLAN-1",
      initialSession: supportSession,
      transport: stubPlatformTransport({ "GET /plans": () => ({ body: [starterPlan] }) }),
    });
    await screen.findByDisplayValue("الأساسية");
    expect(screen.queryByRole("button", { name: "حفظ" })).not.toBeInTheDocument();
  });
});
