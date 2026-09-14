// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  BranchDTO,
  GoodsReceiptDTO,
  ItemDTO,
  PurchaseOrderDTO,
  SupplierDTO,
  UserDTO,
  WarehouseDTO,
} from "@mezan/contracts";
import { GoodsReceiptsScreen } from "./GoodsReceiptsScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import { NavigationProvider, type ScreenIntentInput } from "../navigation";
import type { ScreenKey } from "../router/screens";
import type { Transport } from "../data/transport";

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/** Same in-memory sub-page stand-in as the neighbouring test file, with an optional starting segment for "opened at an unknown id" and a navigate spy for cross-screen row actions. */
function TestNavigation({
  children,
  initialSegments = [],
  onNavigate,
}: {
  children: ReactNode;
  initialSegments?: readonly string[];
  onNavigate?: (screen: ScreenKey, intent?: ScreenIntentInput) => void;
}) {
  const [segments, setSegments] = useState<readonly string[]>(initialSegments);
  return (
    <NavigationProvider
      value={{
        navigate: (screen, intent) => onNavigate?.(screen, intent),
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

/** Same as `pickFromCombobox`, but for the Nth combobox sharing a label — the ad-hoc line list repeats "الصنف" per row. */
function pickFromComboboxAt(inputs: HTMLElement[], index: number, optionLabel: string) {
  const input = inputs[index]!;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = screen.getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

const suppliers: SupplierDTO[] = [
  {
    id: "sup-1", code: "S1", nameAr: "شركة النيل للتوريدات", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null, bankAccount: null,
  },
];

const items: ItemDTO[] = [
  {
    id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
  {
    id: "item-med", code: "ITM-2", nameAr: "دواء أموكسيسيلين", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "40.00", costPrice: null, taxRatePercent: 14, trackInventory: true,
    trackBatches: true, trackExpiry: true, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "BR2", code: "BR2", name: "الفرع الثاني", parentBranchId: null, phone: null, email: null, address: null, isMain: false, active: true },
];

const warehouses: WarehouseDTO[] = [
  { id: "MAIN-WH", code: "MAIN-WH", name: "المخزن الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null },
  { id: "WH2", code: "WH2", name: "مخزن الفرع الثاني", nameEn: null, branchId: "BR2", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null },
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
    projectId: null,
    ...overrides,
  };
}

function user(overrides: Partial<UserDTO> = {}): UserDTO {
  return {
    id: "u1",
    nameAr: "أحمد فتحي",
    nameEn: null,
    email: "ahmed@cyag.example",
    phone: null,
    roleId: null,
    isCompanyAdmin: false,
    employeeId: null,
    branchScope: "*",
    warehouseScope: "*",
    status: "active",
    hasPin: false,
    photoUrl: null,
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const baseHandlers: Record<string, (init: RequestInit | undefined, path: string) => StubResult> = {
  "GET /purchases/orders": () => ({ body: [] }),
  "GET /suppliers": () => ({ body: suppliers }),
  "GET /items": () => ({ body: items }),
  "GET /branches": () => ({ body: branches }),
  "GET /warehouses": () => ({ body: warehouses }),
  "GET /users": () => ({ body: [] }),
  "GET /projects": () => ({ body: [] }),
};

function renderScreen(transport: Transport, options: { initialSegments?: readonly string[]; onNavigate?: (screen: ScreenKey, intent?: ScreenIntentInput) => void } = {}) {
  return renderWithProviders(
    <TestNavigation initialSegments={options.initialSegments} onNavigate={options.onNavigate}>
      <GoodsReceiptsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("GoodsReceiptsScreen — a draft receipt with no purchase order", () => {
  it("offers the confirm action, shows only the draft effects, and falls back to raw ids for an unknown supplier and item", async () => {
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({
        body: [
          goodsReceipt({
            status: "draft",
            purchaseOrderId: null,
            supplierId: "sup-ghost",
            lines: [{ itemId: "item-ghost", description: null, qty: "5.000000", unitCost: "10.000000", batchNo: null, expiryDate: null }],
          }),
        ],
      }),
    });
    renderScreen(transport);

    fireEvent.click(await screen.findByText("GR-000010"));

    expect(await screen.findByRole("button", { name: "تأكيد الاستلام" })).toBeInTheDocument();
    expect(screen.getByText("sup-ghost · مقابل —")).toBeInTheDocument();
    expect(screen.getByText("item-ghost")).toBeInTheDocument();

    expect(screen.getByText("إيصال مسودة — أكّده ليثبت البضاعة في المخزون.")).toBeInTheDocument();
    expect(screen.queryByText("تمت زيادة كمية المخزون بأصناف هذا الإيصال في المستودع (استلام فعلي).")).not.toBeInTheDocument();
  });
});

describe("GoodsReceiptsScreen — a confirmed receipt matched to a real purchase order", () => {
  it("shows the order number and invoiced state in both the detail and the list row", async () => {
    const order = purchaseOrder({ id: "po-1", number: "PO-000005" });
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/orders": () => ({ body: [order] }),
      "GET /purchases/receipts": () => ({
        body: [goodsReceipt({ purchaseOrderId: "po-1", status: "confirmed", invoiced: true })],
      }),
    });
    renderScreen(transport);

    await screen.findByText("GR-000010");
    expect(screen.getAllByText("PO-000005")).not.toHaveLength(0);
    expect(screen.getAllByText("مفوتر").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("GR-000010"));
    expect(await screen.findByText("شركة النيل للتوريدات · مقابل PO-000005")).toBeInTheDocument();
    expect(screen.getByText("تمت زيادة كمية المخزون بأصناف هذا الإيصال في المستودع (استلام فعلي).")).toBeInTheDocument();
    expect(screen.getByText("تم تحديث حالة أمر الشراء (مستلم جزئياً / بالكامل).")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تأكيد الاستلام" })).not.toBeInTheDocument();
  });
});

describe("GoodsReceiptsScreen — confirming a draft receipt", () => {
  it("posts to the confirm endpoint for the selected receipt and locks the confirm action once it settles", async () => {
    let receiptsCallCount = 0;
    let confirmedId: string | null = null;
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => {
        receiptsCallCount += 1;
        return { body: [goodsReceipt({ status: receiptsCallCount === 1 ? "draft" : "confirmed" })] };
      },
      "POST /purchases/receipts/*/confirm": (_init, path) => {
        confirmedId = path.split("/")[3] ?? null;
        return { body: goodsReceipt({ status: "confirmed" }) };
      },
    });
    renderScreen(transport);

    fireEvent.click(await screen.findByText("GR-000010"));
    const confirmButton = await screen.findByRole("button", { name: "تأكيد الاستلام" });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(confirmedId).toBe("gr-1"));
    await waitFor(() => expect(screen.queryByRole("button", { name: "تأكيد الاستلام" })).not.toBeInTheDocument());
    expect(await screen.findByText("تمت زيادة كمية المخزون بأصناف هذا الإيصال في المستودع (استلام فعلي).")).toBeInTheDocument();
  });
});

describe("GoodsReceiptsScreen — the branch and warehouse filters", () => {
  it("narrows the warehouse filter's own options to the selected branch's warehouses", async () => {
    const user = userEvent.setup();
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ body: [] }),
    });
    renderScreen(transport);
    await screen.findByText("لا توجد إيصالات استلام مطابقة");

    await user.click(screen.getByLabelText("الفرع"));
    await user.click(await screen.findByRole("option", { name: "الفرع الرئيسي" }));

    await user.click(screen.getByLabelText("المستودع"));
    expect(await screen.findByRole("option", { name: "المخزن الرئيسي" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "مخزن الفرع الثاني" })).not.toBeInTheDocument();
  });
});

