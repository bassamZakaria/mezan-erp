// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { LeadDTO, PipelineStageDTO } from "@mezan/contracts";
import { LeadsScreen } from "./LeadsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleLeads: LeadDTO[] = [
  {
    id: "lead-1",
    name: "أحمد سالم",
    company: "شركة النور",
    email: "ahmed@example.com",
    phone: "01000000000",
    source: "website",
    expectedValue: "5000.000000",
    interest: "نظام محاسبي",
    notes: null,
    status: "new",
    convertedCustomerId: null,
    convertedOpportunityId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "lead-2",
    name: "منى فتحي",
    company: "مؤسسة الأمل",
    email: null,
    phone: null,
    source: "referral",
    expectedValue: null,
    interest: null,
    notes: null,
    status: "qualified",
    convertedCustomerId: null,
    convertedOpportunityId: null,
    createdAt: "2026-08-02T00:00:00.000Z",
  },
];

const sampleStages: PipelineStageDTO[] = [
  { id: "stage-1", name: "عميل محتمل", order: 1, defaultProbability: 10, color: "#3b82f6", isWinStage: false, isLossStage: false, active: true },
  { id: "stage-2", name: "تم الإغلاق", order: 6, defaultProbability: 100, color: "#22c55e", isWinStage: true, isLossStage: false, active: true },
];

function renderScreen(leads: LeadDTO[] = sampleLeads) {
  let current = [...leads];
  const transport = stubTransport({
    "GET /crm/leads": () => ({ body: current }),
    "GET /crm/pipeline-stages": () => ({ body: sampleStages }),
    "POST /crm/leads": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: LeadDTO = {
        id: body.id,
        name: body.name,
        company: body.company ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        source: body.source ?? "other",
        expectedValue: body.expectedValue ?? null,
        interest: body.interest ?? null,
        notes: body.notes ?? null,
        status: "new",
        convertedCustomerId: null,
        convertedOpportunityId: null,
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /crm/leads/lead-1/transition": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const updated: LeadDTO = { ...current[0]!, status: body.status };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
    "POST /crm/leads/lead-2/convert": () => {
      const updated: LeadDTO = { ...current[1]!, status: "converted", convertedCustomerId: "cust-1", convertedOpportunityId: "opp-1" };
      current = [current[0]!, updated];
      return { body: { lead: updated, customerId: "cust-1", opportunityId: "opp-1" } };
    },
  });
  return renderWithProviders(<LeadsScreen />, { transport, initialSession: testAdminSession });
}

describe("LeadsScreen", () => {
  it("lists leads from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "العملاء المحتملون" })).toBeInTheDocument();
    expect(await screen.findByText("أحمد سالم")).toBeInTheDocument();
    expect(screen.getByText("منى فتحي")).toBeInTheDocument();
  });

  it("shows an empty state when there are no leads yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد بيانات")).toBeInTheDocument();
  });

  it("filters the list by status via the chip row", async () => {
    renderScreen();
    await screen.findByText("أحمد سالم");
    fireEvent.click(screen.getByRole("tab", { name: /^مؤهل/ }));
    expect(screen.getByText("منى فتحي")).toBeInTheDocument();
    expect(screen.queryByText("أحمد سالم")).not.toBeInTheDocument();
  });

  it("adds a new lead through the side panel", async () => {
    renderScreen();
    await screen.findByText("أحمد سالم");
    fireEvent.click(screen.getByRole("button", { name: "عميل محتمل جديد" }));

    const dialog = screen.getByRole("dialog", { name: "عميل محتمل جديد" });
    fireEvent.change(within(dialog).getByLabelText("الاسم *"), { target: { value: "خالد يوسف" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("خالد يوسف")).toBeInTheDocument();
  });

  it("opens the detail panel and transitions a new lead to contacted", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("أحمد سالم"));
    const dialog = screen.getByRole("dialog", { name: "أحمد سالم" });
    fireEvent.click(within(dialog).getByRole("button", { name: "تم التواصل" }));

    expect(await within(dialog).findByRole("button", { name: "مؤهل" })).toBeInTheDocument();
  });

  it("converts a qualified lead into a customer and opportunity", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("منى فتحي"));
    const detailDialog = screen.getByRole("dialog", { name: "منى فتحي" });
    fireEvent.click(within(detailDialog).getByRole("button", { name: "تحويل" }));

    const convertDialog = screen.getByRole("dialog", { name: "تحويل العميل المحتمل" });
    fireEvent.click(within(convertDialog).getByRole("button", { name: "تحويل" }));

    expect(await screen.findByText("محول")).toBeInTheDocument();
  });
});
