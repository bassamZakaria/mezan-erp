// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CustomerDTO, ItemDTO, SalesReturnDocumentDTO, TreasuryAccountDTO, WarehouseDTO } from "@mezan/contracts";
import type { SalesInvoiceDTO } from "../data/hooks";
import { SalesReturnsScreen } from "./SalesReturnsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

function TestNavigation({ children, initialSegments = [] }: { children: ReactNode; initialSegments?: readonly string[] }) {
  const [segments, setSegments] = useState<readonly string[]>(initialSegments);
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
    priceListId: null, creditLimit: "0", taxExempt: false, etaBuyerType: "business", commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
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
    lines: [
      {
        lineId: "l1", itemId: "item-cement", itemNameAr: "أسمنت بورتلاندي", isStock: true, qty: "10.000000",
        unitPrice: "100.000000", discountPercent: 0, taxRatePercent: 14, revenueAccountId: "acc-rev",
        cogsAccountId: "acc-cogs", inventoryAccountId: "acc-inv", unitCost: "85.000000",
      },
    ],
    totals: { grossTotal: "1000.000000", lineDiscountTotal: "0", promotionDiscountTotal: "0", invoiceDiscountTotal: "0", subtotal: "1000.000000", taxableTotal: "1000.000000", taxTotal: "140.000000", grandTotal: "1140.000000" },
    ...overrides,
  };
}

