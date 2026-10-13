// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CustomerDTO, OpportunityDTO, PipelineStageDTO } from "@mezan/contracts";
import { OpportunitiesScreen } from "./OpportunitiesScreen";
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
    taxExemptionRateId: null,
    etaBuyerType: "business",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
  },
];

const sampleStages: PipelineStageDTO[] = [
  { id: "stage-1", name: "عميل محتمل", order: 1, defaultProbability: 10, color: "#3b82f6", isWinStage: false, isLossStage: false, active: true },
  { id: "stage-2", name: "تم الإغلاق", order: 6, defaultProbability: 100, color: "#22c55e", isWinStage: true, isLossStage: false, active: true },
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
    title: "صفقة مغلقة",
    customerId: "cust-1",
    branchId: null,
    stageId: "stage-2",
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
  });
  return renderWithProviders(<OpportunitiesScreen />, { transport, initialSession: testAdminSession });
}

describe("OpportunitiesScreen", () => {
  it("lists opportunities with resolved customer and stage names", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الفرص" })).toBeInTheDocument();
    expect(await screen.findByText("صفقة النور الكبرى")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("شركة النور").length).toBeGreaterThan(0);
    expect(within(table).getByText("عميل محتمل")).toBeInTheDocument();
    expect(within(table).getByText("تم الإغلاق")).toBeInTheDocument();
  });

  it("shows an empty state when there are no opportunities yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد بيانات")).toBeInTheDocument();
  });

  it("filters the list by status via the chip row", async () => {
    renderScreen();
    await screen.findByText("صفقة النور الكبرى");
    fireEvent.click(screen.getByRole("tab", { name: /مكسوبة/ }));
    await waitFor(() => expect(screen.queryByText("صفقة النور الكبرى")).not.toBeInTheDocument());
    expect(screen.getByText("صفقة مغلقة")).toBeInTheDocument();
  });

  it("adds a new opportunity through the side panel", async () => {
    renderScreen();
    await screen.findByText("صفقة النور الكبرى");
    fireEvent.click(screen.getByRole("button", { name: "فرصة جديدة" }));

    const dialog = screen.getByRole("dialog", { name: "فرصة جديدة" });
    expect(within(dialog).getByText("العنوان *")).toBeInTheDocument();
    // The "العنوان *" label isn't programmatically linked to its input (see final report),
    // so target the title field by position — first textbox in the form.
    fireEvent.change(within(dialog).getAllByRole("textbox")[0]!, { target: { value: "فرصة تجريبية" } });
    fireEvent.focus(within(dialog).getByPlaceholderText("اختر العميل..."));
    fireEvent.mouseDown(within(dialog).getByText("شركة النور"));
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("فرصة تجريبية")).toBeInTheDocument();
  });
});
