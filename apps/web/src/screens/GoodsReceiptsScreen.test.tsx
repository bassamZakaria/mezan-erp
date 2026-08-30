// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BranchDTO, GoodsReceiptDTO, ItemDTO, PurchaseOrderDTO, SupplierDTO, WarehouseDTO } from "@mezan/contracts";
import { GoodsReceiptsScreen } from "./GoodsReceiptsScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import { NavigationProvider } from "../navigation";
import type { Transport } from "../data/transport";

// jsdom has no layout engine and does not implement scrollIntoView; the
// custom Select combobox calls it when opening its dropdown.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * The create/detail views are sub-pages addressed via `useSubPage()`
 * (navigation.tsx). Same in-memory stand-in used by purchases-screens.test.tsx.
 */
function TestNavigation({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
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

/** Selects an option from an `EntityPicker` combobox and asserts the real entity id lands in the outgoing request, not free text. */
function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

const suppliers: SupplierDTO[] = [
  {
    id: "sup-1", code: "S1", nameAr: "شركة النيل للتوريدات", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null,
  },
];

const items: ItemDTO[] = [
  {
    id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const warehouses: WarehouseDTO[] = [
  { id: "MAIN-WH", code: "MAIN-WH", name: "المخزن الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true },
];

function purchaseOrder(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "po-1",
    number: "PO-000005",
    supplierId: "sup-1",
    date: "2026-08-18",
    expectedDeliveryDate: "2026-08-25",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: null,
    lines: [{ itemId: "item-cement", description: null, qty: "50.000000", unitPrice: "85.000000", receivedQty: "0.000000" }],
    status: "sent",
    subtotal: "4250.000000",
    total: "4250.000000",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-18T09:00:00.000Z",
    ...overrides,
  };
}

function goodsReceipt(overrides: Partial<GoodsReceiptDTO> = {}): GoodsReceiptDTO {
  return {
    id: "gr-1",
    number: "GR-000010",
    purchaseOrderId: "po-9",
    supplierId: "sup-1",
    warehouseId: "MAIN-WH",
    date: "2026-08-19",
    notes: null,
    lines: [{ itemId: "item-cement", description: null, qty: "20.000000", unitCost: "85.000000", batchNo: null, expiryDate: null }],
    status: "confirmed",
    invoiced: false,
    totalCost: "1700.000000",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

/** Every fixture handler the screen's other data hooks need, so a test can override just the one endpoint it cares about. */
const baseHandlers: Record<string, (init: RequestInit | undefined, path: string) => StubResult> = {
  "GET /purchases/orders": () => ({ body: [] }),
  "GET /suppliers": () => ({ body: suppliers }),
  "GET /items": () => ({ body: items }),
  "GET /branches": () => ({ body: branches }),
  "GET /warehouses": () => ({ body: warehouses }),
  "GET /users": () => ({ body: [] }),
};

function renderScreen(transport: Transport) {
  return renderWithProviders(
    <TestNavigation>
      <GoodsReceiptsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("GoodsReceiptsScreen", () => {
  it("renders rows from the server's exact list request, with money and qty formatted (never a raw decimal string)", async () => {
    const paths: string[] = [];
    const base = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ body: [goodsReceipt()] }),
    });
    const transport: Transport = (path, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "GET" && path.split("?")[0] === "/purchases/receipts") paths.push(path);
      return base(path, init);
    };
    renderScreen(transport);

    expect(await screen.findByText("GR-000010")).toBeInTheDocument();
    expect(paths).toContain("/purchases/receipts");
    // Row total: 1700.000000 formatted as money, not the raw wire string.
    expect(screen.getByText("1,700.00")).toBeInTheDocument();
    expect(screen.queryByText("1700.000000")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("GR-000010"));
    // Line qty/unit-cost/total: "20.000000"/"85.000000" formatted, not raw.
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.queryByText("20.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText("85.00")).not.toHaveLength(0);
    expect(screen.queryByText("85.000000")).not.toBeInTheDocument();
  });

  it("shows an honest empty state when the server returns no receipts", async () => {
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ body: [] }),
    });
    renderScreen(transport);

    expect(await screen.findByText("لا توجد إيصالات استلام مطابقة")).toBeInTheDocument();
    expect(screen.getByText("سجّل إذن استلام لإدخال البضاعة إلى المستودع قبل استلام فاتورة المورد.")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل إيصالات الاستلام.")).not.toBeInTheDocument();
  });

  it("renders an Arabic load-failed banner instead of the raw server error", async () => {
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ status: 500, body: { error: "INTERNAL" } }),
    });
    renderScreen(transport);

    expect(await screen.findByText("تعذّر تحميل إيصالات الاستلام.")).toBeInTheDocument();
    expect(screen.queryByText(/INTERNAL/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/internal/i);
  });

  it("sends the status chip, search text, warehouse and supplier filters to the server as distinct query params", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    const base = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ body: [goodsReceipt()] }),
      // A status chip with a zero count is hidden (ListViews.tsx) — give the
      // "مؤكد" chip a nonzero count so it renders and can be clicked.
      "GET /purchases/receipts/counts": () => ({ body: { all: 1, confirmed: 1 } }),
    });
    const transport: Transport = (path, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "GET" && path.split("?")[0] === "/purchases/receipts") paths.push(path);
      return base(path, init);
    };
    renderScreen(transport);
    await screen.findByText("GR-000010");

    fireEvent.click(screen.getByRole("tab", { name: /^مؤكد/ }));
    await waitFor(() => expect(paths.some((p) => p.includes("status=confirmed"))).toBe(true));

    await user.type(screen.getByPlaceholderText("بحث برقم الإيصال أو المورد…"), "GR-9");
    await waitFor(() => expect(paths.some((p) => p.includes("search=GR-9"))).toBe(true), { timeout: 3000 });

    await user.click(screen.getByLabelText("المستودع"));
    await user.click(await screen.findByRole("option", { name: "المخزن الرئيسي" }));
    await waitFor(() => expect(paths.some((p) => p.includes("warehouseId=MAIN-WH"))).toBe(true));

    await user.click(screen.getByLabelText("المورد"));
    await user.click(await screen.findByRole("option", { name: /شركة النيل للتوريدات/ }));
    await waitFor(() => expect(paths.some((p) => p.includes("supplierId=sup-1"))).toBe(true));
  });

  it("posts a direct (ad-hoc) receipt with real supplier/warehouse/item ids from the pickers when the require-PO policy is off", async () => {
    let posted: Record<string, unknown> | null = null;
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ body: [] }),
      "GET /settings": () => ({ body: { requirePoForGrn: false } }),
      "POST /purchases/receipts": (init) => {
        posted = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        return { body: goodsReceipt({ id: "gr-new", number: "GR-000099", purchaseOrderId: null, invoiced: false }) };
      },
    });
    renderScreen(transport);

    await screen.findByText("لا توجد إيصالات استلام مطابقة");
    // The empty state's own action button carries the same label as the
    // header's — either opens the same create sub-page.
    fireEvent.click(screen.getAllByRole("button", { name: "إيصال استلام جديد" })[0]!);

    const adHocButton = await screen.findByRole("button", { name: /استلام مباشر/ });
    // Disabled until `useSettings()` resolves and confirms the policy is off.
    await waitFor(() => expect(adHocButton).not.toBeDisabled());
    fireEvent.click(adHocButton);
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));

    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("المستودع *"));
    await user.click(await screen.findByRole("option", { name: "المخزن الرئيسي" }));

    pickFromCombobox(document.body, "الصنف", "أسمنت بورتلاندي");

    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      supplierId: "sup-1",
      warehouseId: "MAIN-WH",
      lines: [{ itemId: "item-cement", qty: "1", unitCost: "85", batchNo: null, expiryDate: null }],
    });
    // The list re-appears — the sub-page closed on a successful save.
    expect(await screen.findByRole("heading", { name: "إيصالات الاستلام" })).toBeInTheDocument();
  });

  it("shows the Arabic message when the server refuses to create a receipt", async () => {
    const order = purchaseOrder();
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ body: [] }),
      "GET /purchases/orders": () => ({ body: [order] }),
      "POST /purchases/receipts": () => ({
        status: 409,
        body: { error: "PO_ALREADY_CLOSED", message: "تعذر الاستلام: أمر الشراء مغلق بالفعل" },
      }),
    });
    renderScreen(transport);

    await screen.findByText("لا توجد إيصالات استلام مطابقة");
    fireEvent.click(screen.getAllByRole("button", { name: "إيصال استلام جديد" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));

    pickFromCombobox(document.body, "أمر الشراء *", order.number);
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تعذر الاستلام: أمر الشراء مغلق بالفعل");
    expect(screen.queryByText("PO_ALREADY_CLOSED")).not.toBeInTheDocument();
  });
});
