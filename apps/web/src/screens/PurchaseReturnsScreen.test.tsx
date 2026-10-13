// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import type { ItemDTO, PurchaseInvoiceDTO, PurchaseReturnDocumentDTO, SupplierDTO, WarehouseDTO } from "@mezan/contracts";
import { PurchaseReturnsScreen } from "./PurchaseReturnsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

/**
 * The create/detail views are sub-pages addressed via `useSubPage()`, which
 * reads from `NavigationContext` — there is no router wired up outside
 * `AppLayout`, so a test that opens one needs its own stateful provider.
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

const suppliers: SupplierDTO[] = [
  {
    id: "sup-1", code: "S1", nameAr: "شركة النيل للتوريدات", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null, bankAccount: null,
  },
];

const warehouses: WarehouseDTO[] = [{ id: "MAIN-WH", code: "MAIN-WH", name: "مستودع الفرع الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null }];

const items: ItemDTO[] = [
  {
    id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
  {
    id: "item-brick", code: "ITM-2", nameAr: "طوب أحمر", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "50.00", costPrice: "35.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
  {
    id: "item-tile", code: "ITM-3", nameAr: "بلاط", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "75.00", costPrice: "60.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

const suppliers2: SupplierDTO[] = [
  ...suppliers,
  {
    id: "sup-2", code: "S2", nameAr: "مصنع الدلتا للأسمنت", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null,
    category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null, bankAccount: null,
  },
];

function purchaseInvoice(overrides: Partial<PurchaseInvoiceDTO> = {}): PurchaseInvoiceDTO {
  return {
    id: "pi-1",
    number: "PI-000001",
    projectId: null,
    supplierId: "sup-1",
    date: "2026-08-20",
    dueDate: "2026-09-04",
    supplierInvoiceNumber: null,
    branchId: "MAIN",
    warehouseId: "MAIN-WH",
    currency: "EGP",
    notes: null,
    receiptId: null,
    lines: [
      { itemId: "item-cement", description: null, kind: "inventory", qty: "20.000000", unitCost: "85.000000", taxRatePercent: 14, batchNo: null, expiryDate: null },
      { itemId: "item-brick", description: null, kind: "inventory", qty: "40.000000", unitCost: "35.000000", taxRatePercent: 14, batchNo: null, expiryDate: null },
    ],
    status: "confirmed",
    subtotal: "1700.000000",
    tax: "238.000000",
    total: "1938.000000",
    amountPaid: "0.000000",
    remainingBalance: "1938.000000",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-20T09:30:00.000Z",
    ...overrides,
  };
}

const purchaseInvoiceTile = purchaseInvoice({
  id: "pi-2",
  number: "PI-000200",
  lines: [{ itemId: "item-tile", description: null, kind: "inventory", qty: "15.000000", unitCost: "60.000000", taxRatePercent: 14, batchNo: null, expiryDate: null }],
});

function purchaseReturn(overrides: Partial<PurchaseReturnDocumentDTO> = {}): PurchaseReturnDocumentDTO {
  return {
    id: "pr-1",
    docType: "PURCHASE_RETURN",
    docNo: "PR-000001",
    date: "2026-08-21",
    memo: "",
    status: "draft",
    lines: [
      {
        itemId: "item-cement", warehouseId: "MAIN-WH", supplierId: "sup-1", sourceInvoiceId: "pi-1",
        sourceInvoiceNumber: "PI-000001", reason: "DEFECTIVE", availableQty: "20.000000", qty: "3.000000",
        unitCost: "85.000000", taxAmount: "35.700000",
      },
    ],
    createdAt: "2026-08-21T09:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

function baseHandlers(returns: PurchaseReturnDocumentDTO[], invoices: PurchaseInvoiceDTO[] = [purchaseInvoice()]) {
  return {
    "GET /purchases/invoices": () => ({ body: invoices }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /suppliers": () => ({ body: suppliers2 }),
    "GET /items": () => ({ body: items }),
    "GET /purchase-returns": () => ({ body: returns }),
  };
}

function selectOptionAt(label: string, index: number, optionLabel: string) {
  const combo = screen.getAllByRole("combobox", { name: label })[index]!;
  fireEvent.click(combo);
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

function qtyInputAt(index: number): HTMLElement {
  return screen.getAllByText("الكمية")[index]!.parentElement!.querySelector("input")!;
}

describe("PurchaseReturnsScreen", () => {
  it("shows the empty state when there are no returns", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<PurchaseReturnsScreen />, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "مرتجعات المشتريات" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً")).toBeInTheDocument();
  });

  it("lists purchase returns from the real API, sourced from a real confirmed purchase invoice", async () => {
    const transport = stubTransport(baseHandlers([purchaseReturn()]));
    renderWithProviders(<PurchaseReturnsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("PR-000001")).toBeInTheDocument();
    expect(screen.getByText("شركة النيل للتوريدات")).toBeInTheDocument();
  });

  it("shows a load-failed banner with a retry when the list request fails", async () => {
    const transport = stubTransport({ ...baseHandlers([]), "GET /purchase-returns": () => ({ status: 500, body: { error: "SERVER_ERROR" } }) });
    renderWithProviders(<PurchaseReturnsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل مرتجعات المشتريات. (رمز 500)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("creates a draft return against a confirmed purchase invoice", async () => {
    let current: PurchaseReturnDocumentDTO[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /purchase-returns": () => ({ body: current }),
      "POST /purchase-returns": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created = purchaseReturn({ id: body.id, docNo: null, status: "draft" });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(
      <WithSubPageNav>
        <PurchaseReturnsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    expect(screen.getByRole("heading", { name: "مرتجع مشتريات جديد" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("شركة النيل للتوريدات")).toBeInTheDocument();
  });

  it("confirms then cancels a draft return", async () => {
    let current: PurchaseReturnDocumentDTO[] = [purchaseReturn()];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /purchase-returns": () => ({ body: current }),
      "POST /purchase-returns/pr-1/confirm": () => {
        current = current.map((d) => (d.id === "pr-1" ? { ...d, status: "confirmed" as const, confirmedAt: "2026-08-21T10:00:00.000Z" } : d));
        return { body: { document: current[0], held: false } };
      },
      "POST /purchase-returns/pr-1/cancel": () => {
        current = current.map((d) => (d.id === "pr-1" ? { ...d, status: "cancelled" as const } : d));
        return { body: current[0] };
      },
    });
    renderWithProviders(
      <WithSubPageNav>
        <PurchaseReturnsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    fireEvent.click(await screen.findByText("PR-000001"));
    const detail = screen.getByRole("heading", { name: "PR-000001" }).closest("div.w-full") as HTMLElement;
    fireEvent.click(within(detail).getByRole("button", { name: "تأكيد المرتجع" }));
    expect(await within(detail).findByRole("button", { name: "إلغاء المرتجع" })).toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "إلغاء المرتجع" }));
    await within(detail).findByText("ملغي");
  });

  it("editing quantities across two real lines computes each line's own unitCost/taxAmount from the source invoice, and reaches the request exactly", async () => {
    let createdBody: Record<string, unknown> | undefined;
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /purchase-returns": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        const created = purchaseReturn({ id: (createdBody as { id: string }).id, docNo: null, status: "draft" });
        return { status: 201, body: created };
      },
    });
    renderWithProviders(
      <WithSubPageNav>
        <PurchaseReturnsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مشتريات جديد" });

    // The default line is أسمنت (item-cement, invoice qty 20) — bump its return qty.
    fireEvent.change(qtyInputAt(0), { target: { value: "4" } });

    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    selectOptionAt("الصنف", 1, "طوب أحمر");
    fireEvent.change(qtyInputAt(1), { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(createdBody).toBeDefined());
    const lines = createdBody!.lines as Array<Record<string, unknown>>;
    expect(lines).toEqual([
      {
        itemId: "item-cement", warehouseId: "MAIN-WH", supplierId: "sup-1", sourceInvoiceId: "pi-1",
        sourceInvoiceNumber: "PI-000001", reason: "DEFECTIVE", availableQty: "20.000000", qty: "4",
        unitCost: "85.000000", taxAmount: "47.600000",
      },
      {
        itemId: "item-brick", warehouseId: "MAIN-WH", supplierId: "sup-1", sourceInvoiceId: "pi-1",
        sourceInvoiceNumber: "PI-000001", reason: "DEFECTIVE", availableQty: "40.000000", qty: "2",
        unitCost: "35.000000", taxAmount: "9.800000",
      },
    ]);
  });

  it("removing a line drops only that item from the request, leaving the survivor's own qty and cost untouched", async () => {
    let createdBody: Record<string, unknown> | undefined;
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /purchase-returns": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        const created = purchaseReturn({ id: (createdBody as { id: string }).id, docNo: null, status: "draft" });
        return { status: 201, body: created };
      },
    });
    renderWithProviders(
      <WithSubPageNav>
        <PurchaseReturnsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مشتريات جديد" });

    fireEvent.change(qtyInputAt(0), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    selectOptionAt("الصنف", 1, "طوب أحمر");
    fireEvent.change(qtyInputAt(1), { target: { value: "6" } });

    // Delete the FIRST line (أسمنت) — the survivor is طوب أحمر, qty 6, untouched by the removal.
    fireEvent.click(screen.getAllByRole("button", { name: "حذف" })[0]!);

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(createdBody).toBeDefined());
    const lines = createdBody!.lines as Array<Record<string, unknown>>;
    expect(lines).toEqual([
      {
        itemId: "item-brick", warehouseId: "MAIN-WH", supplierId: "sup-1", sourceInvoiceId: "pi-1",
        sourceInvoiceNumber: "PI-000001", reason: "DEFECTIVE", availableQty: "40.000000", qty: "6",
        unitCost: "35.000000", taxAmount: "29.400000",
      },
    ]);
  });

  it("switching the source invoice repopulates the returnable lines AND the selected value from the NEWLY picked invoice, not the stale one", async () => {
    const transport = stubTransport(baseHandlers([], [purchaseInvoice(), purchaseInvoiceTile]));
    renderWithProviders(
      <WithSubPageNav>
        <PurchaseReturnsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مشتريات جديد" });

    selectOptionAt("الفاتورة الأصلية *", 0, "PI-000200 — شركة النيل للتوريدات");

    fireEvent.click(screen.getByRole("combobox", { name: "الصنف" }));
    expect(screen.getByRole("option", { name: "بلاط" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "أسمنت بورتلاندي" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "طوب أحمر" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "الصنف" })).toHaveTextContent("بلاط");
  });

  it("a rejected confirm leaves the return reading as its prior status — no un-reverted optimistic flip", async () => {
    const current: PurchaseReturnDocumentDTO[] = [purchaseReturn()];
    const transport = stubTransport({
      ...baseHandlers(current),
      "POST /purchase-returns/pr-1/confirm": () => ({ status: 409, body: { message: "الفترة المحاسبية مقفلة." } }),
    });
    renderWithProviders(
      <WithSubPageNav>
        <PurchaseReturnsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    fireEvent.click(await screen.findByText("PR-000001"));
    const detail = screen.getByRole("heading", { name: "PR-000001" }).closest("div.w-full") as HTMLElement;
    fireEvent.click(within(detail).getByRole("button", { name: "تأكيد المرتجع" }));

    expect(await within(detail).findByText("الفترة المحاسبية مقفلة.")).toBeInTheDocument();
    expect(within(detail).getByRole("button", { name: "تأكيد المرتجع" })).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "إلغاء المرتجع" })).not.toBeInTheDocument();
  });

  it("the row action menu offers only the actions valid for each return's own status: confirm/cancel on a draft, void on a confirmed one, neither on a cancelled one", async () => {
    const draft = purchaseReturn({ id: "pr-draft", docNo: "PR-000010", status: "draft" });
    const confirmed = purchaseReturn({ id: "pr-confirmed", docNo: "PR-000011", status: "confirmed" });
    const cancelled = purchaseReturn({ id: "pr-cancelled", docNo: "PR-000012", status: "cancelled" });
    const transport = stubTransport(baseHandlers([draft, confirmed, cancelled]));
    renderWithProviders(
      <WithSubPageNav>
        <PurchaseReturnsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("PR-000010");

    const rows = screen.getAllByRole("row").slice(1);
    const [rowDraft, rowConfirmed, rowCancelled] = rows;

    fireEvent.click(within(rowDraft!).getByRole("button", { name: /^إجراءات/ }));
    expect(await screen.findByRole("menuitem", { name: "تأكيد المرتجع" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "إلغاء" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "إلغاء المرتجع" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(within(rowConfirmed!).getByRole("button", { name: /^إجراءات/ }));
    expect(await screen.findByRole("menuitem", { name: "إلغاء المرتجع" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "تأكيد المرتجع" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "إلغاء" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(within(rowCancelled!).getByRole("button", { name: /^إجراءات/ }));
    expect(await screen.findByRole("menuitem", { name: "عرض" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "تأكيد المرتجع" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "إلغاء المرتجع" })).not.toBeInTheDocument();
  });

  it("the supplier filter and date range each change the outgoing list request's query string", async () => {
    let lastPath = "";
    const transport = stubTransport({
      ...baseHandlers([purchaseReturn()]),
      "GET /purchase-returns": (_init, path) => {
        lastPath = path;
        return { body: [purchaseReturn()] };
      },
    });
    renderWithProviders(<PurchaseReturnsScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("PR-000001");

    selectOptionAt("المورد", 0, "مصنع الدلتا للأسمنت");
    await waitFor(() => expect(lastPath).toContain("supplierId=sup-2"));

    fireEvent.change(screen.getAllByText("من تاريخ")[0]!.parentElement!.querySelector("input")!, { target: { value: "2026-08-01" } });
    await waitFor(() => expect(lastPath).toContain("fromDate=2026-08-01"));
  });
});

describe("PurchaseReturnsScreen — a held document whose approval no longer stands", () => {
  it("says why in Arabic and asks for approval again through the document's own confirm", async () => {
    let standing = "reapproval_required";
    let confirms = 0;
    const held = purchaseReturn({ id: "held-1", docNo: "HELD-0001", status: "pending", workflowRequestId: "held-1:confirm" });
    const transport = stubTransport({
      ...baseHandlers([]),
      "GET /purchase-returns": () => ({ body: [held] }),
      "GET /workflow/requests/*/standing": () => ({ body: { id: "held-1:confirm", status: standing, reason: standing === "reapproval_required" ? "الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد." : null, reasonEn: null } }),
      "POST /purchase-returns/held-1/confirm": () => {
        confirms += 1;
        standing = "pending";
        return { body: held };
      },
    });
    renderWithProviders(<WithSubPageNav><PurchaseReturnsScreen /></WithSubPageNav>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("HELD-0001"));
    const notice = await screen.findByTestId("reapproval-notice");
    expect(notice).toHaveTextContent("الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد.");
    fireEvent.click(within(notice).getByRole("button", { name: "طلب الموافقة من جديد" }));
    await waitFor(() => expect(confirms).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("reapproval-notice")).not.toBeInTheDocument());
  });
});
