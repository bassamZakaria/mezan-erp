// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BranchDTO, ItemDTO, PurchaseOrderDTO, SupplierDTO, UserDTO, WarehouseDTO } from "@mezan/contracts";
import { PurchaseOrdersScreen } from "./PurchaseOrdersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/** Same stand-in as purchases-screens.test.tsx: `useSubPage()` needs a real `NavigationProvider`. */
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

function fieldInput(container: HTMLElement, labelText: string): HTMLElement {
  const label = within(container).getByText(labelText);
  const input = label.parentElement?.querySelector("input");
  if (!input) throw new Error(`no input found next to label "${labelText}"`);
  return input;
}

function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (n) => n.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];
const warehouses: WarehouseDTO[] = [
  { id: "MAIN-WH", code: "MAIN-WH", name: "المخزن الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true },
];
const suppliers: SupplierDTO[] = [
  { id: "sup-1", code: "S1", nameAr: "شركة النيل للتوريدات", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null },
];
const items: ItemDTO[] = [
  { id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active" },
];
const users: UserDTO[] = [
  {
    id: "USER-ADMIN",
    nameAr: "محمد الشهابي",
    nameEn: null,
    email: "admin@cyag.example",
    phone: null,
    hasPin: false,
    roleId: null,
    isCompanyAdmin: true,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: "active",
    photoUrl: null,
    lastLoginAt: null,
    createdAt: "2026-08-08T00:00:00.000Z",
  },
];

function purchaseOrder(overrides: Partial<PurchaseOrderDTO> = {}): PurchaseOrderDTO {
  return {
    id: "po-1",
    number: "PO-000003",
    supplierId: "sup-1",
    date: "2026-08-18",
    expectedDeliveryDate: "2026-08-25",
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: null,
    lines: [{ itemId: "item-cement", description: null, qty: "200.000000", unitPrice: "85.000000", receivedQty: "0.000000" }],
    status: "draft",
    subtotal: "17000.000000",
    total: "17000.000000",
    createdBy: "USER-ADMIN",
    createdAt: "2026-08-18T09:00:00.000Z",
    ...overrides,
  };
}

function renderScreen(orders: PurchaseOrderDTO[] = [purchaseOrder()], extra: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> = {}) {
  let current = [...orders];
  let lastListPath = "";
  let lastCreateBody: unknown = null;
  const transport = stubTransport({
    "GET /branches": () => ({ body: branches }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /suppliers": () => ({ body: suppliers }),
    "GET /items": () => ({ body: items }),
    "GET /users": () => ({ body: users }),
    "GET /purchases/orders": (_init, path) => {
      lastListPath = path;
      return { body: current };
    },
    "GET /purchases/orders/counts": () => ({
      body: { all: current.length, draft: current.filter((o) => o.status === "draft").length, sent: current.filter((o) => o.status === "sent").length, partially_received: 0, fully_received: 0, cancelled: 0 },
    }),
    "GET /purchases/orders/stats": () => ({
      body: { count: current.length, sent: current.filter((o) => o.status === "sent").length, value: current.reduce((s, o) => s + Number(o.subtotal), 0).toFixed(6), received: 0 },
    }),
    "POST /purchases/orders": (init) => {
      lastCreateBody = JSON.parse((init?.body as string) ?? "{}");
      const body = lastCreateBody as Partial<PurchaseOrderDTO>;
      const created = purchaseOrder({ id: "po-new", number: "PO-000004", subtotal: "0", total: "0", ...body });
      current = [...current, created];
      return { body: created };
    },
    ...extra,
  });
  const result = renderWithProviders(
    <TestNavigation>
      <PurchaseOrdersScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
  return { ...result, getListPath: () => lastListPath, getCreateBody: () => lastCreateBody };
}

describe("PurchaseOrdersScreen (filters, stats, entity ids, save-guard)", () => {
  it("the branch/warehouse/supplier filters and date range each change the outgoing list request", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    const { getListPath } = renderScreen();
    await screen.findByText("PO-000003");

    await user.click(screen.getByRole("combobox", { name: "الفرع" }));
    await user.click(await screen.findByRole("option", { name: "الفرع الرئيسي" }));
    await waitFor(() => expect(getListPath()).toContain("branchId=MAIN"));

    await user.click(screen.getByRole("combobox", { name: "المستودع" }));
    await user.click(await screen.findByRole("option", { name: "المخزن الرئيسي" }));
    await waitFor(() => expect(getListPath()).toContain("warehouseId=MAIN-WH"));

    await user.click(screen.getByRole("combobox", { name: "المورد" }));
    await user.click(await screen.findByRole("option", { name: "شركة النيل للتوريدات" }));
    await waitFor(() => expect(getListPath()).toContain("supplierId=sup-1"));

    fireEvent.change(fieldInput(document.body, "من تاريخ"), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(getListPath()).toContain("fromDate=2026-08-01"));
    fireEvent.change(fieldInput(document.body, "إلى تاريخ"), { target: { value: "2026-08-31" } });
    await waitFor(() => expect(getListPath()).toContain("toDate=2026-08-31"));

    fireEvent.change(screen.getByPlaceholderText(/بحث/), { target: { value: "PO-0000" } });
    await waitFor(() => expect(getListPath()).toContain("search=PO-0000"));
  });

  it("status chips change the outgoing status filter", async () => {
    // A zero-count chip is hidden entirely (ListViews), so "sent" needs a real sent order to even render.
    const { getListPath } = renderScreen([purchaseOrder(), purchaseOrder({ id: "po-2", number: "PO-000002", status: "sent" })]);
    await screen.findByText("PO-000003");
    fireEvent.click(screen.getByRole("tab", { name: /^مرسل/ }));
    await waitFor(() => expect(getListPath()).toContain("status=sent"));
  });

  it("the KPI strip renders Money-formatted values from the /stats endpoint, never a raw scaled-decimal string", async () => {
    renderScreen([purchaseOrder({ subtotal: "17000.000000", total: "17000.000000" })]);
    await screen.findByText("PO-000003");
    expect(screen.queryByText("17000.000000")).not.toBeInTheDocument();
    // Both the KPI strip and the table's "total" column render the same formatted figure.
    expect(screen.getAllByText((_, el) => el?.textContent === "17,000.00").length).toBeGreaterThan(0);
  });

  it("save is blocked with the Arabic no-scope error when there is no active branch/warehouse in the caller's scope", async () => {
    const transport = stubTransport({
      "GET /branches": () => ({ body: [] }),
      "GET /warehouses": () => ({ body: [] }),
      "GET /suppliers": () => ({ body: suppliers }),
      "GET /items": () => ({ body: items }),
      "GET /users": () => ({ body: users }),
      "GET /purchases/orders": () => ({ body: [] }),
      "GET /purchases/orders/counts": () => ({ body: { all: 0 } }),
      "GET /purchases/orders/stats": () => ({ body: { count: 0, sent: 0, value: "0", received: 0 } }),
    });
    renderWithProviders(
      <TestNavigation>
        <PurchaseOrdersScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    // Await, not a bare sync query: this gives the suppliers/items GETs time to
    // resolve so the EntityPickers below actually carry real options.
    fireEvent.click((await screen.findAllByRole("button", { name: "أمر شراء جديد" }))[0]!);
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    pickFromCombobox(document.body, "الصنف", "أسمنت بورتلاندي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    expect(await screen.findByText("لا يوجد فرع أو مستودع متاح ضمن صلاحياتك لإنشاء المستند.")).toBeInTheDocument();
  });

  it("creates a PO with the real picked supplier and item ids (not free text) in the POST body", async () => {
    const { getCreateBody } = renderScreen([]);
    // Await, not a bare sync query: this gives the suppliers/items GETs time to
    // resolve so the EntityPickers below actually carry real options.
    fireEvent.click((await screen.findAllByRole("button", { name: "أمر شراء جديد" }))[0]!);
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    pickFromCombobox(document.body, "الصنف", "أسمنت بورتلاندي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const body = getCreateBody() as Record<string, unknown>;
    expect(body.supplierId).toBe("sup-1");
    expect(body.branchId).toBe("MAIN");
    expect(body.warehouseId).toBe("MAIN-WH");
    const lines = body.lines as Array<Record<string, unknown>>;
    expect(lines[0]!.itemId).toBe("item-cement");
  });

  it("a server refusal on create renders the screen's Arabic formError, not raw JSON", async () => {
    renderScreen([], {
      "POST /purchases/orders": () => ({ status: 400, body: { message: "لا يمكن إنشاء أمر شراء بدون بنود" } }),
    });
    // Await, not a bare sync query: this gives the suppliers/items GETs time to
    // resolve so the EntityPickers below actually carry real options.
    fireEvent.click((await screen.findAllByRole("button", { name: "أمر شراء جديد" }))[0]!);
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    pickFromCombobox(document.body, "الصنف", "أسمنت بورتلاندي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    expect(await screen.findByText("لا يمكن إنشاء أمر شراء بدون بنود")).toBeInTheDocument();
  });
});