/** A confirmed invoice with no stock line eligible for return — a service line only. */
const serviceInvoice = salesInvoice({
  id: "inv-service",
  docNo: null,
  lines: [
    {
      lineId: "s1", itemId: "item-cement", itemNameAr: "أسمنت بورتلاندي", isStock: false, qty: "1.000000",
      unitPrice: "300.000000", discountPercent: 0, taxRatePercent: 14, revenueAccountId: "acc-rev",
      cogsAccountId: null, inventoryAccountId: null, unitCost: null,
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

function baseHandlers(returns: SalesReturnDocumentDTO[], invoices: SalesInvoiceDTO[] = [salesInvoice()]) {
  return {
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

function render(returns: SalesReturnDocumentDTO[], extra: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> = {}, invoices: SalesInvoiceDTO[] = [salesInvoice()], initialSegments?: readonly string[]) {
  const transport = stubTransport({ ...baseHandlers(returns, invoices), ...extra });
  return renderWithProviders(
    <TestNavigation initialSegments={initialSegments}>
      <SalesReturnsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

describe("SalesReturnsScreen — an orphaned or missing source invoice", () => {
  it("falls back to the stored invoice number, or to the raw id when even that is missing", async () => {
    const storedFallback = salesReturn({
      id: "sr-stored", docNo: "SR-000050",
      lines: [
        {
          itemId: "item-cement", warehouseId: "MAIN-WH", customerId: "cust-1", sourceInvoiceId: "inv-old",
          sourceInvoiceNumber: "INV-OLD-777", reason: "DEFECTIVE", availableQty: "5.000000", qty: "1.000000",
          unitPrice: "100.000000", unitCost: "85.000000", taxAmount: "14.000000",
        },
      ],
    });
    const rawIdFallback = salesReturn({
      id: "sr-raw", docNo: "SR-000051",
      lines: [
        {
          itemId: "item-cement", warehouseId: "MAIN-WH", customerId: "cust-1", sourceInvoiceId: "inv-very-old",
          sourceInvoiceNumber: null, reason: "DEFECTIVE", availableQty: "5.000000", qty: "1.000000",
          unitPrice: "100.000000", unitCost: "85.000000", taxAmount: "14.000000",
        },
      ],
    });
    render([storedFallback, rawIdFallback]);

    await screen.findByText("SR-000050");
    expect(screen.getByText("INV-OLD-777")).toBeInTheDocument();
    expect(screen.getByText("inv-very-old")).toBeInTheDocument();

    fireEvent.click(screen.getByText("SR-000050"));
    expect(await screen.findByText("فاتورة المصدر: INV-OLD-777")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "عرض الفاتورة المصدر" })).toBeInTheDocument();
  });
});

describe("SalesReturnsScreen — a return with no lines", () => {
  it("shows placeholders in the list and detail without crashing, and offers no source-invoice action", async () => {
    const empty = salesReturn({ id: "sr-empty", docNo: "SR-000060", lines: [] });
    render([empty]);

    await screen.findByText("SR-000060");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    const rows = screen.getAllByRole("row").slice(1);
    fireEvent.click(within(rows[0]!).getByRole("button", { name: /^إجراءات/ }));
    expect(await screen.findByRole("menuitem", { name: "عرض المرتجع" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "عرض الفاتورة المصدر" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(screen.getByText("SR-000060"));
    expect(await screen.findByText("فاتورة المصدر: —")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "عرض الفاتورة المصدر" })).not.toBeInTheDocument();
  });
});

describe("SalesReturnsScreen — an unknown customer or item id on a return line", () => {
  it("falls back to the raw id instead of hiding the row", async () => {
    const ghost = salesReturn({
      id: "sr-ghost", docNo: "SR-000070",
      lines: [
        {
          itemId: "item-ghost", warehouseId: "MAIN-WH", customerId: "cust-ghost", sourceInvoiceId: "inv-1",
          sourceInvoiceNumber: "INV-000123", reason: "DEFECTIVE", availableQty: "5.000000", qty: "1.000000",
          unitPrice: "100.000000", unitCost: "85.000000", taxAmount: "14.000000",
        },
      ],
    });
    render([ghost]);

    await screen.findByText("SR-000070");
    expect(screen.getByText("cust-ghost")).toBeInTheDocument();

    fireEvent.click(screen.getByText("SR-000070"));
    expect(await screen.findByText("item-ghost")).toBeInTheDocument();
  });
});

describe("SalesReturnsScreen — a draft return with no return number yet", () => {
  it("opens by its raw id from a row click, showing the generic title in its heading", async () => {
    const noDocNo = salesReturn({ id: "sr-nodoc", docNo: null });
    render([noDocNo]);

    // «مسودة» shows twice on the row: the document-number column falls back to it for
    // an unnumbered draft, and the status pill carries it too. The number cell is first.
    const [numberCell] = await screen.findAllByText("مسودة");
    fireEvent.click(numberCell!);

    expect(await screen.findByRole("heading", { name: "مرتجع مبيعات" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تأكيد المرتجع" })).toBeInTheDocument();
  });
});

describe("SalesReturnsScreen — a sub-page id that matches no return", () => {
  it("falls back to the returns list instead of an empty detail view", async () => {
    const transport = stubTransport(baseHandlers([salesReturn()]));
    renderWithProviders(
      <TestNavigation initialSegments={["SR-DOES-NOT-EXIST"]}>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByRole("heading", { name: "مرتجعات المبيعات" })).toBeInTheDocument();
  });
});

describe("SalesReturnsScreen — pagination and the status filter", () => {
  it("resets to page one when the URL points past the last page", async () => {
    const transport = stubTransport(baseHandlers([salesReturn()]));
    renderWithProviders(
      <TestNavigation>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession, route: "/?page=5" },
    );
    expect(await screen.findByText("SR-000001")).toBeInTheDocument();
  });

  it("sends a chosen status chip beyond “all” as part of the outgoing list request", async () => {
    let lastPath = "";
    const transport = stubTransport({
      ...baseHandlers([salesReturn({ status: "confirmed", docNo: "SR-000002" })]),
      "GET /sales-returns/counts": () => ({ body: { all: 1, confirmed: 1 } }),
      "GET /sales-returns": (_init, path) => {
        lastPath = path;
        return { body: [salesReturn({ status: "confirmed", docNo: "SR-000002" })] };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("SR-000002");
    fireEvent.click(screen.getByRole("tab", { name: /^مؤكد/ }));
    await waitFor(() => expect(lastPath).toContain("status=confirmed"));
  });
});

describe("SalesReturnsScreen — creating a return with nothing configured to return against", () => {
  it("disables adding a line and refuses to save with an honest Arabic message", async () => {
    let posted = false;
    const transport = stubTransport({
      ...baseHandlers([], []),
      "GET /warehouses": () => ({ body: [] }),
      "POST /sales-returns/from-invoice": () => {
        posted = true;
        return { status: 201, body: salesReturn() };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    expect(screen.getByText("لا توجد أصناف مخزنية قابلة للإرجاع في هذه الفاتورة")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إضافة بند" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("اختر فاتورة المصدر والمستودع.")).toBeInTheDocument();
    expect(posted).toBe(false);
  });
});

describe("SalesReturnsScreen — switching to an invoice with nothing returnable", () => {
  it("clears the line grid and shows the no-returnable-items notice", async () => {
    const transport = stubTransport(baseHandlers([], [salesInvoice(), serviceInvoice]));
    renderWithProviders(
      <TestNavigation>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    expect(screen.getByRole("combobox", { name: "الصنف" })).toHaveTextContent("أسمنت بورتلاندي");
    // The service invoice has no docNo — the picker falls back to its raw id in the option label.
    selectOptionAt("فاتورة المصدر *", 0, "inv-service — شركة الأمل للتجارة");

    expect(screen.getByText("لا توجد أصناف مخزنية قابلة للإرجاع في هذه الفاتورة")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "الصنف" })).not.toBeInTheDocument();
  });
});

describe("SalesReturnsScreen — arriving already pointed at a source invoice", () => {
  it("seeds the line grid and the warehouse straight from the prefilled invoice, skipping the picker step", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(
      <TestNavigation initialSegments={["new", "inv-1"]}>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });
    // The heading paints before the invoice list lands; the pickers can only fill in after it.
    await waitFor(() => expect(screen.getByRole("combobox", { name: "فاتورة المصدر *" })).toHaveTextContent("INV-000123"));
    expect(screen.getByRole("combobox", { name: "الصنف" })).toHaveTextContent("أسمنت بورتلاندي");
    expect(screen.getByRole("combobox", { name: "المستودع *" })).toHaveTextContent("مستودع الفرع الرئيسي");
  });

  it("leaves the line grid empty when the prefilled invoice has nothing stock to return, or does not exist at all", async () => {
    const transport = stubTransport(baseHandlers([], [salesInvoice(), serviceInvoice]));
    renderWithProviders(
      <TestNavigation initialSegments={["new", "inv-service"]}>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });
    expect(screen.getByText("لا توجد أصناف مخزنية قابلة للإرجاع في هذه الفاتورة")).toBeInTheDocument();
  });

  it("does not crash when the prefilled invoice id does not exist", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(
      <TestNavigation initialSegments={["new", "inv-does-not-exist"]}>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" })).toBeInTheDocument();
    expect(screen.getByText("لا توجد أصناف مخزنية قابلة للإرجاع في هذه الفاتورة")).toBeInTheDocument();
  });
});

describe("SalesReturnsScreen — saving and confirming a new return in one step", () => {
  it("posts the draft, then confirms it, then returns to the list", async () => {
    let confirmedId: string | null = null;
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /sales-returns/from-invoice": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: salesReturn({ id: body.id, docNo: "SR-000099", status: "draft" }) };
      },
      "POST /sales-returns/sr-1/confirm": () => ({ status: 404, body: {} }),
      "POST /sales-returns/*/confirm": (_init, path) => {
        confirmedId = path.split("/")[2] ?? null;
        return { body: { document: salesReturn({ status: "confirmed" }), held: false } };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    fireEvent.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));

    await waitFor(() => expect(confirmedId).not.toBeNull());
    expect(await screen.findByRole("heading", { name: "مرتجعات المبيعات" })).toBeInTheDocument();
  });

  it("shows the server's Arabic refusal and keeps the create page open when the draft itself is rejected", async () => {
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /sales-returns/from-invoice": () => ({ status: 409, body: { message: "الكمية المطلوبة تتجاوز المتاح للإرجاع." } }),
    });
    renderWithProviders(
      <TestNavigation>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    expect(await screen.findByText("الكمية المطلوبة تتجاوز المتاح للإرجاع.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "مرتجع مبيعات جديد" })).toBeInTheDocument();
  });
});

describe("SalesReturnsScreen — a line grid with nothing left to return", () => {
  it("refuses to save when the only line's quantity is zeroed out", async () => {
    let posted = false;
    const transport = stubTransport({
      ...baseHandlers([]),
      "POST /sales-returns/from-invoice": () => {
        posted = true;
        return { status: 201, body: salesReturn() };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("لا توجد مرتجعات — أنشئ مرتجعاً جديداً");
    fireEvent.click(screen.getAllByRole("button", { name: "مرتجع جديد" })[0]!);
    await screen.findByRole("heading", { name: "مرتجع مبيعات جديد" });

    fireEvent.change(qtyInputAt(0), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    expect(await screen.findByText("أضف بنداً واحداً على الأقل بكمية أكبر من صفر.")).toBeInTheDocument();
    expect(posted).toBe(false);
  });
});

describe("SalesReturnsScreen — refunding a confirmed return", () => {
  it("shows the confirmation note, falling back to the voucher's id when the server gave it no number", async () => {
    const doc = salesReturn({ status: "confirmed", awaitingRefund: true, refundDue: "228.000000", confirmedAt: "2026-08-20T10:00:00.000Z" });
    const transport = stubTransport({
      ...baseHandlers([doc]),
      "POST /sales-returns/sr-1/refund": () => ({ body: { ...doc, voucherId: "v-99", voucherNo: null } }),
    });
    renderWithProviders(
      <TestNavigation>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    fireEvent.click(await screen.findByText("SR-000001"));
    await screen.findByRole("heading", { name: "SR-000001" });
    fireEvent.click(screen.getByRole("button", { name: "استرداد للعميل" }));

    expect(await screen.findByText("تم إنشاء سند الصرف v-99 وخرج المبلغ من الخزينة.")).toBeInTheDocument();
  });

  it("lists previously posted refund vouchers on the return", async () => {
    const doc = salesReturn({
      status: "confirmed",
      awaitingRefund: false,
      refundDue: "0",
      refunds: [{ voucherId: "v-1", voucherNo: "PV-000001", date: "2026-08-21", amount: "228.000000" }],
    });
    render([doc]);

    fireEvent.click(await screen.findByText("SR-000001"));
    await screen.findByRole("heading", { name: "SR-000001" });
    expect(screen.getByText("PV-000001")).toBeInTheDocument();
  });
});

describe("SalesReturnsScreen — a cancel request the server rejects", () => {
  it("surfaces the server's Arabic message and leaves the return as a draft", async () => {
    const transport = stubTransport({
      ...baseHandlers([salesReturn()]),
      "POST /sales-returns/sr-1/cancel": () => ({ status: 409, body: { message: "لا يمكن إلغاء مرتجع مرتبط بسند صرف." } }),
    });
    renderWithProviders(
      <TestNavigation>
        <SalesReturnsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    fireEvent.click(await screen.findByText("SR-000001"));
    await screen.findByRole("heading", { name: "SR-000001" });
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));

    expect(await screen.findByText("لا يمكن إلغاء مرتجع مرتبط بسند صرف.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تأكيد المرتجع" })).toBeInTheDocument();
  });
});
