// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import type { ItemDTO, PurchaseInvoiceDTO, PurchaseReturnDocumentDTO, SupplierDTO, WarehouseDTO } from "@mezan/contracts";
import { PurchaseReturnsScreen } from "./PurchaseReturnsScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import { NavigationProvider } from "../navigation";

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
    id: "sup-1", code: "S1", nameAr: "شركة النيل للتوريدات", nameEn: null, phone: null, email: null,
    contactPerson: null, taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP",
    openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null,
  },
];

const warehouses: WarehouseDTO[] = [
  { id: "MAIN-WH", code: "MAIN-WH", name: "مستودع الفرع الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true },
];

function item(id: string, code: string, nameAr: string): ItemDTO {
  return {
    id, code, nameAr, nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null,
    specifications: [], costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14,
    trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null,
    reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  };
}

const items: ItemDTO[] = [item("item-cement", "ITM-1", "أسمنت بورتلاندي"), item("item-brick", "ITM-2", "طوب أحمر")];

function purchaseInvoice(overrides: Partial<PurchaseInvoiceDTO> = {}): PurchaseInvoiceDTO {
  return {
    id: "pi-1", number: "PI-000001", supplierId: "sup-1", date: "2026-08-20", dueDate: "2026-09-04",
    supplierInvoiceNumber: null, branchId: "MAIN", warehouseId: "MAIN-WH", currency: "EGP", notes: null,
    receiptId: null,
    lines: [
      { itemId: "item-cement", description: null, kind: "inventory", qty: "20.000000", unitCost: "85.000000", taxRatePercent: 14, batchNo: null, expiryDate: null },
    ],
    status: "confirmed", subtotal: "1700.000000", tax: "238.000000", total: "1938.000000",
    amountPaid: "0.000000", remainingBalance: "1938.000000",
    createdBy: "محمد الشهابي", createdAt: "2026-08-20T09:30:00.000Z",
    ...overrides,
  };
}

function purchaseReturn(overrides: Partial<PurchaseReturnDocumentDTO> = {}): PurchaseReturnDocumentDTO {
  return {
    id: "pr-1", docType: "PURCHASE_RETURN", docNo: "PR-000001", date: "2026-08-21", memo: "", status: "draft",
    lines: [
      {
        itemId: "item-cement", warehouseId: "MAIN-WH", supplierId: "sup-1", sourceInvoiceId: "pi-1",
        sourceInvoiceNumber: "PI-000001", reason: "DEFECTIVE", availableQty: "20.000000", qty: "3.000000",
        unitCost: "85.000000", taxAmount: "35.700000",
      },
    ],
    createdAt: "2026-08-21T09:00:00.000Z", confirmedAt: null, reversesDocId: null, reversedByDocId: null,
    workflowRequestId: null, journalEntryId: null,
    ...overrides,
  };
}

type Handlers = Record<string, (init: RequestInit | undefined, path: string) => StubResult>;

function mount(
  returns: PurchaseReturnDocumentDTO[],
  invoices: PurchaseInvoiceDTO[] = [purchaseInvoice()],
  overrides: Handlers = {},
) {
  const transport = stubTransport({
    "GET /purchases/invoices": () => ({ body: invoices }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /suppliers": () => ({ body: suppliers }),
    "GET /items": () => ({ body: items }),
    "GET /purchase-returns": () => ({ body: returns }),
    ...overrides,
  });
  renderWithProviders(
    <WithSubPageNav>
      <PurchaseReturnsScreen />
    </WithSubPageNav>,
    { transport, initialSession: testAdminSession },
  );
}

async function openCreatePage() {
  await screen.findByRole("heading", { name: "مرتجعات المشتريات" });
  fireEvent.click((await screen.findAllByRole("button", { name: "مرتجع جديد" }))[0]!);
  return screen.findByRole("heading", { name: "مرتجع مشتريات جديد" });
}

describe("PurchaseReturnsScreen — what a return refuses to be", () => {
  it("refuses a return with no purchase invoice behind it", async () => {
    let posts = 0;
    mount([], [], {
      "POST /purchase-returns": () => {
        posts += 1;
        return { status: 201, body: purchaseReturn() };
      },
    });
    await openCreatePage();

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("اختر الفاتورة الأصلية والمستودع.")).toBeInTheDocument();
    expect(posts).toBe(0);
  });

  it("refuses a return whose only line is for nothing at all", async () => {
    let posts = 0;
    mount([], [purchaseInvoice()], {
      "POST /purchase-returns": () => {
        posts += 1;
        return { status: 201, body: purchaseReturn() };
      },
    });
    await openCreatePage();

    const qty = screen.getByText("الكمية").parentElement!.querySelector("input")!;
    fireEvent.change(qty, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));

    expect(await screen.findByText("أضف بنداً واحداً على الأقل بكمية أكبر من صفر.")).toBeInTheDocument();
    expect(posts).toBe(0);
  });

  it("surfaces the server's own refusal instead of leaving the page", async () => {
    mount([], [purchaseInvoice()], {
      "POST /purchase-returns": () => ({ status: 422, body: { error: "CLOSED_PERIOD", message: "الفترة المحاسبية مقفلة." } }),
    });
    await openCreatePage();

    fireEvent.click(screen.getByRole("button", { name: "حفظ كمسودة" }));
    expect(await screen.findByText("الفترة المحاسبية مقفلة.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "مرتجع مشتريات جديد" })).toBeInTheDocument();
  });

  it("opens with nothing to return when the chosen invoice carries only expense lines", async () => {
    mount([], [
      purchaseInvoice({
        lines: [{ itemId: null, description: "شحن", kind: "expense", qty: "1.000000", unitCost: "50.000000", taxRatePercent: 0, batchNo: null, expiryDate: null }],
      }),
    ]);
    await openCreatePage();

    expect(screen.queryByText("الكمية")).not.toBeInTheDocument();
  });
});

describe("PurchaseReturnsScreen — saving and confirming in one action", () => {
  it("posts the return and then confirms it, sending each line's cost and tax from the source invoice", async () => {
    let posted: { lines: Array<Record<string, unknown>> } | null = null;
    let confirmed = false;
    mount([], [purchaseInvoice()], {
      "POST /purchase-returns": (init) => {
        posted = JSON.parse((init?.body as string) ?? "{}") as typeof posted;
        return { status: 201, body: purchaseReturn({ id: "pr-new", docNo: null }) };
      },
      "POST /purchase-returns/pr-new/confirm": () => {
        confirmed = true;
        return { body: { document: purchaseReturn({ id: "pr-new", status: "confirmed" }), held: false } };
      },
    });
    await openCreatePage();

    const qty = screen.getByText("الكمية").parentElement!.querySelector("input")!;
    fireEvent.change(qty, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));

    await waitFor(() => expect(confirmed).toBe(true));
    expect(posted!.lines[0]).toMatchObject({
      itemId: "item-cement",
      warehouseId: "MAIN-WH",
      supplierId: "sup-1",
      sourceInvoiceId: "pi-1",
      sourceInvoiceNumber: "PI-000001",
      reason: "DEFECTIVE",
      availableQty: "20.000000",
      qty: "4",
      unitCost: "85.000000",
      // 85 × 4 at 14% VAT.
      taxAmount: "47.600000",
    });
  });
});

describe("PurchaseReturnsScreen — a register whose references are gone", () => {
  it("falls back to the raw supplier id when the supplier is no longer registered", async () => {
    mount([purchaseReturn({ lines: [{ ...purchaseReturn().lines[0]!, supplierId: "sup-gone" }] })]);
    expect(await screen.findByText("sup-gone")).toBeInTheDocument();
  });

  it("shows a dash for a return with no lines at all", async () => {
    mount([purchaseReturn({ lines: [] })]);
    const row = (await screen.findByText("PR-000001")).closest("tr")!;
    expect(within(row).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("shows a dash where a line names no source invoice number", async () => {
    mount([purchaseReturn({ lines: [{ ...purchaseReturn().lines[0]!, sourceInvoiceNumber: null }] })]);
    const row = (await screen.findByText("PR-000001")).closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("labels an unnumbered draft as a draft rather than leaving the column blank", async () => {
    mount([purchaseReturn({ docNo: null })]);
    const rows = await screen.findAllByText("مسودة");
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("PurchaseReturnsScreen — acting on an existing return", () => {
  it("surfaces a refused confirmation rather than reporting it done", async () => {
    mount([purchaseReturn()], [purchaseInvoice()], {
      "POST /purchase-returns/pr-1/confirm": () => ({ status: 422, body: { error: "NEGATIVE_STOCK", message: "الكمية غير متاحة في المستودع." } }),
    });

    fireEvent.click(await screen.findByText("PR-000001"));
    fireEvent.click(await screen.findByRole("button", { name: "تأكيد المرتجع" }));

    expect(await screen.findByText("الكمية غير متاحة في المستودع.")).toBeInTheDocument();
  });

  it("surfaces a refused cancellation the same way", async () => {
    mount([purchaseReturn()], [purchaseInvoice()], {
      "POST /purchase-returns/pr-1/cancel": () => ({ status: 409, body: { error: "ALREADY_CONFIRMED", message: "المستند مؤكد بالفعل." } }),
    });

    fireEvent.click(await screen.findByText("PR-000001"));
    fireEvent.click(await screen.findByRole("button", { name: "إلغاء" }));

    expect(await screen.findByText("المستند مؤكد بالفعل.")).toBeInTheDocument();
  });
});
