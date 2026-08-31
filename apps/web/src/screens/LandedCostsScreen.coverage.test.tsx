// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ItemDTO, LandedCostDocumentDTO, PurchaseInvoiceDTO, WarehouseDTO } from "@mezan/contracts";
import { LandedCostsScreen } from "./LandedCostsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const warehouses: WarehouseDTO[] = [
  { id: "MAIN-WH", code: "MAIN-WH", name: "مستودع الفرع الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true },
  { id: "TRANSIT-WH", code: "TRANSIT-WH", name: "مستودع العبور", nameEn: null, branchId: "MAIN", type: "TRANSIT", isDefault: false, active: true },
];

function item(id: string, nameAr: string): ItemDTO {
  return {
    id, code: id, nameAr, nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [],
    costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true,
    trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null,
    revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  };
}

const items: ItemDTO[] = [item("item-cement", "أسمنت بورتلاندي"), item("item-steel", "حديد تسليح")];

function purchaseInvoice(overrides: Partial<PurchaseInvoiceDTO> = {}): PurchaseInvoiceDTO {
  return {
    id: "pi-1",
    number: "PI-000001",
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
      { itemId: "item-steel", description: null, kind: "inventory", qty: "5.000000", unitCost: "300.000000", taxRatePercent: 14, batchNo: null, expiryDate: null },
    ],
    status: "confirmed",
    subtotal: "3200.000000",
    tax: "448.000000",
    total: "3648.000000",
    amountPaid: "0.000000",
    remainingBalance: "3648.000000",
    createdBy: "محمد الشهابي",
    createdAt: "2026-08-20T09:30:00.000Z",
    ...overrides,
  };
}

