// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor} from "@testing-library/react";
import type { ActivityDTO, LeadDTO, OpportunityDTO } from "@mezan/contracts";
import { CrmHubScreen } from "./CrmHubScreen";
import { NavigationProvider } from "../../navigation";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";

function TestNavigation({ navigate, children }: { navigate: (screen: string, intent?: unknown) => void; children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: navigate as never,
        segments,
        openSubPage: setSegments,
        openScreenAt: () => {},
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

const sampleLeads: LeadDTO[] = [
  {
    id: "LEAD-1",
    name: "شركة النور",
    company: null,
    email: null,
    phone: null,
    source: "website",
    expectedValue: null,
    interest: null,
    notes: null,
    status: "new",
    convertedCustomerId: null,
    convertedOpportunityId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    id: "LEAD-2",
    name: "مؤسسة الأمل",
    company: null,
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

const sampleOpportunities: OpportunityDTO[] = [
  {
    id: "OPP-1",
    title: "صفقة توريد",
    customerId: "CUST-1",
    branchId: null,
    stageId: "STAGE-1",
    expectedValue: "15000",
    probability: 50,
    expectedCloseDate: null,
    notes: null,
    status: "open",
    createdAt: "2026-08-01T00:00:00.000Z",
    closedAt: null,
  },
];

const sampleActivities: ActivityDTO[] = [
  {
    id: "ACT-1",
    subject: "متابعة عرض السعر",
    type: "call",
    relatedLeadId: "LEAD-1",
    relatedOpportunityId: null,
    dueDate: "2026-09-01",
    status: "pending",
    notes: null,
    createdAt: "2026-08-25T00:00:00.000Z",
  },
];

function baseTransport(overrides: Record<string, () => { status?: number; body: unknown }> = {}) {
  return stubTransport({
    "GET /crm/leads": () => ({ body: sampleLeads }),
    "GET /crm/opportunities": () => ({ body: sampleOpportunities }),
    "GET /crm/activities": () => ({ body: sampleActivities }),
    ...overrides,
  });
}

function renderScreen(navigate: (screen: string, intent?: unknown) => void = vi.fn(), overrides?: Record<string, () => { status?: number; body: unknown }>) {
  const transport = baseTransport(overrides);
  return renderWithProviders(
    <TestNavigation navigate={navigate}>
      <CrmHubScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("CrmHubScreen", () => {
  it("renders stat tiles with real counts and money formatting", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "إدارة علاقات العملاء" })).toBeInTheDocument();
    // One new lead, one open opportunity, one pending activity — three "1" tiles.
    expect(await screen.findAllByText("1")).toHaveLength(3);
    expect(await screen.findByText("15,000.00")).toBeInTheDocument(); // open pipeline value
    expect(await screen.findByText("ج.م")).toBeInTheDocument();
  });

  it("renders the latest activities list with type and due date", async () => {
    renderScreen();
    expect(await screen.findByText("متابعة عرض السعر")).toBeInTheDocument();
    expect(await screen.findByText("مكالمة")).toBeInTheDocument();
    expect(await screen.findByText("· 2026-09-01")).toBeInTheDocument();
    expect(await screen.findByText("قيد الانتظار")).toBeInTheDocument();
  });

  it("shows the configured empty state when there are no activities", async () => {
    renderScreen(vi.fn(), { "GET /crm/activities": () => ({ body: [] }) });
    expect(await screen.findByText("لا توجد أنشطة بعد — ستظهر هنا فور تسجيل أول نشاط.")).toBeInTheDocument();
  });

  it("shows the Arabic error message when a query fails", async () => {
    renderScreen(vi.fn(), { "GET /crm/leads": () => ({ status: 500, body: { error: "INTERNAL" } }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل بيانات إدارة علاقات العملاء.");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });

  it("renders all three quick actions and navigates on click", async () => {
    const navigate = vi.fn();
    renderScreen(navigate);
    fireEvent.click(await screen.findByRole("button", { name: "عميل محتمل جديد" }));
    expect(navigate).toHaveBeenCalledWith("leads", "create");
    fireEvent.click(screen.getByRole("button", { name: "فرصة جديدة" }));
    expect(navigate).toHaveBeenCalledWith("opportunities", "create");
    fireEvent.click(screen.getByRole("button", { name: "نشاط جديد" }));
    expect(navigate).toHaveBeenCalledWith("crm-activities", "create");
  });
});