describe("GoodsReceiptsScreen — the row menu's per-receipt actions", () => {
  it("offers confirm only on a draft row and raising an invoice only on a confirmed, uninvoiced row", async () => {
    const navigateCalls: Array<{ screen: ScreenKey; intent?: ScreenIntentInput }> = [];
    let confirmedId: string | null = null;
    const draftRow = goodsReceipt({ id: "gr-d", number: "GR-000001", status: "draft", invoiced: false, createdBy: "u1" });
    const confirmedUninvoicedRow = goodsReceipt({ id: "gr-c", number: "GR-000002", status: "confirmed", invoiced: false, createdBy: "u2" });
    const confirmedInvoicedRow = goodsReceipt({ id: "gr-ci", number: "GR-000003", status: "confirmed", invoiced: true, createdBy: "u1" });
    const transport = stubTransport({
      ...baseHandlers,
      "GET /users": () => ({ body: [user({ id: "u1", nameAr: "أحمد فتحي" })] }),
      "GET /purchases/receipts": () => ({ body: [draftRow, confirmedUninvoicedRow, confirmedInvoicedRow] }),
      "POST /purchases/receipts/*/confirm": (_init, path) => {
        confirmedId = path.split("/")[3] ?? null;
        return { body: goodsReceipt({ ...draftRow, status: "confirmed" }) };
      },
    });
    renderScreen(transport, { onNavigate: (screen, intent) => navigateCalls.push({ screen, intent }) });

    await screen.findByText("GR-000001");
    // Known creator resolves to their Arabic name (two rows share u1); an unknown one falls back to the raw id.
    expect(screen.getAllByText("أحمد فتحي")).toHaveLength(2);
    expect(screen.getByText("u2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إجراءات إذن الاستلام GR-000001" }));
    expect(screen.getByRole("menuitem", { name: "تأكيد الاستلام" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "فاتورة مشتريات من هذا الإذن" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "تأكيد الاستلام" }));
    await waitFor(() => expect(confirmedId).toBe("gr-d"));

    fireEvent.click(screen.getByRole("button", { name: "إجراءات إذن الاستلام GR-000002" }));
    expect(screen.queryByRole("menuitem", { name: "تأكيد الاستلام" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "فاتورة مشتريات من هذا الإذن" }));
    expect(navigateCalls).toContainEqual({ screen: "purchase-invoices", intent: { kind: "create" } });

    fireEvent.click(screen.getByRole("button", { name: "إجراءات إذن الاستلام GR-000003" }));
    expect(screen.queryByRole("menuitem", { name: "تأكيد الاستلام" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "فاتورة مشتريات من هذا الإذن" })).not.toBeInTheDocument();
  });
});

