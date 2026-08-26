// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { CustomerDTO, OpportunityDTO, PipelineStageDTO } from "@mezan/contracts";
import { PipelineScreen } from "./PipelineScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const sampleCustomers: CustomerDTO[] = [
  {
    id: "cust-1",
    code: "C-001",
    nameAr: "شركة النور",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 0,
    currency: "EGP",
    openingBalance: "0.000000",
    active: true,
    priceListId: null,
    creditLimit: "0.000000",
    taxExempt: false,
    etaBuyerType: "business",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
  },
];

const sampleStages: PipelineStageDTO[] = [
  { id: "stage-1", name: "عميل محتمل", order: 1, defaultProbability: 10, color: "#3b82f6", isWinStage: false, isLossStage: false, active: true },
  { id: "stage-2", name: "تفاوض", order: 2, defaultProbability: 60, color: "#3b82f6", isWinStage: false, isLossStage: false, active: true },
  { id: "stage-3", name: "تم الإغلاق", order: 3, defaultProbability: 100, color: "#22c55e", isWinStage: true, isLossStage: false, active: true },
];

const sampleOpportunities: OpportunityDTO[] = [
  {
    id: "opp-1",
    title: "صفقة النور الكبرى",
    customerId: "cust-1",
    branchId: null,
    stageId: "stage-1",
    expectedValue: "10000.000000",
    probability: 10,
    expectedCloseDate: "2026-09-01",
    notes: null,
    status: "open",
    createdAt: "2026-08-01T00:00:00.000Z",
    closedAt: null,
  },
  {
    id: "opp-2",
    title: "صفقة مكسوبة",
    customerId: "cust-1",
    branchId: null,
    stageId: "stage-3",
    expectedValue: "5000.000000",
    probability: 100,
    expectedCloseDate: null,
    notes: null,
    status: "won",
    createdAt: "2026-08-02T00:00:00.000Z",
    closedAt: "2026-08-10T00:00:00.000Z",
  },
];

function renderScreen(opportunities: OpportunityDTO[] = sampleOpportunities) {
  let current = [...opportunities];
  const transport = stubTransport({
    "GET /crm/opportunities": () => ({ body: current }),
    "GET /crm/pipeline-stages": () => ({ body: sampleStages }),
    "GET /customers": () => ({ body: sampleCustomers }),
    "POST /crm/opportunities": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: OpportunityDTO = {
        id: body.id,
        title: body.title,
        customerId: body.customerId,
        branchId: null,
        stageId: body.stageId,
        expectedValue: body.expectedValue ?? "0.000000",
        probability: body.probability ?? 50,
        expectedCloseDate: body.expectedCloseDate ?? null,
        notes: body.notes ?? null,
        status: "open",
        createdAt: "2026-08-21T00:00:00.000Z",
        closedAt: null,
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /crm/opportunities/opp-1/move-stage": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const updated: OpportunityDTO = { ...current[0]!, stageId: body.stageId };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
  });
  return renderWithProviders(<PipelineScreen />, { transport, initialSession: testAdminSession });
}

describe("PipelineScreen", () => {
  it("renders a kanban column per active stage with its own opportunities and KPI totals", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "خط المبيعات" })).toBeInTheDocument();
    expect(await screen.findByText("صفقة النور الكبرى")).toBeInTheDocument();
    expect(screen.getByText("صفقة مكسوبة")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "عميل محتمل" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "تفاوض" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "تم الإغلاق" })).toBeInTheDocument();
  });

  it("shows an empty column state for a stage with no opportunities", async () => {
    renderScreen();
    await screen.findByText("صفقة النور الكبرى");
    expect(screen.getByText("لا توجد فرص")).toBeInTheDocument();
  });

  it("moves an opportunity to another stage via the per-card select", async () => {
    renderScreen();
    await screen.findByText("صفقة النور الكبرى");
    fireEvent.change(screen.getByLabelText("نقل إلى"), { target: { value: "stage-2" } });

    await screen.findByText("صفقة النور الكبرى");
    expect(screen.getByLabelText("نقل إلى")).toHaveValue("stage-2");
  });

  it("adds a new opportunity from the pipeline board", async () => {
    renderScreen();
    await screen.findByText("صفقة النور الكبرى");
    fireEvent.click(screen.getByRole("button", { name: "إضافة فرصة" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة فرصة" });
    fireEvent.change(within(dialog).getByLabelText("العنوان *"), { target: { value: "فرصة جديدة من اللوحة" } });
    fireEvent.focus(within(dialog).getByPlaceholderText("اختر العميل..."));
    fireEvent.mouseDown(within(dialog).getByText("شركة النور"));
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("فرصة جديدة من اللوحة")).toBeInTheDocument();
  });
});
