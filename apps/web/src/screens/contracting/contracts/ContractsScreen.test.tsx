// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Session } from "../../../data/session";
import type { BoqLineDTO, VariationOrderDTO, WorksContractDTO } from "@mezan/contracts";
import { ContractsScreen } from "./ContractsScreen";
import { VariationOrdersScreen } from "./VariationOrdersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../../data/test-support";
import { NavigationProvider } from "../../../navigation";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function TestNavigation({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{ navigate: () => {}, segments, openSubPage: setSegments, openScreenAt: () => {}, intent: null, clearIntent: () => {} }}
    >
      {children}
    </NavigationProvider>
  );
}

const contract: WorksContractDTO = {
  id: "CTR-DEMO-1",
  docNo: "CTR-0011",
  projectId: "PRJ-DEMO-1",
  customerId: "CUST-DEMO-2",
  titleAr: "عقد إنشاء برج الأمل السكني",
  titleEn: null,
  contractType: "private",
  signedDate: "2026-02-15",
  startDate: "2026-03-01",
  plannedEndDate: "2027-02-28",
  currency: "EGP",
  status: "active",
  activatedAt: "2026-03-01",
  completedAt: null,
  terminatedAt: null,
  notes: null,
  estimatedTotalCost: "20300000.000000",
  budgetRevisions: [],
  tenderDiscountPercent: "4.5",
  retentionPercent: "5",
  retentionCapPercent: null,
  advancePercent: "10",
  advanceRecoveryPercent: "10",
  materialsOnSitePercent: "75",
  deemedWagePercent: "20",
  socialInsuranceRatePercent: "18.75",
  socialInsuranceNote: null,
  withholdingTaxPercent: "1",
  vatBasis: "standard",
  paymentTermDays: 30,
  defectsLiabilityMonths: 12,
  recognitionPolicy: "cost_to_cost",
  stampDutyPercent: "0",
  latePenaltyPercentPerPeriod: "0",
  latePenaltyCapPercent: "10",
  finalSecurityPercent: "0",
  contractValue: "22331500.000000",
  approvedVariationsValue: "9876000.000000",
  contractValueAfterVariations: "32207500.000000",
  boqLineCount: 7,
  variationCount: 3,
  canComplete: true,
};

const boqLines: BoqLineDTO[] = [
  {
    id: "CTR-DEMO-1-B1",
    contractId: "CTR-DEMO-1",
    code: "1",
    descriptionAr: "أعمال الحفر والردم",
    descriptionEn: null,
    unit: "m3",
    unitLabelAr: "م٣",
    qty: "12000.000000",
    unitRate: "185.000000",
    lineValue: "2220000.000000",
    estimatedUnitCost: "120.000000",
    section: null,
    sortOrder: 1,
    origin: "base",
    variationOrderId: null,
    costCategory: "equipment",
  },
  {
    id: "VO-DEMO-1-L1",
    contractId: "CTR-DEMO-1",
    code: "7",
    descriptionAr: "حديد التسليح",
    descriptionEn: null,
    unit: "ton",
    unitLabelAr: "طن",
    qty: "210.000000",
    unitRate: "46500.000000",
    lineValue: "9765000.000000",
    estimatedUnitCost: null,
    section: null,
    sortOrder: 7,
    origin: "variation",
    variationOrderId: "VO-DEMO-1",
    costCategory: "materials",
  },
];

const order: VariationOrderDTO = {
  id: "VO-DEMO-2",
  docNo: "VO-0002",
  contractId: "CTR-DEMO-1",
  contractDocNo: "CTR-0011",
  date: "2026-07-21",
  titleAr: "زيادة كميات الحفر والردم",
  reason: "منسوب التأسيس",
  requestedBy: "consultant",
  status: "draft",
  approvedAt: null,
  approvedBy: null,
  rejectedReason: null,
  createdBy: "u1",
  netValue: "111000.000000",
  lines: [
    {
      id: "L1",
      kind: "change",
      boqLineId: "CTR-DEMO-1-B1",
      newLine: null,
      qtyDelta: "600.000000",
      unitRateOverride: null,
      sortOrder: 1,
      lineValue: "111000.000000",
    },
  ],
};

interface Calls {
  approvedWith: string | null;
}

function renderContracts(session: Session = testAdminSession) {
  const transport = stubTransport({
    "GET /contracting/contracts": () => ({ body: [contract] }),
    "GET /contracting/contracts/CTR-DEMO-1/boq": () => ({ body: { lines: boqLines, total: "32096500.000000" } }),
    "GET /contracting/contracts/CTR-DEMO-1/boq/contracted-qty": () => ({
      body: {
        asOfDate: "2026-07-01",
        rows: [
          {
            boqLineId: "CTR-DEMO-1-B1",
            code: "1",
            descriptionAr: "أعمال الحفر والردم",
            baseQty: "12000.000000",
            adjustmentQty: "0.000000",
            contractedQty: "12000.000000",
          },
        ],
      },
    }),
    "GET /contracting/variation-orders": () => ({ body: [order] }),
    "GET /projects": () => ({ body: [{ id: "PRJ-DEMO-1", code: "TOWER-A", nameAr: "برج الأمل السكني", customerId: "CUST-DEMO-2" }] }),
    "GET /customers": () => ({ body: [{ id: "CUST-DEMO-2", code: "C-2", nameAr: "مؤسسة النور للمقاولات" }] }),
  });
  return renderWithProviders(
    <TestNavigation>
      <ContractsScreen />
    </TestNavigation>,
    { transport, initialSession: session },
  );
}