function landedCost(overrides: Partial<LandedCostDocumentDTO> = {}): LandedCostDocumentDTO {
  return {
    id: "lc-1",
    docType: "LANDED_COST",
    docNo: "LC-000001",
    date: "2026-08-21",
    memo: "",
    status: "draft",
    lines: [
      {
        itemId: "item-cement", warehouseId: "MAIN-WH", sourceInvoiceId: "pi-1", sourceInvoiceNumber: "PI-000001",
        qty: "20.000000", unitCost: "85.000000", weight: "0.000000", allocatedAmount: "200.000000", newUnitCost: "95.000000",
        distributionMethod: "BY_VALUE", costItems: [{ costType: "SHIPPING", description: "شحن", amount: "200.000000" }],
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

function baseHandlers(docs: LandedCostDocumentDTO[], invoices: PurchaseInvoiceDTO[] = [purchaseInvoice()]) {
  return {
    "GET /purchases/invoices": () => ({ body: invoices }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": () => ({ body: items }),
    "GET /landed-costs": () => ({ body: docs }),
  };
}

function mount(handlers: Record<string, unknown>) {
  const transport = stubTransport(handlers as Parameters<typeof stubTransport>[0]);
  renderWithProviders(<LandedCostsScreen />, { transport, initialSession: testAdminSession });
  return transport;
}

async function openCreatePanel() {
  fireEvent.click((await screen.findAllByRole("button", { name: "مستند تكلفة جديد" }))[0]!);
  return screen.getByRole("dialog", { name: "مستند تكلفة إضافية جديد" });
}

function pick(scope: HTMLElement, label: string, optionLabel: string) {
  fireEvent.click(within(scope).getByRole("combobox", { name: label }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

function pickNth(scope: HTMLElement, label: string, index: number, optionLabel: string) {
  fireEvent.click(within(scope).getAllByRole("combobox", { name: label })[index]!);
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

describe("LandedCostsScreen — narrowing a long register", () => {
  const docs = [
    landedCost(),
    landedCost({
      id: "lc-2", docNo: "LC-000002", date: "2026-09-05", status: "confirmed", confirmedAt: "2026-09-05T10:00:00.000Z",
      lines: [{
        itemId: "item-steel", warehouseId: "TRANSIT-WH", sourceInvoiceId: "pi-2", sourceInvoiceNumber: "PI-000002",
        qty: "5.000000", unitCost: "300.000000", weight: "40.000000", allocatedAmount: "500.000000", newUnitCost: "400.000000",
        distributionMethod: "BY_WEIGHT", costItems: [{ costType: "CUSTOMS", description: "جمارك", amount: "500.000000" }],
      }],
    }),
  ];

  it("narrows to the warehouse the goods actually landed in", async () => {
    mount(baseHandlers(docs));
    await screen.findByText("LC-000001");

    pick(document.body, "المستودع", "مستودع العبور");

    await waitFor(() => expect(screen.queryByText("LC-000001")).not.toBeInTheDocument());
    expect(screen.getByText("LC-000002")).toBeInTheDocument();
  });

  it("narrows to one kind of cost, so a customs review skips the freight documents", async () => {
    mount(baseHandlers(docs));
    await screen.findByText("LC-000001");

    pick(document.body, "النوع", "جمارك");

    await waitFor(() => expect(screen.queryByText("LC-000001")).not.toBeInTheDocument());
    expect(screen.getByText("LC-000002")).toBeInTheDocument();
  });

  it("narrows to one distribution basis", async () => {
    mount(baseHandlers(docs));
    await screen.findByText("LC-000001");

    pick(document.body, "طريقة التوزيع", "حسب الوزن");

    await waitFor(() => expect(screen.queryByText("LC-000001")).not.toBeInTheDocument());
    expect(screen.getByText("LC-000002")).toBeInTheDocument();
  });

  it("bounds the register by each date end independently", async () => {
    mount(baseHandlers(docs));
    await screen.findByText("LC-000001");

    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-09-01" } });
    await waitFor(() => expect(screen.queryByText("LC-000001")).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "2026-08-31" } });
    await waitFor(() => expect(screen.queryByText("LC-000002")).not.toBeInTheDocument());
    expect(screen.getByText("LC-000001")).toBeInTheDocument();
  });

  it("finds a document by its own number and by the invoice it funds", async () => {
    mount(baseHandlers(docs));
    const search = await screen.findByRole("searchbox");

    fireEvent.change(search, { target: { value: "LC-000002" } });
    await waitFor(() => expect(screen.queryByText("LC-000001")).not.toBeInTheDocument());

    fireEvent.change(search, { target: { value: "PI-000001" } });
    await waitFor(() => expect(screen.queryByText("LC-000002")).not.toBeInTheDocument());
    expect(screen.getByText("LC-000001")).toBeInTheDocument();
  });

  it("narrows by status chip", async () => {
    mount(baseHandlers(docs));
    await screen.findByText("LC-000001");

    fireEvent.click(screen.getByRole("tab", { name: /مؤكد/ }));
    await waitFor(() => expect(screen.queryByText("LC-000001")).not.toBeInTheDocument());
    expect(screen.getByText("LC-000002")).toBeInTheDocument();
  });

  it("falls back to a dash for a warehouse and an invoice the registers no longer hold", async () => {
    mount(
      baseHandlers([
        landedCost({
          lines: [{
            itemId: "item-gone", warehouseId: "wh-gone", sourceInvoiceId: "pi-gone", sourceInvoiceNumber: null,
            qty: "1.000000", unitCost: "10.000000", weight: "0.000000", allocatedAmount: "5.000000", newUnitCost: "15.000000",
            distributionMethod: "BY_VALUE", costItems: [],
          }],
        }),
      ]),
    );

    const row = (await screen.findByText("LC-000001")).closest("tr")!;
    expect(within(row).getAllByText("—")).toHaveLength(2);
  });

  it("offers a retry when the register itself fails to load", async () => {
    let attempts = 0;
    mount({
      ...baseHandlers([]),
      "GET /landed-costs": () => {
        attempts += 1;
        return attempts === 1 ? { status: 500, body: { error: "BOOM" } } : { body: [landedCost()] };
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "إعادة المحاولة" }));
    expect(await screen.findByText("LC-000001")).toBeInTheDocument();
  });
});

describe("LandedCostsScreen — the basis the cost is split by", () => {
  it("splits by value, so the more expensive line absorbs the larger share", async () => {
    mount(baseHandlers([]));
    const dialog = await openCreatePanel();

    fireEvent.change(within(dialog).getAllByRole("spinbutton")[0]!, { target: { value: "320" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة صنف" }));
    pickNth(dialog, "الصنف", 1, "حديد تسليح");

    await within(dialog).findByText("معاينة التوزيع");
    const rows = within(dialog).getAllByRole("row");
    // 20 × 85 = 1,700 against 5 × 300 = 1,500: the cement line takes the larger share.
    expect(within(rows[0]!).getByText("170.00")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("150.00")).toBeInTheDocument();
  });

  it("splits by quantity, so the line with more units absorbs the larger share regardless of price", async () => {
    mount(baseHandlers([]));
    const dialog = await openCreatePanel();

    pick(dialog, "طريقة التوزيع *", "حسب الكمية");
    fireEvent.change(within(dialog).getAllByRole("spinbutton")[0]!, { target: { value: "250" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة صنف" }));
    pickNth(dialog, "الصنف", 1, "حديد تسليح");

    await within(dialog).findByText("معاينة التوزيع");
    const rows = within(dialog).getAllByRole("row");
    // 20 units against 5: 25 units in all, 10 EGP each.
    expect(within(rows[0]!).getByText("200.00")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("50.00")).toBeInTheDocument();
  });

  it("warns that a weight basis needs a weight, and drops the warning once one is entered", async () => {
    mount(baseHandlers([]));
    const dialog = await openCreatePanel();

    pick(dialog, "طريقة التوزيع *", "حسب الوزن");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("التوزيع حسب الوزن يحتاج وزناً أكبر من صفر");

    fireEvent.change(within(dialog).getByLabelText("الوزن"), { target: { value: "40" } });
    await waitFor(() => expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows a weight field only on the weight basis", async () => {
    mount(baseHandlers([]));
    const dialog = await openCreatePanel();

    expect(within(dialog).queryByLabelText("الوزن")).not.toBeInTheDocument();
    pick(dialog, "طريقة التوزيع *", "حسب الوزن");
    expect(within(dialog).getByLabelText("الوزن")).toBeInTheDocument();
  });
});

describe("LandedCostsScreen — the cost lines and the targets", () => {
  it("groups the cost by type once each line carries an amount", async () => {
    mount(baseHandlers([]));
    const dialog = await openCreatePanel();

    fireEvent.change(within(dialog).getAllByRole("spinbutton")[0]!, { target: { value: "200" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة بند" }));

    const amounts = within(dialog).getAllByLabelText("المبلغ");
    fireEvent.change(amounts[1]!, { target: { value: "500" } });
    pickNth(dialog, "النوع", 1, "جمارك");

    const breakdown = (await within(dialog).findByText("التكلفة حسب النوع")).parentElement!;
    expect(within(breakdown).getByText("شحن")).toBeInTheDocument();
    expect(within(breakdown).getByText("جمارك")).toBeInTheDocument();
    expect(within(dialog).getAllByText("700.00").length).toBeGreaterThan(0);
  });

  it("refuses to remove the only cost line or the only target", async () => {
    mount(baseHandlers([]));
    const dialog = await openCreatePanel();

    for (const button of within(dialog).getAllByRole("button", { name: "حذف" })) {
      expect(button).toBeDisabled();
    }
  });

  it("removes an added cost line again", async () => {
    mount(baseHandlers([]));
    const dialog = await openCreatePanel();

    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة بند" }));
    expect(within(dialog).getAllByLabelText("المبلغ")).toHaveLength(2);

    fireEvent.click(within(dialog).getAllByRole("button", { name: "حذف" })[1]!);
    expect(within(dialog).getAllByLabelText("المبلغ")).toHaveLength(1);
  });

  it("pulls the quantity and cost from the invoice line when a target's item is changed", async () => {
    mount(baseHandlers([]));
    const dialog = await openCreatePanel();

    expect(within(dialog).getByLabelText("الكمية")).toHaveValue(20);
    pick(dialog, "الصنف", "حديد تسليح");

    expect(within(dialog).getByLabelText("الكمية")).toHaveValue(5);
    expect(within(dialog).getByLabelText("التكلفة الحالية")).toHaveValue(300);
  });

  it("says an invoice has no stock lines, and refuses to add a target against it", async () => {
    mount(
      baseHandlers([], [
        purchaseInvoice({
          lines: [{ itemId: null, description: "شحن", kind: "expense", qty: "1.000000", unitCost: "50.000000", taxRatePercent: 0, batchNo: null, expiryDate: null }],
        }),
      ]),
    );
    const dialog = await openCreatePanel();

    expect(within(dialog).getByText("لا توجد أصناف مخزنية في هذه الفاتورة")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "إضافة صنف" })).toBeDisabled();
  });

  it("re-seeds the target from whichever invoice is chosen", async () => {
    mount(
      baseHandlers([], [
        purchaseInvoice(),
        purchaseInvoice({
          id: "pi-2", number: "PI-000002",
          lines: [{ itemId: "item-steel", description: null, kind: "inventory", qty: "7.000000", unitCost: "310.000000", taxRatePercent: 14, batchNo: null, expiryDate: null }],
        }),
      ]),
    );
    const dialog = await openCreatePanel();

    pick(dialog, "الفاتورة المرتبطة *", "PI-000002");
    expect(within(dialog).getByLabelText("الكمية")).toHaveValue(7);
    expect(within(dialog).getByLabelText("التكلفة الحالية")).toHaveValue(310);
  });
});

describe("LandedCostsScreen — what a save refuses", () => {
  it("refuses a document with no invoice behind it", async () => {
    mount(baseHandlers([], []));
    const dialog = await openCreatePanel();

    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(await within(dialog).findByText("اختر الفاتورة المرتبطة والمستودع.")).toBeInTheDocument();
  });

  it("refuses a document whose only cost line is worth nothing", async () => {
    mount(baseHandlers([]));
    const dialog = await openCreatePanel();

    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(
      await within(dialog).findByText("أضف بند تكلفة واحداً على الأقل وصنفاً مستهدفاً واحداً على الأقل."),
    ).toBeInTheDocument();
  });

  it("surfaces the server's own refusal rather than closing the panel", async () => {
    mount({
      ...baseHandlers([]),
      "POST /landed-costs": () => ({ status: 422, body: { error: "CLOSED_PERIOD", message: "الفترة المحاسبية مقفلة." } }),
    });
    const dialog = await openCreatePanel();

    fireEvent.change(within(dialog).getAllByRole("spinbutton")[0]!, { target: { value: "200" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await within(dialog).findByText("الفترة المحاسبية مقفلة.")).toBeInTheDocument();
  });

  it("saves and confirms in one action, sending the entered cost and target verbatim", async () => {
    let posted: Record<string, unknown> | null = null;
    let confirmed = false;
    mount({
      ...baseHandlers([]),
      "POST /landed-costs": (init?: RequestInit) => {
        posted = JSON.parse((init?.body as string) ?? "{}") as Record<string, unknown>;
        return { status: 201, body: landedCost({ id: "lc-new", docNo: null }) };
      },
      "POST /landed-costs/lc-new/confirm": () => {
        confirmed = true;
        return { body: { document: landedCost({ id: "lc-new", status: "confirmed" }), held: false } };
      },
    });
    const dialog = await openCreatePanel();

    fireEvent.change(within(dialog).getByLabelText("الوصف"), { target: { value: "شحن بحري" } });
    fireEvent.change(within(dialog).getAllByRole("spinbutton")[0]!, { target: { value: "320" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ وتأكيد التوزيع" }));

    await waitFor(() => expect(confirmed).toBe(true));
    expect(posted).toMatchObject({
      distributionMethod: "BY_VALUE",
      costItems: [{ costType: "SHIPPING", description: "شحن بحري", amount: "320" }],
      targets: [{ itemId: "item-cement", warehouseId: "MAIN-WH", sourceInvoiceId: "pi-1", sourceInvoiceNumber: "PI-000001", qty: "20", unitCost: "85", weight: "0" }],
    });
  });
});

describe("LandedCostsScreen — an existing document", () => {
  it("shows a confirmed document's per-type breakdown, its weight and only the void action", async () => {
    mount(
      baseHandlers([
        landedCost({
          status: "confirmed",
          confirmedAt: "2026-08-22T10:00:00.000Z",
          lines: [{
            itemId: "item-steel", warehouseId: "MAIN-WH", sourceInvoiceId: "pi-1", sourceInvoiceNumber: "PI-000001",
            qty: "5.000000", unitCost: "300.000000", weight: "40.000000", allocatedAmount: "500.000000", newUnitCost: "400.000000",
            distributionMethod: "BY_WEIGHT", costItems: [{ costType: "CUSTOMS", description: "جمارك", amount: "500.000000" }],
          }],
        }),
      ]),
    );
    fireEvent.click(await screen.findByText("LC-000001"));
    const dialog = screen.getByRole("dialog", { name: "LC-000001" });

    expect(within(dialog).getByText("حسب الوزن")).toBeInTheDocument();
    expect(within(dialog).getByText("جمارك")).toBeInTheDocument();
    expect(within(dialog).getByText("حديد تسليح", { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "إلغاء المستند" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "تأكيد التوزيع" })).not.toBeInTheDocument();
  });

  it("shows no per-type breakdown for a document that carries no cost items", async () => {
    mount(
      baseHandlers([
        landedCost({
          lines: [{
            itemId: "item-cement", warehouseId: "MAIN-WH", sourceInvoiceId: "pi-1", sourceInvoiceNumber: "PI-000001",
            qty: "20.000000", unitCost: "85.000000", weight: "0.000000", allocatedAmount: "0.000000", newUnitCost: "85.000000",
            distributionMethod: "BY_VALUE", costItems: [],
          }],
        }),
      ]),
    );
    fireEvent.click(await screen.findByText("LC-000001"));
    const dialog = screen.getByRole("dialog", { name: "LC-000001" });

    expect(within(dialog).queryByText("التكلفة حسب النوع")).not.toBeInTheDocument();
  });

  it("surfaces a refused confirmation in the detail panel rather than silently failing", async () => {
    mount({
      ...baseHandlers([landedCost()]),
      "POST /landed-costs/lc-1/confirm": () => ({ status: 422, body: { error: "CLOSED_PERIOD", message: "الفترة المحاسبية مقفلة." } }),
    });
    fireEvent.click(await screen.findByText("LC-000001"));
    const dialog = screen.getByRole("dialog", { name: "LC-000001" });

    fireEvent.click(within(dialog).getByRole("button", { name: "تأكيد التوزيع" }));
    expect(await within(dialog).findByText("الفترة المحاسبية مقفلة.")).toBeInTheDocument();
  });

  it("confirms a draft straight from its row menu without opening it", async () => {
    let current = [landedCost()];
    mount({
      ...baseHandlers(current),
      "GET /landed-costs": () => ({ body: current }),
      "POST /landed-costs/lc-1/confirm": () => {
        current = current.map((d) => ({ ...d, status: "confirmed" as const }));
        return { body: { document: current[0], held: false } };
      },
    });
    await screen.findByText("LC-000001");

    fireEvent.click(screen.getByRole("button", { name: /إجراءات/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "تأكيد التوزيع" }));

    const row = (await screen.findByText("LC-000001")).closest("tr")!;
    await waitFor(() => expect(within(row).getByText("مؤكد")).toBeInTheDocument());
  });
});

