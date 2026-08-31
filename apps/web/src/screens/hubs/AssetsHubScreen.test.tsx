// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor} from "@testing-library/react";
import type { AssetCategoryDTO, AssetDTO, DepreciationRunDTO } from "@mezan/contracts";
import { AssetsHubScreen } from "./AssetsHubScreen";
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

const sampleCategories: AssetCategoryDTO[] = [
  {
    id: "CAT-1",
    code: "VEH",
    nameAr: "مركبات",
    nameEn: null,
    defaultDepreciationMethod: "straight_line",
    defaultUsefulLifeMonths: 60,
    defaultSalvagePercent: 10,
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    gainOnDisposalAccountId: null,
    lossOnDisposalAccountId: null,
    active: true,
  },
];

const sampleAssets: AssetDTO[] = [
  {
    id: "AST-1",
    code: "A-0001",
    nameAr: "سيارة توصيل",
    nameEn: null,
    categoryId: "CAT-1",
    scope: "general",
    branchId: null,
    warehouseId: null,
    acquisitionDate: "2025-01-01",
    acquisitionCost: "100000",
    depreciationStartDate: "2025-01-01",
    depreciationMethod: "straight_line",
    usefulLifeMonths: 60,
    salvageValue: "10000",
    accumulatedDepreciation: "20000",
    status: "active",
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    notes: null,
  },
  {
    id: "AST-2",
    code: "A-0002",
    nameAr: "معدات مكتبية",
    nameEn: null,
    categoryId: "CAT-1",
    scope: "general",
    branchId: null,
    warehouseId: null,
    acquisitionDate: "2024-01-01",
    acquisitionCost: "5000",
    depreciationStartDate: "2024-01-01",
    depreciationMethod: "straight_line",
    usefulLifeMonths: 36,
    salvageValue: "0",
    accumulatedDepreciation: "5000",
    status: "fully_depreciated",
    assetAccountId: null,
    depreciationExpenseAccountId: null,
    accumulatedDepreciationAccountId: null,
    notes: null,
  },
];

const sampleRuns: DepreciationRunDTO[] = [
  {
    id: "RUN-1",
    period: "2026-07",
    branchId: null,
    status: "posted",
    lines: [],
    totalAmount: "1500",
    journalEntryId: "JE-9",
    createdAt: "2026-07-31T00:00:00.000Z",
    postedAt: "2026-07-31T00:00:00.000Z",
  },
];

function baseTransport(overrides: Record<string, () => { status?: number; body: unknown }> = {}) {
  return stubTransport({
    "GET /assets": () => ({ body: sampleAssets }),
    "GET /assets/categories": () => ({ body: sampleCategories }),
    "GET /assets/depreciation/runs": () => ({ body: sampleRuns }),
    ...overrides,
  });
}

function renderScreen(navigate: (screen: string, intent?: unknown) => void = vi.fn(), overrides?: Record<string, () => { status?: number; body: unknown }>) {
  const transport = baseTransport(overrides);
  return renderWithProviders(
    <TestNavigation navigate={navigate}>
      <AssetsHubScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("AssetsHubScreen", () => {
  it("renders stat tiles with real counts and money totals", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الأصول" })).toBeInTheDocument();
    expect(await screen.findByText("2")).toBeInTheDocument(); // total assets
    expect(await screen.findByText("1")).toBeInTheDocument(); // active assets
    expect(await screen.findByText("105,000.00")).toBeInTheDocument(); // total acquisition cost
    expect(await screen.findByText("25,000.00")).toBeInTheDocument(); // total accumulated depreciation
  });

  it("renders the latest depreciation runs list with the run's total", async () => {
    renderScreen();
    expect(await screen.findByText("2026-07")).toBeInTheDocument();
    expect(await screen.findByText("مرحّل")).toBeInTheDocument();
    expect(await screen.findByText("1,500.00")).toBeInTheDocument();
  });

  it("shows the configured empty state when there are no depreciation runs", async () => {
    renderScreen(vi.fn(), { "GET /assets/depreciation/runs": () => ({ body: [] }) });
    expect(await screen.findByText("لا توجد عمليات إهلاك بعد — ستظهر هنا فور تشغيل أول عملية.")).toBeInTheDocument();
  });

  it("shows the Arabic error message when a query fails", async () => {
    renderScreen(vi.fn(), { "GET /assets": () => ({ status: 500, body: { error: "INTERNAL" } }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل بيانات الأصول.");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });

  it("renders both quick actions and navigates on click", async () => {
    const navigate = vi.fn();
    renderScreen(navigate);
    fireEvent.click(await screen.findByRole("button", { name: "أصل جديد" }));
    expect(navigate).toHaveBeenCalledWith("asset-register", "create");
    fireEvent.click(screen.getByRole("button", { name: "تشغيل إهلاك جديد" }));
    expect(navigate).toHaveBeenCalledWith("depreciation-runs", "create");
  });
});
