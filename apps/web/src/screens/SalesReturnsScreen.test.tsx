// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CustomerDTO, ItemDTO, SalesReturnDocumentDTO, TreasuryAccountDTO, WarehouseDTO } from "@mezan/contracts";
import type { SalesInvoiceDTO } from "../data/hooks";
import { SalesReturnsScreen } from "./SalesReturnsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

/**
 * SalesReturnsScreen's create/detail views are sub-pages addressed via the
 * shell's `useSubPage` (navigation.tsx), which no-ops outside a real
 * `NavigationProvider`. This stands in for the shell's URL-driven one with
 * in-memory segments — enough for the screen under test to open, close and
 * read its own sub-page.
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

const customers: CustomerDTO[] = [
  {
    id: "cust-1", code: "C1", nameAr: "شركة الأمل للتجارة", nameEn: null, phone: null, email: null, contactPerson: null,
    taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true,
    priceListId: null, creditLimit: "0", taxExempt: false, taxExemptionRateId: null, etaBuyerType: "business", commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
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

const treasuryAccounts: TreasuryAccountDTO[] = [
  { id: "treas-1", code: "CASH-1", name: "خزينة الفرع الرئيسي", nameEn: null, type: "cash", currency: "EGP", bankAccountNumber: null, branchId: "MAIN", glAccountId: null, openingBalance: "0", openingBalanceDate: null, guaranteeFacilityLimit: null, status: "active" },
];

function salesInvoice(overrides: Partial<SalesInvoiceDTO> = {}): SalesInvoiceDTO {
  return {
    id: "inv-1",
    docType: "SALES_INVOICE",
    docNo: "INV-000123",
    status: "confirmed",
    date: "2026-08-10",
    dueDate: "2026-09-10",
    customerId: "cust-1",
    customerNameAr: "شركة الأمل للتجارة",
    customerTaxExempt: false,
    taxInclusive: false,
    warehouseId: "MAIN-WH",
    branchId: "MAIN",
    salespersonId: null,
    salespersonNameAr: null,
    couponCode: null,
    appliedPromotion: null,
    currency: "EGP",
    notes: null,
    internalNotes: null,
    discount: { type: "percent", percent: 0 },
    arAccountId: "acc-ar",
    taxAccountId: "acc-tax",
    amountPaid: "0.000000",
    returnedCredit: "0.000000",
    remainingBalance: "1150.000000",
    journalEntryId: "je-1",
    workflowRequestId: null,
    createdAt: "2026-08-10T09:00:00.000Z",
    confirmedAt: "2026-08-10T09:05:00.000Z",
    projectId: null,
    fxRate: null,
    lines: [
      {
        unitCode: "", unitFactor: 1, discountType: "percent", discountAmount: "0.000000", costCenterId: null, taxRateId: null, baseQty: "10.000000", lineId: "l1", itemId: "item-cement", itemNameAr: "أسمنت بورتلاندي", isStock: true, qty: "10.000000",
        unitPrice: "100.000000", discountPercent: 0, taxRatePercent: 14, revenueAccountId: "acc-rev",
        cogsAccountId: "acc-cogs", inventoryAccountId: "acc-inv", unitCost: "85.000000",
      },
      {
        unitCode: "", unitFactor: 1, discountType: "percent", discountAmount: "0.000000", costCenterId: null, taxRateId: null, baseQty: "20.000000", lineId: "l2", itemId: "item-brick", itemNameAr: "طوب أحمر", isStock: true, qty: "20.000000",
        unitPrice: "50.000000", discountPercent: 0, taxRatePercent: 14, revenueAccountId: "acc-rev",
        cogsAccountId: "acc-cogs", inventoryAccountId: "acc-inv", unitCost: "35.000000",
      },
    ],
    totals: { taxInclusive: false, grossTotal: "1000.000000", lineDiscountTotal: "0", promotionDiscountTotal: "0", invoiceDiscountTotal: "0", subtotal: "1000.000000", taxableTotal: "1000.000000", taxTotal: "140.000000", grandTotal: "1140.000000" },
    ...overrides,
    baseGrandTotal: overrides.baseGrandTotal ?? overrides.totals?.grandTotal ?? "1140.000000",
  };
}

const salesInvoiceTile = salesInvoice({
  id: "inv-2",
  docNo: "INV-000200",
  lines: [
    {
      unitCode: "", unitFactor: 1, discountType: "percent", discountAmount: "0.000000", costCenterId: null, taxRateId: null, baseQty: "8.000000", lineId: "l1", itemId: "item-tile", itemNameAr: "بلاط", isStock: true, qty: "8.000000",
      unitPrice: "75.000000", discountPercent: 0, taxRatePercent: 14, revenueAccountId: "acc-rev",
      cogsAccountId: "acc-cogs", inventoryAccountId: "acc-inv", unitCost: "60.000000",
    },
  ],
});

function salesReturn(overrides: Partial<SalesReturnDocumentDTO> = {}): SalesReturnDocumentDTO {
  return {
    id: "sr-1",
    docType: "SALES_RETURN",
    docNo: "SR-000001",
    date: "2026-08-20",
    memo: "",
    status: "draft",
    lines: [
      {
        itemId: "item-cement", warehouseId: "MAIN-WH", customerId: "cust-1", sourceInvoiceId: "inv-1",
        sourceInvoiceNumber: "INV-000123", reason: "DEFECTIVE", availableQty: "10.000000", qty: "2.000000",
        unitPrice: "100.000000", unitCost: "85.000000", taxAmount: "28.000000",
      },
    ],
    createdAt: "2026-08-20T09:00:00.000Z",
    confirmedAt: null,
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    awaitingRefund: false,
    refundDue: "0",
    refundedTotal: "0",
    refunds: [],
    ...overrides,
  };
}

function baseHandlers(
  returns: SalesReturnDocumentDTO[],
  invoices: SalesInvoiceDTO[] = [salesInvoice()],
  /** What the SERVER says confirmed returns already took, by invoice line. */
  returnedByLine: Record<string, string> = {},
) {
  return {
    "GET /sales-returns/source-lines/*": (_init: unknown, path: string) => {
      const invoice = invoices.find((i) => i.id === decodeURIComponent(path.split("/").pop()!.split("?")[0]!));
      if (!invoice) return { status: 404, body: { error: "SOURCE_INVOICE_NOT_FOUND" } };
      return {
        body: {
          sourceInvoiceId: invoice.id,
          lines: invoice.lines.map((l) => ({ sourceLineId: l.lineId, itemId: l.itemId, soldQty: l.baseQty, returnedQty: returnedByLine[l.lineId] ?? "0" })),
        },
      };
    },
    "GET /sales-invoices": () => ({ body: invoices }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /customers": () => ({ body: customers }),
    "GET /items": () => ({ body: items }),
    "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
    "GET /sales-returns": () => ({ body: returns }),
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

describe("SalesReturnsScreen", () => {
  it("shows the empty state when there are no returns", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "مرتجعات المبيعات" })).toBeInTheDocument();
    expect(await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً")).toBeInTheDocument();
  });

  it("shows a retry control when the return list fails to load", async () => {
    const transport = stubTransport({
      ...baseHandlers([]),
      "GET /sales-returns": () => ({ status: 500, body: { error: "INTERNAL" } }),
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل مرتجعات المبيعات. (رمز 500)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("lists sales returns from the real API", async () => {
    const transport = stubTransport(baseHandlers([salesReturn()]));
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("SR-000001")).toBeInTheDocument();
    expect(screen.getByText("شركة الأمل للتجارة")).toBeInTheDocument();
  });

  it("creates a draft return against a confirmed sales invoice", async () => {
    let current: SalesReturnDocumentDTO[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /sales-returns": () => ({ body: current }),
      "POST /sales-returns/from-invoice": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created = salesReturn({ id: body.id, docNo: null, status: "draft" });
        current = [...current, created];
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    // Two buttons share this label: the header action and the empty-state's own action.
    const [newButton] = screen.getAllByRole("button", { name: "مرتجع جديد" });
    fireEvent.click(newButton as HTMLElement);
    // Create is a sub-page, not a dialog: the list is replaced, not overlaid.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ كمسودة" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("شركة الأمل للتجارة")).toBeInTheDocument();
  });

  it("confirms a draft return, then voids it with a reason through its own route", async () => {
    let current: SalesReturnDocumentDTO[] = [salesReturn()];
    const voidBodies: unknown[] = [];
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /sales-returns": () => ({ body: current }),
      "POST /sales-returns/sr-1/confirm": () => {
        current = current.map((d) => (d.id === "sr-1" ? { ...d, status: "confirmed" as const, docNo: "SR-000001", confirmedAt: "2026-08-20T10:00:00.000Z" } : d));
        return { body: { document: current[0], held: false } };
      },
      "POST /sales-returns/sr-1/void": (init) => {
        voidBodies.push(JSON.parse((init?.body as string) ?? "{}"));
        current = current.map((d) => (d.id === "sr-1" ? { ...d, status: "reversed" as const, voidReason: "خطأ" } : d));
        return { body: current[0] };
      },
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("SR-000001"));
    // The detail is a sub-page, not a dialog: the list is replaced, not overlaid.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await screen.findByRole("heading", { name: "SR-000001" });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد المرتجع" }));
    expect(await screen.findByRole("button", { name: "إلغاء المرتجع" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء المرتجع" }));
    expect(voidBodies).toEqual([]);
    fireEvent.change(screen.getByLabelText("سبب الإلغاء"), { target: { value: "خطأ" } });
    fireEvent.click(screen.getAllByRole("button", { name: "إلغاء المرتجع" }).at(-1)!);
    await waitFor(() => expect(screen.getByText("معكوس")).toBeInTheDocument());
    expect(voidBodies).toEqual([{ reason: "خطأ" }]);
    expect(screen.getByRole("note")).toHaveTextContent("سبب الإلغاء: خطأ");
  });

  it("picking a two-line invoice and editing quantities, then adding and removing a second line, reaches the request with real per-item quantities", async () => {
    let createdBody: Record<string, unknown> | undefined;
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /sales-returns/from-invoice": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        const created = salesReturn({ id: (createdBody as { id: string }).id, docNo: null, status: "draft" });
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    // The seeded invoice's first stock line (أسمنت بورتلاندي) is the default single line — bump its qty.
    fireEvent.change(qtyInputAt(0), { target: { value: "4" } });

    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    selectOptionAt("الصنف", 1, "طوب أحمر");
    fireEvent.change(qtyInputAt(1), { target: { value: "2" } });
    selectOptionAt("سبب البند", 1, "صنف خاطئ");

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(createdBody).toBeDefined());
    const requested = createdBody!.requested as Array<Record<string, unknown>>;
    expect(requested).toEqual([
      { itemId: "item-cement", sourceLineId: "l1", qty: "4", reason: "DEFECTIVE" },
      { itemId: "item-brick", sourceLineId: "l2", qty: "2", reason: "WRONG_ITEM" },
    ]);
    expect(createdBody!.sourceInvoiceId).toBe("inv-1");
  });

  it("«إضافة بند» starts the new row on the next invoice line once the rows above take the whole of the first — never the same line twice by default", async () => {
    let createdBody: Record<string, unknown> | undefined;
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /sales-returns/from-invoice": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        const created = salesReturn({ id: (createdBody as { id: string }).id, docNo: null, status: "draft" });
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    // أسمنت بورتلاندي was sold 10: returning all 10 leaves that line nothing.
    fireEvent.change(qtyInputAt(0), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    fireEvent.change(qtyInputAt(1), { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(createdBody).toBeDefined());
    const requested = createdBody!.requested as Array<Record<string, unknown>>;
    expect(requested.map((r) => [r.itemId, r.sourceLineId, r.qty])).toEqual([
      ["item-cement", "l1", "10"],
      ["item-brick", "l2", "2"],
    ]);
  });

  it("clearing a quantity and pressing «إضافة بند» adds a row instead of crashing the form — an empty field takes nothing from its line (D79 round 4)", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    fireEvent.change(qtyInputAt(0), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));

    expect(screen.getAllByText("الكمية")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "مرتجع مبيعات جديد" })).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: "الصنف" }).map((c) => c.textContent)).toEqual(["أسمنت بورتلاندي", "أسمنت بورتلاندي"]);
  });

  it("starts a new row from what the SERVER says is left of each invoice line, not from the returns the list happens to show (D79 round 4)", async () => {
    let createdBody: Record<string, unknown> | undefined;
    let served = false;
    const handlers = baseHandlers([], [salesInvoice()], { l1: "10" });
    const transport = stubTransport({
      // The list is filtered down to nothing, while the server knows أسمنت's line is fully returned.
      ...handlers,
      "GET /sales-returns/source-lines/*": (init, path) => {
        served = true;
        return handlers["GET /sales-returns/source-lines/*"](init, path);
      },
      "POST /sales-returns/from-invoice": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: salesReturn({ id: (createdBody as { id: string }).id, docNo: null, status: "draft" }) };
      },
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });
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
    const handlers = baseHandlers([], [salesInvoice()], {});
    const transport = stubTransport({
      ...handlers,
      "GET /sales-returns/source-lines/*": (init, path) =>
        fail ? { status: 500, body: { error: "INTERNAL", message: "خطأ داخلي" } } : handlers["GET /sales-returns/source-lines/*"](init, path),
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("تعذّر قراءة ما تبقّى من بنود الفاتورة");
    for (const name of ["إضافة بند", "حفظ كمسودة", "حفظ وتأكيد"]) expect(screen.getByRole("button", { name })).toBeDisabled();

    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "إضافة بند" })).toBeEnabled());
    for (const name of ["حفظ كمسودة", "حفظ وتأكيد"]) expect(screen.getByRole("button", { name })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("removing a line drops only that item from the request, leaving the survivor's own qty and reason untouched", async () => {
    let createdBody: Record<string, unknown> | undefined;
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /sales-returns/from-invoice": (init) => {
        createdBody = JSON.parse((init?.body as string) ?? "{}");
        const created = salesReturn({ id: (createdBody as { id: string }).id, docNo: null, status: "draft" });
        return { status: 201, body: created };
      },
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    fireEvent.change(qtyInputAt(0), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة بند" }));
    selectOptionAt("الصنف", 1, "طوب أحمر");
    fireEvent.change(qtyInputAt(1), { target: { value: "6" } });

    // Delete the FIRST line (أسمنت) — the survivor is طوب أحمر, qty 6, untouched by the removal.
    fireEvent.click(screen.getAllByRole("button", { name: "حذف" })[0]!);

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    await waitFor(() => expect(createdBody).toBeDefined());
    const requested = createdBody!.requested as Array<Record<string, unknown>>;
    expect(requested).toEqual([{ itemId: "item-brick", sourceLineId: "l2", qty: "6", reason: "DEFECTIVE" }]);
  });

  it("switching the source invoice repopulates the returnable lines from the NEWLY picked invoice, not the stale one", async () => {
    const transport = stubTransport(baseHandlers([], [salesInvoice(), salesInvoiceTile]));
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    // Defaults to the first invoice — أسمنت بورتلاندي is a real, selectable option.
    fireEvent.click(screen.getByRole("combobox", { name: "الصنف" }));
    expect(screen.getByRole("option", { name: "أسمنت بورتلاندي" })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    selectOptionAt("فاتورة المصدر *", 0, "INV-000200 — شركة الأمل للتجارة");

    fireEvent.click(screen.getByRole("combobox", { name: "الصنف" }));
    expect(screen.getByRole("option", { name: "بلاط" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "أسمنت بورتلاندي" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "طوب أحمر" })).not.toBeInTheDocument();

    // The line's own SELECTED value must also reset to the new invoice's item —
    // not just its list of choices — or a stale line stays pointed at an item
    // that no longer belongs to the picked invoice.
    expect(screen.getByRole("combobox", { name: "الصنف" })).toHaveTextContent("بلاط");
    expect(screen.getByRole("combobox", { name: "الصنف" })).not.toHaveTextContent("أسمنت بورتلاندي");
  });

  it("a rejected confirm leaves the return reading as its prior status — no un-reverted optimistic flip", async () => {
    const current: SalesReturnDocumentDTO[] = [salesReturn()];
    const transport = stubTransport({
      ...baseHandlers(current),
      "POST /sales-returns/sr-1/confirm": () => ({ status: 409, body: { message: "الفترة المحاسبية مقفلة." } }),
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("SR-000001"));
    await screen.findByRole("heading", { name: "SR-000001" });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد المرتجع" }));

    expect(await screen.findByText("الفترة المحاسبية مقفلة.")).toBeInTheDocument();
    // Still a draft: the confirm/cancel pair is still on screen, not the confirmed-only إلغاء المرتجع button.
    expect(screen.getByRole("button", { name: "تأكيد المرتجع" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إلغاء المرتجع" })).not.toBeInTheDocument();
  });

  it("blocks submitting a refund with no treasury chosen, with an Arabic message and no request sent", async () => {
    const doc = salesReturn({ status: "confirmed", awaitingRefund: true, refundDue: "228.000000", confirmedAt: "2026-08-20T10:00:00.000Z" });
    let refundCalled = false;
    const transport = stubTransport({
      ...baseHandlers([doc]),
      "GET /treasury-accounts": () => ({ body: [] }),
      "POST /sales-returns/sr-1/refund": () => {
        refundCalled = true;
        return { body: { ...doc, voucherId: "v-1", voucherNo: "PV-1" } };
      },
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("SR-000001"));
    await screen.findByRole("heading", { name: "SR-000001" });
    fireEvent.click(screen.getByRole("button", { name: "استرداد للعميل" }));
    expect(await screen.findByText("اختر الخزينة التي يخرج منها المبلغ.")).toBeInTheDocument();
    expect(refundCalled).toBe(false);
  });

  it("refunds the real refund-due amount against the real treasury id, and a rejected refund shows the server's message without a false success note", async () => {
    const doc = salesReturn({ status: "confirmed", awaitingRefund: true, refundDue: "228.000000", confirmedAt: "2026-08-20T10:00:00.000Z" });
    let refundBody: Record<string, unknown> | undefined;
    const transport = stubTransport({
      ...baseHandlers([doc]),
      "POST /sales-returns/sr-1/refund": (init) => {
        refundBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 409, body: { message: "لا يمكن الاسترداد قبل إغلاق الوردية." } };
      },
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("SR-000001"));
    await screen.findByRole("heading", { name: "SR-000001" });
    fireEvent.click(screen.getByRole("button", { name: "استرداد للعميل" }));

    expect(await screen.findByText("لا يمكن الاسترداد قبل إغلاق الوردية.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/تم إنشاء سند الصرف/)).not.toBeInTheDocument());
    expect(refundBody).toEqual({ amount: "228.000000", treasuryAccountId: "treas-1", paymentMethod: "cash", date: "2026-08-20" });
  });

  it("the row action menu offers only the actions valid for each return's own status: confirm/cancel on a draft, void+refund on an awaiting-refund confirmed return, neither on a cancelled one", async () => {
    const draft = salesReturn({ id: "sr-draft", docNo: "SR-000010", status: "draft" });
    const confirmedAwaiting = salesReturn({ id: "sr-confirmed", docNo: "SR-000011", status: "confirmed", awaitingRefund: true, refundDue: "50.000000" });
    const cancelled = salesReturn({ id: "sr-cancelled", docNo: "SR-000012", status: "cancelled" });
    const transport = stubTransport(baseHandlers([draft, confirmedAwaiting, cancelled]));
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("SR-000010");

    const rows = screen.getAllByRole("row").slice(1);
    const [rowDraft, rowConfirmed, rowCancelled] = rows;

    fireEvent.click(within(rowDraft!).getByRole("button", { name: /^إجراءات/ }));
    expect(await screen.findByRole("menuitem", { name: "تأكيد المرتجع" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "إلغاء" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "إلغاء المرتجع" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(within(rowConfirmed!).getByRole("button", { name: /^إجراءات/ }));
    expect(await screen.findByRole("menuitem", { name: "إلغاء المرتجع" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "استرداد للعميل" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "تأكيد المرتجع" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "إلغاء" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(within(rowCancelled!).getByRole("button", { name: /^إجراءات/ }));
    expect(await screen.findByRole("menuitem", { name: "عرض المرتجع" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "تأكيد المرتجع" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "إلغاء المرتجع" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "استرداد للعميل" })).not.toBeInTheDocument();
  });

  it("the customer filter, date range and awaiting-refund chip each change the outgoing list request's query string", async () => {
    let lastPath = "";
    const transport = stubTransport({
      ...baseHandlers([salesReturn()]),
      "GET /sales-returns": (_init, path) => {
        lastPath = path;
        return { body: [salesReturn()] };
      },
    });
    renderWithProviders(<TestNavigation><SalesReturnsScreen /></TestNavigation>, { transport, initialSession: testAdminSession });
    await screen.findByText("SR-000001");
    // The filter bar defaults open whenever the screen supplies `filterBarExtra` — no toggle click needed.

    // The customer filter's EntityPicker is only given a `placeholder`, not a `label`
    // or a forwarded `aria-label` — the combobox has no accessible name, so it can
    // only be reached by its placeholder text, not by role+name like every other
    // combobox in this app.
    const customerInput = screen.getByPlaceholderText("تصفية بالعميل");
    fireEvent.focus(customerInput);
    fireEvent.change(customerInput, { target: { value: "شركة الأمل" } });
    fireEvent.mouseDown(screen.getByRole("button", { name: (n) => n.startsWith("شركة الأمل") }));
    await waitFor(() => expect(lastPath).toContain("customerId=cust-1"));

    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(lastPath).toContain("fromDate=2026-08-01"));

    fireEvent.click(screen.getByRole("button", { name: "بانتظار دفع المبلغ" }));
    await waitFor(() => expect(lastPath).toContain("awaitingRefund=true"));
  });
});
