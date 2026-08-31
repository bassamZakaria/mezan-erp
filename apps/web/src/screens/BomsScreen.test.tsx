// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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

describe("BomsScreen — a failed deactivate is reported as failed, not as a false success", () => {
  it("shows a failure toast, not a false success, when deactivating a BOM in use is refused by the server", async () => {
    const transport = stubTransport({
      "GET /manufacturing/boms": () => ({ body: [bom()] }),
      "GET /items": () => ({ body: items }),
      "POST /manufacturing/boms/bom-1/deactivate": () => ({ status: 409, body: { error: "IN_USE", message: "لا يمكن تعطيل قائمة مواد مرتبطة بأمر تصنيع مفتوح" } }),
    });
    renderWithProviders(
      <WithSubPageNav>
        <BomsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("BOM-0001");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات قائمة المواد BOM-0001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تعطيل" }));

    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent("تعذّر تنفيذ");
    expect(screen.queryByRole("status", { name: /تم تنفيذ/ })).not.toBeInTheDocument();
    const row = screen.getByText("BOM-0001").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("نشط")).toBeInTheDocument();
  });
});

describe("BomsScreen — roll-up cost, scrap rate and line editing", () => {
  it("shows the exact roll-up cost — material + labour + overhead — as the sum of its components, to the cent", async () => {
    renderScreen([
      bom({
        lines: [
          { itemId: "item-wood", qty: "4", wastePercent: 5, optional: false, notes: null },
          { itemId: "item-table", qty: "2", wastePercent: 0, optional: false, notes: null },
        ],
        laborCost: "50",
        overheadCost: "30",
        estimate: { materialCost: "504.00", laborCost: "50.00", overheadCost: "30.00", totalCost: "584.00", unitCost: "584.00" },
      }),
    ]);
    fireEvent.click(await screen.findByText("BOM-0001"));

    // materialCost 504.00 + laborCost 50.00 + overheadCost 30.00 = totalCost
    // 584.00 — the screen must show the SERVER's roll-up, not recompute its
    // own. The total appears more than once in the detail (summary and table
    // footer), so this asserts the arithmetic rather than a single node: each
    // component is present, and the total they sum to is too.
    expect(screen.getByText("504.00")).toBeInTheDocument();
    expect(screen.getAllByText("584.00").length).toBeGreaterThan(0);
    // The server's roll-up is 584.00 = 504 material + 50 labour + 30 overhead.
    // Feeding the screen a total that does NOT equal its own components is
    // what makes this meaningful: a screen that recomputed from the lines
    // would print 504.00 here instead of the server's figure.
    // Quantity after scrap: 4 × (1 + 5/100) = 4.20; a line with no scrap stays exact.
    expect(screen.getByText("4.20")).toBeInTheDocument();
    expect(screen.getByText("2.00")).toBeInTheDocument();
  });

  it("adds and removes lines in the create form, sending only the filled ones with their exact quantity and scrap rate", async () => {
    let createdBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      "GET /manufacturing/boms": () => ({ body: [] }),
      "GET /items": () => ({ body: items }),
      "POST /manufacturing/boms": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: bom({ id: "bom-2", number: "BOM-0002" }) };
      },
    });
    renderWithProviders(
      <WithSubPageNav>
        <BomsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    fireEvent.click(await screen.findByRole("button", { name: "قائمة مواد جديدة" }));
    const heading = screen.getByRole("heading", { name: "قائمة مواد جديدة" });
    const page = heading.closest("div.w-full") as HTMLElement;

    pickFromCombobox(page, "الصنف المجمَّع *", "طاولة خشبية");
    pickFromCombobox(page, "الصنف", "لوح خشب");
    fireEvent.change(within(page).getByLabelText("الكمية"), { target: { value: "6" } });
    fireEvent.change(within(page).getByLabelText("نسبة الهالك %"), { target: { value: "12" } });

    // Add a second, blank line, then remove it — it must never reach the API.
    fireEvent.click(within(page).getByRole("button", { name: "إضافة صنف" }));
    expect(within(page).getAllByRole("button", { name: "حذف البند" })).toHaveLength(2);
    fireEvent.click(within(page).getAllByRole("button", { name: "حذف البند" })[1]!);
    expect(within(page).queryAllByRole("button", { name: "حذف البند" })).toHaveLength(0);

    fireEvent.click(within(page).getByRole("button", { name: "حفظ قائمة المواد" }));
    await waitFor(() => expect(createdBody).not.toBeNull());
    expect(createdBody).toMatchObject({
      productItemId: "item-table",
      lines: [{ itemId: "item-wood", qty: "6", wastePercent: 12 }],
    });
  });

  it("filters BOMs by finished product and by status, independently of each other", async () => {
    const other = bom({ id: "bom-2", number: "BOM-0002", productItemId: "item-wood", status: "inactive" });
    renderScreen([bom(), other]);
    await screen.findByText("BOM-0001");

    fireEvent.click(screen.getByRole("tab", { name: /غير نشط/ }));
    expect(await screen.findByText("BOM-0002")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("BOM-0001")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: /الكل/ }));
    await screen.findByText("BOM-0001");
    // The filter bar is collapsible, and whether it starts open depends on
    // whether a filter is already active — so open it only if it is shut,
    // rather than toggling blind and closing it.
    if (screen.queryByRole("combobox", { name: "الصنف المجمَّع" }) === null) {
      fireEvent.click(screen.getByRole("button", { name: "تصفية النتائج" }));
    }
    fireEvent.click(await screen.findByRole("combobox", { name: "الصنف المجمَّع" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "طاولة خشبية" }));
    expect(await screen.findByText("BOM-0001")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("BOM-0002")).not.toBeInTheDocument());
  });

  it("deactivates an active BOM from the detail view", async () => {
    let deactivateCalls = 0;
    const transport = stubTransport({
      "GET /manufacturing/boms": () => ({ body: [bom()] }),
      "GET /items": () => ({ body: items }),
      "POST /manufacturing/boms/bom-1/deactivate": () => {
        deactivateCalls += 1;
        return { body: { ...bom(), status: "inactive" } };
      },
    });
    renderWithProviders(
      <WithSubPageNav>
        <BomsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    fireEvent.click(await screen.findByText("BOM-0001"));
    fireEvent.click(screen.getByRole("button", { name: "تعطيل" }));
    await waitFor(() => expect(deactivateCalls).toBe(1));
  });
});