describe("ContractsScreen", () => {
  it("lists a contract with the value and the value AFTER variations the server derived", async () => {
    renderContracts();
    expect(await screen.findByText("CTR-0011")).toBeInTheDocument();
    expect(screen.getByText("برج الأمل السكني")).toBeInTheDocument();
    expect(screen.getByText("مؤسسة النور للمقاولات")).toBeInTheDocument();
    // Once in the row and once in the list's own total footer.
    expect(screen.getAllByText("22,331,500.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("32,207,500.00").length).toBeGreaterThan(0);
  });

  it("opens the contract and shows its commercial terms, not a placeholder", async () => {
    renderContracts();
    fireEvent.click(await screen.findByText("CTR-0011"));
    expect(await screen.findByRole("heading", { name: /CTR-0011/ })).toBeInTheDocument();
    expect(screen.getByText("4.5%")).toBeInTheDocument();
    expect(screen.getByText("18.75%")).toBeInTheDocument();
    expect(screen.getByText("الأساس العام ١٤٪ على كامل القيمة")).toBeInTheDocument();
  });

  it("shows the BOQ read-only on an active contract, marking the variation-added line", async () => {
    renderContracts();
    fireEvent.click(await screen.findByText("CTR-0011"));
    fireEvent.click(await screen.findByRole("tab", { name: "جدول الكميات" }));
    expect((await screen.findAllByText("أعمال الحفر والردم")).length).toBeGreaterThan(0);
    expect(screen.getByText("حديد التسليح")).toBeInTheDocument();
    expect(screen.getAllByText("أمر تغيير").length).toBeGreaterThan(0);
    // Frozen once active: the editor's own controls are not offered.
    expect(screen.queryByRole("button", { name: "حفظ جدول الكميات" })).not.toBeInTheDocument();
    expect(await screen.findByText("الكمية التعاقدية حتى تاريخ")).toBeInTheDocument();
  });

  it("hides every write control from a reader who holds only contracting.boq.view", async () => {
    renderContracts({ ...testAdminSession, isCompanyAdmin: false, permissions: ["contracting.boq.view"] });
    await screen.findByText("CTR-0011");
    expect(screen.queryByRole("button", { name: "عقد جديد" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("CTR-0011"));
    expect(await screen.findByRole("heading", { name: /CTR-0011/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إنهاء العقد" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "فسخ العقد" })).not.toBeInTheDocument();
  });
});

function renderVariationOrders(session: Session, calls: Calls) {
  const transport = stubTransport({
    "GET /contracting/variation-orders": () => ({ body: [order] }),
    "GET /contracting/contracts": () => ({ body: [contract] }),
    "GET /contracting/contracts/CTR-DEMO-1/boq": () => ({ body: { lines: boqLines, total: "32096500.000000" } }),
    "POST /contracting/variation-orders/VO-DEMO-2/approve": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      calls.approvedWith = body.approvedAt;
      return { body: { ...order, status: "approved", approvedAt: body.approvedAt } };
    },
  });
  return renderWithProviders(
    <TestNavigation>
      <VariationOrdersScreen />
    </TestNavigation>,
    { transport, initialSession: session },
  );
}

describe("VariationOrdersScreen", () => {
  it("lists the order with its net value and shows no approval date while it is a draft", async () => {
    renderVariationOrders(testAdminSession, { approvedWith: null });
    expect(await screen.findByText("VO-0002")).toBeInTheDocument();
    expect(screen.getAllByText("111,000.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("مسودة").length).toBeGreaterThan(0);
  });

  it("sends the approval date the approver typed, not today", async () => {
    const calls: Calls = { approvedWith: null };
    renderVariationOrders(testAdminSession, calls);
    fireEvent.click(await screen.findByText("VO-0002"));
    const decision = (await screen.findByText("قرار الاعتماد")).closest("div") as HTMLElement;
    const input = within(decision).getByText("تاريخ الاعتماد").parentElement?.querySelector("input");
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, { target: { value: "2026-08-02" } });
    fireEvent.click(within(decision).getByRole("button", { name: "اعتماد" }));
    await waitFor(() => expect(calls.approvedWith).toBe("2026-08-02"));
  });

  it("offers no approve or reject control to someone without contracting.variation.approve", async () => {
    renderVariationOrders(
      { ...testAdminSession, isCompanyAdmin: false, permissions: ["contracting.boq.manage"] },
      { approvedWith: null },
    );
    fireEvent.click(await screen.findByText("VO-0002"));
    expect(await screen.findByRole("heading", { name: /VO-0002/ })).toBeInTheDocument();
    const main = screen.getByRole("heading", { name: /VO-0002/ }).closest("div")?.parentElement as HTMLElement;
    expect(within(main).queryByRole("button", { name: "اعتماد" })).not.toBeInTheDocument();
    expect(within(main).queryByRole("button", { name: "رفض" })).not.toBeInTheDocument();
  });
});