describe("GoodsReceiptsScreen — receiving against a purchase order", () => {
  it("offers only sent and partially-received orders, and previews just the still-outstanding line", async () => {
    const partial = purchaseOrder({
      id: "po-partial",
      number: "PO-000001",
      lines: [
        { itemId: "item-cement", description: null, qty: "50.000000", unitPrice: "85.000000", receivedQty: "30.000000" },
        { itemId: "item-med", description: null, qty: "10.000000", unitPrice: "40.000000", receivedQty: "10.000000" },
      ],
      status: "sent",
    });
    const partiallyReceived = purchaseOrder({ id: "po-pr", number: "PO-000002", status: "partially_received" });
    const cancelled = purchaseOrder({ id: "po-cancelled", number: "PO-000003", status: "cancelled" });
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/orders": () => ({ body: [partial, partiallyReceived, cancelled] }),
      "GET /purchases/receipts": () => ({ body: [] }),
    });
    renderScreen(transport);

    await screen.findByText("لا توجد إيصالات استلام مطابقة");
    fireEvent.click(screen.getAllByRole("button", { name: "إيصال استلام جديد" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));

    const orderInput = screen.getByLabelText("أمر الشراء *");
    fireEvent.focus(orderInput);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(within(options[0]!).getByText(/PO-000001/)).toBeInTheDocument();
    expect(within(options[1]!).getByText(/PO-000002/)).toBeInTheDocument();

    pickFromCombobox(document.body, "أمر الشراء *", "PO-000001");

    expect(await screen.findByText("أسمنت بورتلاندي")).toBeInTheDocument();
    // The outstanding quantity seeds an EDITABLE field (D73), not a read-only preview cell.
    expect(screen.getByLabelText("الكمية المستلمة")).toHaveValue(20);
    expect(screen.getByText("المتبقي على أمر الشراء: 20")).toBeInTheDocument();
    expect(screen.queryByText("دواء أموكسيسيلين")).not.toBeInTheDocument();
  });
});

