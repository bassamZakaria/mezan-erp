// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CustomerDTO, ItemDTO, WarehouseDTO } from "@mezan/contracts";
import { ConfigInstancesScreen } from "./ConfigInstancesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { ConfigInstanceRecord, ConfigInstancePreviewResult, ConfigurableProductRecord } from "../data/hooks";

/** Type into an EntityPicker combobox and pick the matching option — selection
 * fires on `onMouseDown` (not `click`), so the input's blur never wins the race. */
function pickFromCombobox(dialog: HTMLElement, label: string, optionLabel: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(dialog).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

/**
 * settings/form-controls.tsx's `TextField` renders a `<label>` without a
 * `for`/`id`, so it has no programmatic association with its `<input>` —
 * `getByLabelText` cannot find it (the spec fields here are TextField, unlike
 * the EntityPicker fields above which do wire a real `for`/`id`). Falls back
 * to the DOM adjacency the visible label still has to the control.
 */
function inputNextToLabel(container: HTMLElement, labelText: string): HTMLElement {
  const label = within(container).getByText(labelText);
  const input = label.parentElement?.querySelector("input, textarea");
  if (!(input instanceof HTMLElement)) {
    throw new Error(`No form control found next to the label "${labelText}"`);
  }
  return input;
}

const items: ItemDTO[] = [
  {
    id: "item-glass",
    code: "ITM-1",
    nameAr: "زجاج (م²)",
    nameEn: null,
    type: "stock",
    baseUnitCode: "M2",
    alternateUnits: [],
    barcodes: [],
    categoryId: null,
    brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
    costingMethod: "WAC",
    salePrice: null,
    costPrice: "85.00",
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
  },
];

const customers: CustomerDTO[] = [
  {
    id: "cust-1",
    code: "C1",
    nameAr: "شركة الأمل للتجارة",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "0",
    active: true,
    priceListId: null,
    creditLimit: "0",
    taxExempt: false,
    etaBuyerType: "auto",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
  },
];

const warehouses: WarehouseDTO[] = [
  { id: "wh-raw", code: "RAW-WH", name: "مستودع الخامات", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: false, active: true },
  { id: "wh-fg", code: "FG-WH", name: "مستودع المنتجات التامة", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: false, active: true },
  // the WIP warehouse field defaults from the shop's PRODUCTION-type warehouse.
  { id: "wh-wip", code: "WIP-WH", name: "مستودع التشغيل", nameEn: null, branchId: "MAIN", type: "PRODUCTION", isDefault: false, active: true },
];

const products: ConfigurableProductRecord[] = [
  {
    id: "cp-1",
    code: "WINDOW",
    nameAr: "نافذة قابلة للتهيئة",
    nameEn: null,
    outputItemId: "item-glass",
    unit: "PCS",
    description: null,
    inputs: [{ id: "width", labelAr: "العرض", labelEn: null, type: "number", min: null, max: null }],
    materials: [{ itemId: "item-glass", qtyFormula: "width/100", wastePercent: 5 }],
    pricingMethod: "manual",
    priceFormula: null,
    laborFormula: null,
    overheadFormula: null,
    itemPolicy: "per_spec",
    status: "active",
    createdBy: "محمد الشهابي",
    createdAt: "2026-07-01T08:00:00.000Z",
  },
];

function instance(overrides: Partial<ConfigInstanceRecord> = {}): ConfigInstanceRecord {
  return {
    id: "ci-1",
    number: "CM-000001",
    configurableProductId: "cp-1",
    productNameAr: "نافذة قابلة للتهيئة",
    outputItemId: "item-glass",
    spec: { width: "120" },
    qty: "2",
    customerId: "cust-1",
    sellUnitPrice: "630.00",
    sellTotal: "1260.00",
    notes: null,
    status: "configured",
    bomId: "ci-1:bom",
    workOrderId: "ci-1:wo",
    materials: [{ itemId: "item-glass", qtyPerUnit: "1.2", wastePercent: 5, lineCost: "102.00" }],
    materialCostPerUnit: "102.00",
    laborCostPerUnit: "0",
    overheadCostPerUnit: "0",
    estimatedUnitCost: "102.00",
    actualCost: null,
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-12T08:00:00.000Z",
    ...overrides,
  };
}

const previewResult: ConfigInstancePreviewResult = {
  materials: [{ itemId: "item-glass", qtyPerUnit: "1.5", effectiveQtyPerUnit: "1.575", wastePercent: 5, unitCost: "85.00", lineCost: "133.88" }],
  materialCostPerUnit: "133.88",
  laborCostPerUnit: "0",
  overheadCostPerUnit: "0",
  unitPrice: null,
};

function renderScreen(instances: ConfigInstanceRecord[] = [instance()]) {
  let current = [...instances];
  const transport = stubTransport({
    "GET /manufacturing/config-instances": () => ({ body: current }),
    "GET /manufacturing/configurable-products": () => ({ body: products }),
    "GET /items": () => ({ body: items }),
    "GET /customers": () => ({ body: customers }),
    "GET /warehouses": () => ({ body: warehouses }),
    "POST /manufacturing/config-instances/preview": () => ({ body: previewResult }),
    "POST /manufacturing/config-instances": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: ConfigInstanceRecord = {
        id: body.id,
        number: "CM-000002",
        configurableProductId: body.configurableProductId,
        productNameAr: "نافذة قابلة للتهيئة",
        outputItemId: "item-glass",
        spec: body.spec,
        qty: body.qty,
        customerId: body.customerId ?? null,
        sellUnitPrice: body.sellUnitPrice ?? null,
        sellTotal: "0.00",
        notes: body.notes ?? null,
        status: "configured",
        bomId: "ci-2:bom",
        workOrderId: "ci-2:wo",
        materials: [],
        materialCostPerUnit: "0",
        laborCostPerUnit: "0",
        overheadCostPerUnit: "0",
        estimatedUnitCost: "0",
        actualCost: null,
        createdBy: "USER-ADMIN",
        createdAt: "2026-08-21T00:00:00.000Z",
      };
      current = [...current, created];
      return { status: 201, body: created };
    },
  });
  return renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
}

