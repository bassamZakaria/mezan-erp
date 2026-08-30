// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import type { ItemDTO } from "@mezan/contracts";
import { BomsScreen } from "./BomsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";
import type { BomRecord } from "../data/hooks";

/** Type into an EntityPicker combobox and pick the matching option — selection
 * fires on `onMouseDown` (not `click`), so the input's blur never wins the race. */
function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

/**
 * The create form is a sub-page addressed via `useSubPage()`, which reads
 * from `NavigationContext` — there is no router wired up outside `AppLayout`,
 * so a test that opens it needs its own stateful provider (the same pattern
 * ProductTemplatesScreen.test.tsx and PurchaseReturnsScreen.test.tsx use).
 */
function WithSubPageNav({ children }: { children: ReactElement }) {
  const [segments, setSegments] = useState<string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: (next) => setSegments([...next]),
        openScreenAt: () => {},
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

function item(overrides: Partial<ItemDTO> = {}): ItemDTO {
  return {
    id: "item-wood",
    code: "ITM-1",
    nameAr: "لوح خشب",
    nameEn: null,
    type: "stock",
    baseUnitCode: "PCS",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: "120.00",
    taxRatePercent: 0,
    trackInventory: true,
    trackBatches: false,
    trackExpiry: false,
    reorderPoint: null,
    imageAttachmentId: null,
    reorderQty: null,
    revenueAccountId: null,
    cogsAccountId: null,
    inventoryAccountId: null,
    etaCodeType: null,
    etaItemCode: null,
    gpcCode: null,
    status: "active",
    ...overrides,
  };
}

const items: ItemDTO[] = [item(), item({ id: "item-table", code: "ITM-2", nameAr: "طاولة خشبية", costPrice: null })];

function bom(overrides: Partial<BomRecord> = {}): BomRecord {
  return {
    id: "bom-1",
    number: "BOM-0001",
    productItemId: "item-table",
    version: 1,
    standardQty: "1",
    unit: "PCS",
    laborCost: "50",
    overheadCost: "30",
    versionNotes: null,
    lines: [{ itemId: "item-wood", qty: "4", wastePercent: 5, optional: false, notes: null }],
    status: "active",
    custom: false,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-01T08:00:00.000Z",
    estimate: { materialCost: "504.00", laborCost: "50.00", overheadCost: "30.00", totalCost: "584.00", unitCost: "584.00" },
    ...overrides,
  };
}

function renderScreen(boms: BomRecord[] = [bom()]) {
  let current = [...boms];
  const transport = stubTransport({
    "GET /manufacturing/boms": () => ({ body: current }),
    "GET /items": () => ({ body: items }),
    "POST /manufacturing/boms": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: BomRecord = {
        id: body.id,
        number: "BOM-0002",
        productItemId: body.productItemId,
        version: 1,
        standardQty: body.standardQty,
        unit: body.unit,
        laborCost: body.laborCost,
        overheadCost: body.overheadCost,
        versionNotes: body.versionNotes ?? null,
        lines: body.lines.map((l: { itemId: string; qty: string; wastePercent?: number }) => ({
          itemId: l.itemId,
          qty: l.qty,
          wastePercent: l.wastePercent ?? 0,
          optional: false,
          notes: null,
        })),
        status: "active",
        custom: false,
        createdBy: "USER-ADMIN",
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(
    <WithSubPageNav>
      <BomsScreen />
    </WithSubPageNav>,
    { transport, initialSession: testAdminSession },
  );
}

describe("BomsScreen", () => {
  it("shows an empty state when there are no BOMs yet", async () => {
    renderScreen([]);
    expect(screen.getByRole("heading", { name: "قوائم المواد" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد قوائم مواد مطابقة — أنشئ قائمة جديدة")).toBeInTheDocument();
  });

  it("lists BOMs from the real backend", async () => {
    renderScreen();
    expect(await screen.findByText("BOM-0001")).toBeInTheDocument();
    expect(screen.getByText("طاولة خشبية")).toBeInTheDocument();
  });

  it("shows a retry banner when the list fails to load", async () => {
    const transport = stubTransport({
      "GET /manufacturing/boms": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /items": () => ({ body: items }),
    });
    renderWithProviders(
      <WithSubPageNav>
        <BomsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByText("تعذّر تحميل قوائم المواد.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("creates a new BOM through its own sub-page and round-trips through the stubbed transport", async () => {
    renderScreen();
    await screen.findByText("BOM-0001");
    fireEvent.click(screen.getByRole("button", { name: "قائمة مواد جديدة" }));

    // the create form used to be a side-panel dialog; it is now a sub-page
    // addressed at its own URL segment (`useSubPage`), rendered as a full page.
    const heading = screen.getByRole("heading", { name: "قائمة مواد جديدة" });
    const page = heading.closest("div.w-full") as HTMLElement;
    pickFromCombobox(page, "الصنف المجمَّع *", "طاولة خشبية");
    pickFromCombobox(page, "الصنف", "لوح خشب");
    fireEvent.click(within(page).getByRole("button", { name: "حفظ قائمة المواد" }));

    expect(await screen.findByText("BOM-0002")).toBeInTheDocument();
  });
});