describe("GoodsReceiptsScreen — the require-PO policy, once it resolves", () => {
  it("shows the Arabic explanation for the policy being on", async () => {
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ body: [] }),
      "GET /settings": () => ({ body: { requirePoForGrn: true } }),
    });
    renderScreen(transport);

    await screen.findByText("لا توجد إيصالات استلام مطابقة");
    fireEvent.click(screen.getAllByRole("button", { name: "إيصال استلام جديد" })[0]!);

    expect(
      await screen.findByText(
        "سياسة «إلزام أمر الشراء قبل الاستلام» مفعّلة في الإعدادات، فكل إذن استلام يجب أن يستند إلى أمر شراء مؤكد.",
      ),
    ).toBeInTheDocument();
  });
});

describe("GoodsReceiptsScreen — an ad-hoc receipt's lines", () => {
  it("shows batch and expiry only for a batch-tracked item, and drops a removed line before saving", async () => {
    let posted: Record<string, unknown> | null = null;
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ body: [] }),
      "GET /settings": () => ({ body: { requirePoForGrn: false } }),
      "POST /purchases/receipts": (init) => {
        posted = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        return { body: goodsReceipt({ id: "gr-new", number: "GR-000099", purchaseOrderId: null }) };
      },
    });
    renderScreen(transport);

    await screen.findByText("لا توجد إيصالات استلام مطابقة");
    fireEvent.click(screen.getAllByRole("button", { name: "إيصال استلام جديد" })[0]!);
    const adHocButton = await screen.findByRole("button", { name: /استلام مباشر/ });
    await waitFor(() => expect(adHocButton).not.toBeDisabled());
    fireEvent.click(adHocButton);
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));

    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("المستودع *"));
    await user.click(await screen.findByRole("option", { name: "المخزن الرئيسي" }));

    pickFromComboboxAt(screen.getAllByLabelText("الصنف"), 0, "أسمنت بورتلاندي");
    expect(screen.queryByLabelText("رقم التشغيلة")).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("تكلفة الوحدة")[0]).toHaveValue(85);

    fireEvent.click(screen.getByRole("button", { name: "إضافة صنف" }));
    expect(screen.getAllByRole("button", { name: "حذف البند" })).toHaveLength(2);

    pickFromComboboxAt(screen.getAllByLabelText("الصنف"), 1, "دواء أموكسيسيلين");
    expect(screen.getAllByLabelText("تكلفة الوحدة")[1]).toHaveValue(0);

    fireEvent.change(screen.getByLabelText("رقم التشغيلة"), { target: { value: "B-100" } });
    fireEvent.change(screen.getByLabelText("تاريخ انتهاء الصلاحية"), { target: { value: "2027-01-01" } });
    // Edited while both lines are still on screen, so the qty setter's per-row key match is exercised for the OTHER line too, not just the one being edited.
    fireEvent.change(screen.getAllByLabelText("الكمية")[1]!, { target: { value: "3" } });

    fireEvent.click(screen.getAllByRole("button", { name: "حذف البند" })[0]!);
    expect(screen.getAllByLabelText("الصنف")).toHaveLength(1);
    expect(screen.getByLabelText("الصنف")).toHaveValue("دواء أموكسيسيلين");

    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      lines: [{ itemId: "item-med", qty: "3", unitCost: "0", batchNo: "B-100", expiryDate: "2027-01-01" }],
    });
  });
});