describe("ConfigInstancesScreen", () => {
  it("shows an empty state when there are no custom manufacturing orders yet", async () => {
    renderScreen([]);
    expect(screen.getByRole("heading", { name: "التصنيع المخصص" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد أوامر تصنيع مخصص — أنشئ أمراً جديداً")).toBeInTheDocument();
  });

  it("lists custom manufacturing orders from the real backend", async () => {
    renderScreen();
    expect(await screen.findByText("CM-000001")).toBeInTheDocument();
    expect(screen.getByText("نافذة قابلة للتهيئة")).toBeInTheDocument();
    expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
  });

  it("shows a retry banner when the list fails to load", async () => {
    const transport = stubTransport({
      "GET /manufacturing/config-instances": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /manufacturing/configurable-products": () => ({ body: products }),
      "GET /items": () => ({ body: items }),
      "GET /customers": () => ({ body: customers }),
      "GET /warehouses": () => ({ body: warehouses }),
    });
    renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل أوامر التصنيع المخصص.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("previews materials/cost and creates a new order through the side panel, round-tripping through the stubbed transport", async () => {
    renderScreen();
    await screen.findByText("CM-000001");
    fireEvent.click(screen.getByRole("button", { name: "أمر تصنيع مخصص جديد" }));

    const dialog = screen.getByRole("dialog", { name: "أمر تصنيع مخصص جديد" });
    pickFromCombobox(dialog, "المنتج *", "نافذة قابلة للتهيئة");
    fireEvent.change(inputNextToLabel(dialog, "العرض"), { target: { value: "150" } });

    expect(await within(dialog).findByText("زجاج (م²)")).toBeInTheDocument();

    pickFromCombobox(dialog, "مستودع الخامات *", "مستودع الخامات");
    pickFromCombobox(dialog, "مستودع المنتجات *", "مستودع المنتجات التامة");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByText("CM-000002")).toBeInTheDocument();
  });
});

describe("ConfigInstancesScreen — a failed row-menu action is reported as failed, not as a false success", () => {
  it("shows a failure toast, not a false success, when closing a configured order is refused by the server", async () => {
    const transport = stubTransport({
      "GET /manufacturing/config-instances": () => ({ body: [instance()] }),
      "GET /manufacturing/configurable-products": () => ({ body: products }),
      "GET /items": () => ({ body: items }),
      "GET /customers": () => ({ body: customers }),
      "GET /warehouses": () => ({ body: warehouses }),
      "POST /manufacturing/config-instances/ci-1/close": () => ({ status: 409, body: { error: "NO_LINKED_WORK_ORDER", message: "لا يوجد أمر تصنيع مرتبط لإغلاقه" } }),
    });
    renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("CM-000001");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات CM-000001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "إغلاق الأمر" }));

    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent("تعذّر تنفيذ");
    expect(screen.queryByRole("status", { name: /تم تنفيذ/ })).not.toBeInTheDocument();
    // The row must still read configured — the close never actually landed.
    const row = screen.getByText("CM-000001").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("مهيأة")).toBeInTheDocument();
  });

  it("shows the server's error inline when closing fails from the detail view", async () => {
    const transport = stubTransport({
      "GET /manufacturing/config-instances": () => ({ body: [instance()] }),
      "GET /manufacturing/configurable-products": () => ({ body: products }),
      "GET /items": () => ({ body: items }),
      "GET /customers": () => ({ body: customers }),
      "GET /warehouses": () => ({ body: warehouses }),
      "POST /manufacturing/config-instances/ci-1/close": () => ({ status: 409, body: { error: "NO_LINKED_WORK_ORDER", message: "لا يوجد أمر تصنيع مرتبط لإغلاقه" } }),
    });
    renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("CM-000001"));
    fireEvent.click(screen.getByRole("button", { name: "إغلاق الأمر" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("لا يوجد أمر تصنيع مرتبط لإغلاقه");
  });
});

describe("ConfigInstancesScreen — cancel, list controls and preview states", () => {
  it("cancels a configured order from the detail view and posts to the cancel route", async () => {
    let cancelCalls = 0;
    const transport = stubTransport({
      "GET /manufacturing/config-instances": () => ({ body: [instance()] }),
      "GET /manufacturing/configurable-products": () => ({ body: products }),
      "GET /items": () => ({ body: items }),
      "GET /customers": () => ({ body: customers }),
      "GET /warehouses": () => ({ body: warehouses }),
      "POST /manufacturing/config-instances/ci-1/cancel": () => {
        cancelCalls += 1;
        return { body: { ...instance(), status: "cancelled" } };
      },
    });
    renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("CM-000001"));
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(cancelCalls).toBe(1));
  });

  it("cancels a configured order from the row menu without disturbing a second untouched row", async () => {
    let cancelCalls = 0;
    const other = instance({ id: "ci-2", number: "CM-000002", status: "in_progress" });
    const transport = stubTransport({
      "GET /manufacturing/config-instances": () => ({ body: [instance(), other] }),
      "GET /manufacturing/configurable-products": () => ({ body: products }),
      "GET /items": () => ({ body: items }),
      "GET /customers": () => ({ body: customers }),
      "GET /warehouses": () => ({ body: warehouses }),
      "POST /manufacturing/config-instances/ci-1/cancel": () => {
        cancelCalls += 1;
        return { body: { ...instance(), status: "cancelled" } };
      },
    });
    renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("CM-000001");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات CM-000001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "إلغاء" }));
    // «إلغاء» is destructive (tone: danger), so RowMenu asks for confirmation first.
    const confirmDialog = screen.getByRole("dialog", { name: /تأكيد/ });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(cancelCalls).toBe(1));
    const otherRow = screen.getByText("CM-000002").closest("tr");
    expect(within(otherRow!).getByText("في التنفيذ")).toBeInTheDocument();
  });

  it("filters by product name and customer name, not only the order number", async () => {
    const other = instance({ id: "ci-2", number: "CM-000002", customerId: null, spec: {} });
    renderScreen([instance(), other]);
    await screen.findByText("CM-000001");
    fireEvent.change(screen.getByPlaceholderText("بحث برقم الأمر أو المنتج أو العميل…"), { target: { value: "شركة الأمل للتجارة" } });
    expect(await screen.findByText("CM-000001")).toBeInTheDocument();
    expect(screen.queryByText("CM-000002")).not.toBeInTheDocument();
  });

  it("shows the server's rejection inline and keeps the panel open when creating an order fails", async () => {
    const transport = stubTransport({
      "GET /manufacturing/config-instances": () => ({ body: [] }),
      "GET /manufacturing/configurable-products": () => ({ body: products }),
      "GET /items": () => ({ body: items }),
      "GET /customers": () => ({ body: customers }),
      "GET /warehouses": () => ({ body: warehouses }),
      "POST /manufacturing/config-instances/preview": () => ({ body: previewResult }),
      "POST /manufacturing/config-instances": () => ({ status: 422, body: { error: "VALIDATION", message: "الكمية يجب أن تكون أكبر من صفر" } }),
    });
    renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByRole("button", { name: "أمر تصنيع مخصص جديد" }));
    const dialog = screen.getByRole("dialog", { name: "أمر تصنيع مخصص جديد" });
    pickFromCombobox(dialog, "المنتج *", "نافذة قابلة للتهيئة");
    fireEvent.change(inputNextToLabel(dialog, "العرض"), { target: { value: "150" } });
    await within(dialog).findByText("زجاج (م²)");
    pickFromCombobox(dialog, "مستودع الخامات *", "مستودع الخامات");
    pickFromCombobox(dialog, "مستودع المنتجات *", "مستودع المنتجات التامة");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("الكمية يجب أن تكون أكبر من صفر");
    expect(within(dialog).getByRole("button", { name: "حفظ" })).toBeInTheDocument();
  });

  it("cancels the create panel without posting anything to the API", async () => {
    let createCalls = 0;
    const transport = stubTransport({
      "GET /manufacturing/config-instances": () => ({ body: [] }),
      "GET /manufacturing/configurable-products": () => ({ body: products }),
      "GET /items": () => ({ body: items }),
      "GET /customers": () => ({ body: customers }),
      "GET /warehouses": () => ({ body: warehouses }),
      "POST /manufacturing/config-instances": () => {
        createCalls += 1;
        return { status: 201, body: instance() };
      },
    });
    renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByRole("button", { name: "أمر تصنيع مخصص جديد" }));
    const dialog = screen.getByRole("dialog", { name: "أمر تصنيع مخصص جديد" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));
    expect(createCalls).toBe(0);
  });

  it("shows the preview's calculating and error states, then the resolved unit cost once it settles", async () => {
    let rejectPreview = true;
    const transport = stubTransport({
      "GET /manufacturing/config-instances": () => ({ body: [] }),
      "GET /manufacturing/configurable-products": () => ({ body: products }),
      "GET /items": () => ({ body: items }),
      "GET /customers": () => ({ body: customers }),
      "GET /warehouses": () => ({ body: warehouses }),
      "POST /manufacturing/config-instances/preview": () =>
        rejectPreview ? { status: 500, body: { error: "INTERNAL", message: "تعذّر حساب المعاينة" } } : { body: previewResult },
    });
    renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByRole("button", { name: "أمر تصنيع مخصص جديد" }));
    const dialog = screen.getByRole("dialog", { name: "أمر تصنيع مخصص جديد" });
    pickFromCombobox(dialog, "المنتج *", "نافذة قابلة للتهيئة");
    fireEvent.change(inputNextToLabel(dialog, "العرض"), { target: { value: "150" } });

    expect(await within(dialog).findByText("تعذّر حساب المعاينة")).toBeInTheDocument();

    rejectPreview = false;
    // Nudging the spec re-fires the preview effect.
    fireEvent.change(inputNextToLabel(dialog, "العرض"), { target: { value: "151" } });
    expect(await within(dialog).findByText("تكلفة الوحدة")).toBeInTheDocument();
    // materialCostPerUnit + laborCostPerUnit + overheadCostPerUnit = 133.88 + 0 + 0
    expect(within(dialog).getByText("133.88")).toBeInTheDocument();
  });

  it("shows a retry banner when the list fails, and retry re-fetches the same route", async () => {
    let getCalls = 0;
    let fail = true;
    const transport = stubTransport({
      "GET /manufacturing/config-instances": () => {
        getCalls += 1;
        return fail ? { status: 500, body: { error: "INTERNAL" } } : { body: [instance()] };
      },
      "GET /manufacturing/configurable-products": () => ({ body: products }),
      "GET /items": () => ({ body: items }),
      "GET /customers": () => ({ body: customers }),
      "GET /warehouses": () => ({ body: warehouses }),
    });
    renderWithProviders(<ConfigInstancesScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل أوامر التصنيع المخصص.")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(getCalls).toBe(2));
    expect(await screen.findByText("CM-000001")).toBeInTheDocument();
  });

  it("narrows to closed orders via the status chip, and rows-per-page is wired through", async () => {
    const closed = instance({ id: "ci-2", number: "CM-000002", status: "closed" });
    renderScreen([instance(), closed]);
    await screen.findByText("CM-000001");

    fireEvent.click(screen.getByRole("tab", { name: /مغلقة/ }));
    expect(await screen.findByText("CM-000002")).toBeInTheDocument();
    expect(screen.queryByText("CM-000001")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /الكل/ }));
    await screen.findByText("CM-000001");

    fireEvent.click(screen.getByRole("combobox", { name: "صفوف لكل صفحة" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: "50" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "صفوف لكل صفحة" })).toHaveTextContent("50"));
  });
});
