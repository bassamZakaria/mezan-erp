// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor} from "@testing-library/react";
import type { ItemSpecificationDTO, ListCountsDTO, ProductTemplateDTO } from "@mezan/contracts";
import type { BomRecord, ConfigurableProductRecord } from "../../data/hooks";
import { ItemsHubScreen } from "./ItemsHubScreen";
import { NavigationProvider } from "../../navigation";
import type { Transport } from "../../data/transport";
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

const sampleCounts: ListCountsDTO = { all: 40, active: 35, "type:stock": 20, "type:service": 5 };

const sampleTemplates: ProductTemplateDTO[] = [
  {
    id: "TPL-1",
    code: "T-0001",
    nameAr: "قالب قميص",
    nameEn: null,
    baseUnitCode: "PCE",
    categoryId: null,
    brandId: null,
    costingMethod: "WAC",
    defaultSalePrice: null,
    defaultCost: null,
    taxRatePercent: 0,
    attributes: [],
    status: "active",
  },
];

const sampleConfigurable = [{ id: "CFG-1" }] as unknown as ConfigurableProductRecord[];
const sampleSpecifications = [{ code: "COLOR" }, { code: "SIZE" }, { code: "MATERIAL" }] as unknown as ItemSpecificationDTO[];
const sampleBoms = [{ id: "BOM-1" }] as unknown as BomRecord[];

function baseTransport(overrides: Record<string, () => { status?: number; body: unknown }> = {}) {
  return stubTransport({
    "GET /items/counts": () => ({ body: sampleCounts }),
    "GET /inventory/product-templates": () => ({ body: sampleTemplates }),
    "GET /manufacturing/configurable-products": () => ({ body: sampleConfigurable }),
    "GET /item-specifications": () => ({ body: sampleSpecifications }),
    "GET /manufacturing/boms": () => ({ body: sampleBoms }),
    ...overrides,
  });
}

function renderScreen(navigate: (screen: string, intent?: unknown) => void = vi.fn(), overrides?: Record<string, () => { status?: number; body: unknown }>) {
  const transport = baseTransport(overrides);
  return renderWithProviders(
    <TestNavigation navigate={navigate}>
      <ItemsHubScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("ItemsHubScreen", () => {
  it("renders stat tiles from the real item-counts endpoint", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الأصناف" })).toBeInTheDocument();
    expect(await screen.findByText("40")).toBeInTheDocument();
    expect(await screen.findByText("35")).toBeInTheDocument();
    expect(await screen.findByText("20")).toBeInTheDocument();
    expect(await screen.findByText("5")).toBeInTheDocument();
  });

  it("renders one catalogue card per source with its live count", async () => {
    renderScreen();
    expect(await screen.findByText("قوالب المنتجات")).toBeInTheDocument();
    expect(await screen.findByText("منتجات قابلة للتهيئة")).toBeInTheDocument();
    expect(await screen.findByText("المواصفات")).toBeInTheDocument();
    expect(await screen.findByText("قوائم المواد")).toBeInTheDocument();
    // templates=1, configurable=1, boms=1 all share a count of "1"; specifications=3 is distinct.
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect((await screen.findAllByText("1")).length).toBeGreaterThanOrEqual(3);
  });

  it("shows an em dash on a card whose count is still loading, never a false zero", async () => {
    const inner = baseTransport();
    const stallingTransport: Transport = (path, init) => {
      if (path.split("?")[0] === "/inventory/product-templates") return new Promise(() => {});
      return inner(path, init);
    };
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <ItemsHubScreen />
      </TestNavigation>,
      { transport: stallingTransport, initialSession: testAdminSession },
    );
    await screen.findByText("قوالب المنتجات");
    const card = screen.getByText("قوالب المنتجات").closest("button");
    expect(card).not.toBeNull();
    expect(card).toHaveTextContent("—");
  });

  it("navigates to the source screen when a catalogue card is clicked", async () => {
    const navigate = vi.fn();
    renderScreen(navigate);
    fireEvent.click(await screen.findByText("قوائم المواد"));
    expect(navigate).toHaveBeenCalledWith("boms");
  });

  it("never downloads the item catalogue: every figure comes from the counts", async () => {
    const asked: string[] = [];
    const inner = baseTransport();
    renderWithProviders(
      <TestNavigation navigate={vi.fn()}>
        <ItemsHubScreen />
      </TestNavigation>,
      { transport: (path, init) => (asked.push(path.split("?")[0]!), inner(path, init)), initialSession: testAdminSession },
    );
    expect(await screen.findByText("40")).toBeInTheDocument();
    expect(asked).not.toContain("/items");
  });

  it("shows the Arabic error message when a query fails", async () => {
    renderScreen(vi.fn(), { "GET /items/counts": () => ({ status: 500, body: { error: "INTERNAL" } }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("تعذّر تحميل بيانات الأصناف.");
    await waitFor(() => expect(screen.queryByText("INTERNAL")).not.toBeInTheDocument());
  });
});