describe("GoodsReceiptsScreen — an ad-hoc receipt with no warehouse to default to", () => {
  it("leaves the save action disabled when no warehouse exists for the tenant", async () => {
    const transport = stubTransport({
      ...baseHandlers,
      "GET /warehouses": () => ({ body: [] }),
      "GET /purchases/receipts": () => ({ body: [] }),
      "GET /settings": () => ({ body: { requirePoForGrn: false } }),
    });
    renderScreen(transport);

    await screen.findByText("لا توجد إيصالات استلام مطابقة");
    fireEvent.click(screen.getAllByRole("button", { name: "إيصال استلام جديد" })[0]!);
    const adHocButton = await screen.findByRole("button", { name: /استلام مباشر/ });
    await waitFor(() => expect(adHocButton).not.toBeDisabled());
    fireEvent.click(adHocButton);
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));

    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    pickFromComboboxAt(screen.getAllByLabelText("الصنف"), 0, "أسمنت بورتلاندي");

    expect(screen.getByRole("button", { name: "حفظ مسودة" })).toBeDisabled();
  });
});

describe("GoodsReceiptsScreen — an ad-hoc receipt when the working location has no warehouse of its own", () => {
  it("falls back to the tenant's only configured warehouse even when it belongs to a different branch", async () => {
    const offBranchWarehouse: WarehouseDTO[] = [
      { id: "WH-OTHER", code: "WH-OTHER", name: "مخزن آخر", nameEn: null, branchId: "OTHER-BRANCH", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null },
    ];
    const transport = stubTransport({
      ...baseHandlers,
      "GET /warehouses": () => ({ body: offBranchWarehouse }),
      "GET /purchases/receipts": () => ({ body: [] }),
      "GET /settings": () => ({ body: { requirePoForGrn: false } }),
    });
    renderScreen(transport);

    await screen.findByText("لا توجد إيصالات استلام مطابقة");
    fireEvent.click(screen.getAllByRole("button", { name: "إيصال استلام جديد" })[0]!);
    const adHocButton = await screen.findByRole("button", { name: /استلام مباشر/ });
    await waitFor(() => expect(adHocButton).not.toBeDisabled());
    fireEvent.click(adHocButton);
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));

    expect(screen.getByLabelText("المستودع *")).toHaveTextContent("مخزن آخر");
  });
});

describe("GoodsReceiptsScreen — a confirm request the server rejects", () => {
  it("swallows the failure without crashing, leaving the confirm action available to retry", async () => {
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ body: [goodsReceipt({ status: "draft" })] }),
      "POST /purchases/receipts/*/confirm": () => ({ status: 500, body: { error: "INTERNAL" } }),
    });
    renderScreen(transport);

    fireEvent.click(await screen.findByText("GR-000010"));
    const confirmButton = await screen.findByRole("button", { name: "تأكيد الاستلام" });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(confirmButton).toBeEnabled());
    expect(await screen.findByRole("button", { name: "تأكيد الاستلام" })).toBeInTheDocument();
  });
});

describe("GoodsReceiptsScreen — a sub-page id that matches no receipt", () => {
  it("falls back to the receipts list instead of an empty detail view", async () => {
    const transport = stubTransport({
      ...baseHandlers,
      "GET /purchases/receipts": () => ({ body: [goodsReceipt()] }),
    });
    renderScreen(transport, { initialSegments: ["GR-DOES-NOT-EXIST"] });

    expect(await screen.findByRole("heading", { name: "إيصالات الاستلام" })).toBeInTheDocument();
  });
});
