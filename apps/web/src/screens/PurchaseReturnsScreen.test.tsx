// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { act, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import type { ItemDTO, PurchaseInvoiceDTO, PurchaseReturnDocumentDTO, SupplierDTO, WarehouseDTO } from "@mezan/contracts";
import { PurchaseReturnsScreen } from "./PurchaseReturnsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider, type ScreenIntent } from "../navigation";

/**
 * The create/detail views are sub-pages addressed via `useSubPage()`, which
 * reads from `NavigationContext` — there is no router wired up outside
 * `AppLayout`, so a test that opens one needs its own stateful provider.
 */
function WithSubPageNav({ children, intent = null }: { children: ReactElement; intent?: ScreenIntent | null }) {
  const [segments, setSegments] = useState<string[]>([]);
  const [pending, setPending] = useState(intent);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: (next) => setSegments([...next]),
        openScreenAt: () => {},
        intent: pending,
        clearIntent: () => setPending(null),
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
      { itemId: "item-cement", description: null, kind: "inventory", qty: "20.000000", unitCost: "85.000000", taxRatePercent: 14, taxRateId: null, batchNo: null, expiryDate: null },
      { itemId: "item-brick", description: null, kind: "inventory", qty: "40.000000", unitCost: "35.000000", taxRatePercent: 14, taxRateId: null, batchNo: null, expiryDate: null },
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
  lines: [{ itemId: "item-tile", description: null, kind: "inventory", qty: "15.000000", unitCost: "60.000000", taxRatePercent: 14, taxRateId: null, batchNo: null, expiryDate: null }],
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
        sourceInvoiceNumber: "PI-000001", sourceLineId: "0", reason: "DEFECTIVE", availableQty: "20.000000", qty: "3.000000",
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

function baseHandlers(
  returns: PurchaseReturnDocumentDTO[],
  invoices: PurchaseInvoiceDTO[] = [purchaseInvoice()],
  returnedByLine: Record<string, string> = {},
) {
  return {
    "GET /purchase-returns/source-lines/*": (_init: unknown, path: string) => {
      const invoice = invoices.find((i) => i.id === decodeURIComponent(path.split("/").pop()!.split("?")[0]!));
      if (!invoice) return { status: 404, body: { error: "SOURCE_INVOICE_NOT_FOUND" } };
      return {
        body: {
          sourceInvoiceId: invoice.id,
          lines: invoice.lines.flatMap((l, index) =>
            l.itemId === null ? [] : [{ sourceLineId: String(index), itemId: l.itemId, soldQty: l.qty, returnedQty: returnedByLine[String(index)] ?? "0" }],
          ),
        },
      };
    },
    "GET /purchases/invoices": () => ({ body: invoices }),
    "GET /purchases/invoices/*": (_init: unknown, path: string) => {
      const invoice = invoices.find((i) => i.id === decodeURIComponent(path.split("/").pop()!.split("?")[0]!));
      return invoice ? { body: invoice } : { status: 404, body: { error: "NOT_FOUND" } };
    },
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

async function pickInvoice(optionLabel: string) {
  const input = screen.getByLabelText("الفاتورة الأصلية *");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  fireEvent.mouseDown(await screen.findByRole("button", { name: (name) => name.startsWith(optionLabel) }, { timeout: 2000 }));
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
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ كمسودة" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("شركة النيل للتوريدات")).toBeInTheDocument();
  });

  it("opens the return already saved, with a notice, when its id was used with other contents, and uses a new id next time", async () => {
    let current: PurchaseReturnDocumentDTO[] = [];
    const sentIds: string[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /purchase-returns": () => ({ body: current }),
      "POST /purchase-returns": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        sentIds.push(body.id);
        if (sentIds.length > 1) return { status: 201, body: purchaseReturn({ id: body.id, docNo: null, status: "draft" }) };
        current = [purchaseReturn({ id: body.id, docNo: null, status: "draft" })];
        return { status: 409, body: { error: "IDEMPOTENCY_KEY_REUSED", message: "سبق تسجيل مستند بهذا المعرّف ببيانات مختلفة" } };
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
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ كمسودة" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    expect(await screen.findByRole("status")).toHaveTextContent("سبق حفظ هذا المستند، ففُتح المستند المحفوظ بدل إنشاء آخر");
    expect(screen.queryByRole("heading", { name: "مرتجع مشتريات جديد" })).not.toBeInTheDocument();
    expect(sentIds).toHaveLength(1);
  });

  it("cancels a draft return from its page through the cancel route, asking for no reason and never calling the void route", async () => {
    let current: PurchaseReturnDocumentDTO[] = [purchaseReturn()];
    const called: string[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /purchase-returns": () => ({ body: current }),
      "POST /purchase-returns/pr-1/cancel": () => {
        called.push("cancel");
        current = current.map((d) => (d.id === "pr-1" ? { ...d, status: "cancelled" as const } : d));
        return { body: current[0] };
      },
      "POST /purchase-returns/pr-1/void": () => {
        called.push("void");
        return { status: 409, body: { error: "INVALID_DOCUMENT_TRANSITION", message: "لا يُلغى مرتجع غير مؤكد." } };
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
    expect(within(detail).queryByRole("button", { name: "إلغاء المرتجع" })).not.toBeInTheDocument();
    fireEvent.click(within(detail).getByRole("button", { name: "إلغاء" }));
    await within(detail).findByText("ملغي");
    expect(called).toEqual(["cancel"]);
    expect(screen.queryByLabelText("سبب الإلغاء")).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: "إلغاء" })).not.toBeInTheDocument();
  });

  it("confirms a draft return, then voids it with a reason through its own route", async () => {
    let current: PurchaseReturnDocumentDTO[] = [purchaseReturn()];
    const voidBodies: unknown[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /purchase-returns": () => ({ body: current }),
      "POST /purchase-returns/pr-1/confirm": () => {
        current = current.map((d) => (d.id === "pr-1" ? { ...d, status: "confirmed" as const, confirmedAt: "2026-08-21T10:00:00.000Z" } : d));
        return { body: { document: current[0], held: false } };
      },
      "POST /purchase-returns/pr-1/void": (init) => {
        voidBodies.push(JSON.parse((init?.body as string) ?? "{}"));
        current = current.map((d) => (d.id === "pr-1" ? { ...d, status: "reversed" as const, voidReason: "خطأ" } : d));
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
    expect(voidBodies).toEqual([]);
    fireEvent.change(screen.getByLabelText("سبب الإلغاء"), { target: { value: "خطأ" } });
    fireEvent.click(screen.getAllByRole("button", { name: "إلغاء المرتجع" }).at(-1)!);
    await within(detail).findByText("معكوس");
    expect(voidBodies).toEqual([{ reason: "خطأ" }]);
    expect(within(detail).getByRole("note")).toHaveTextContent("سبب الإلغاء: خطأ");
  });

  it("editing quantities across two real lines sends each line's own source line and quantity — and no cost, tax or returnable quantity, which the server reads off the invoice", async () => {
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
        sourceInvoiceNumber: "PI-000001", sourceLineId: "0", reason: "DEFECTIVE", qty: "4",
      },
      {
        itemId: "item-brick", warehouseId: "MAIN-WH", supplierId: "sup-1", sourceInvoiceId: "pi-1",
        sourceInvoiceNumber: "PI-000001", sourceLineId: "1", reason: "DEFECTIVE", qty: "2",
      },
    ]);
  });

  it("clearing a quantity and pressing «إضافة بند» adds a row instead of crashing the form — an empty field takes nothing from its line (D79 round 4)", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(
      <WithSubPageNav>
        <PurchaseReturnsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مشتريات جديد" });

    fireEvent.change(qtyInputAt(0), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));

    expect(screen.getAllByText("الكمية")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "مرتجع مشتريات جديد" })).toBeInTheDocument();
  });

  it("starts a new row from what the SERVER says is left of each invoice line, not from the returns the list happens to show (D79 round 4)", async () => {
    let served = false;
    const handlers = baseHandlers([], [purchaseInvoice()], { "0": "20" });
    const transport = stubTransport({
      ...handlers,
      "GET /purchase-returns/source-lines/*": (init, path) => {
        served = true;
        return handlers["GET /purchase-returns/source-lines/*"](init, path);
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
    await waitFor(() => expect(served).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    await waitFor(() => expect(screen.getAllByRole("combobox", { name: "الصنف" })).toHaveLength(2));
    expect(screen.getAllByRole("combobox", { name: "الصنف" })[1]!.textContent).toBe("طوب أحمر");
  });

  it("holds «إضافة بند» and both save buttons until the server has said what is left of the invoice, and offers a retry in Arabic when it cannot", async () => {
    let fail = true;
    const handlers = baseHandlers([], [purchaseInvoice()], {});
    const transport = stubTransport({
      ...handlers,
      "GET /purchase-returns/source-lines/*": (init, path) =>
        fail ? { status: 500, body: { error: "INTERNAL", message: "خطأ داخلي" } } : handlers["GET /purchase-returns/source-lines/*"](init, path),
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

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تعذّر قراءة ما تبقّى من بنود الفاتورة");
    for (const name of ["إضافة بند", "حفظ كمسودة", "حفظ وتأكيد"]) expect(screen.getByRole("button", { name })).toBeDisabled();

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "إضافة بند" })).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("«إضافة بند» starts the new row on the next invoice line once the rows above take the whole of the first — never the same line twice by default", async () => {
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

    fireEvent.change(qtyInputAt(0), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    fireEvent.change(qtyInputAt(1), { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(createdBody).toBeDefined());
    const lines = createdBody!.lines as Array<Record<string, unknown>>;
    expect(lines.map((l) => [l.itemId, l.sourceLineId, l.qty])).toEqual([
      ["item-cement", "0", "20"],
      ["item-brick", "1", "2"],
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
        sourceInvoiceNumber: "PI-000001", sourceLineId: "1", reason: "DEFECTIVE", qty: "6",
      },
    ]);
  });

  it("picking the invoice that is already chosen keeps the line the server seeded — it does not empty the form", async () => {
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
    const seeded = (await screen.findByRole("combobox", { name: "الصنف" })).textContent;
    const chosen = (screen.getByLabelText("الفاتورة الأصلية *") as HTMLInputElement).value;
    expect(chosen).toBe("PI-000001 — شركة النيل للتوريدات");

    await pickInvoice(chosen);

    await waitFor(() => expect(screen.getByRole("combobox", { name: "الصنف" })).toHaveTextContent(seeded!));
    expect(screen.getAllByRole("combobox", { name: "الصنف" })).toHaveLength(1);
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

    await pickInvoice("PI-000200 — شركة النيل للتوريدات");

    fireEvent.click(await screen.findByRole("combobox", { name: "الصنف" }));
    expect(screen.getByRole("option", { name: "بلاط" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "أسمنت بورتلاندي" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "طوب أحمر" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "الصنف" })).toHaveTextContent("بلاط");
  });

  it("searches confirmed invoices on the server and names lines by id, never downloading every invoice or item", async () => {
    const invoicePaths: string[] = [];
    const itemPaths: string[] = [];
    const handlers = baseHandlers([], [purchaseInvoice(), purchaseInvoiceTile]);
    const transport = stubTransport({
      ...handlers,
      "GET /purchases/invoices": (init, path) => {
        invoicePaths.push(path);
        return handlers["GET /purchases/invoices"]();
      },
      "GET /items": (_init, path) => {
        itemPaths.push(path);
        return { body: items };
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
    const picker = await screen.findByLabelText("الفاتورة الأصلية *");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "PI-000200" } });
    await waitFor(() => expect(invoicePaths.some((path) => path.includes("search=PI-000200") && path.includes("status=confirmed"))).toBe(true));
    expect(invoicePaths.filter((path) => path.includes("pageSize=200"))).toEqual([]);
    expect(itemPaths.length).toBeGreaterThan(0);
    expect(itemPaths.filter((path) => !path.includes("ids="))).toEqual([]);
  });

  it("arriving from an invoice's row menu selects THAT invoice even when it is not among the first matches", async () => {
    const transport = stubTransport({
      ...baseHandlers([], [purchaseInvoice(), purchaseInvoiceTile]),
      "GET /purchases/invoices": () => ({ body: [purchaseInvoice()] }),
    });
    renderWithProviders(
      <WithSubPageNav intent={{ kind: "create", prefill: { invoiceId: "pi-2" } }}>
        <PurchaseReturnsScreen />
      </WithSubPageNav>,
      { transport, initialSession: testAdminSession },
    );
    await waitFor(() => expect(screen.getByLabelText("الفاتورة الأصلية *")).toHaveValue("PI-000200 — شركة النيل للتوريدات"));
    expect(await screen.findByRole("combobox", { name: "الصنف" })).toHaveTextContent("بلاط");
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
