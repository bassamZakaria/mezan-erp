// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  BranchDTO,
  GoodsReceiptDTO,
  ItemDTO,
  LandedCostDocumentDTO,
  PurchaseInvoiceDTO,
  SupplierDTO,
  TreasuryAccountDTO,
  UserDTO,
  WarehouseDTO,
} from "@mezan/contracts";
import { PurchaseInvoicesScreen } from "./PurchaseInvoicesScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import { NavigationProvider, type ScreenIntent } from "../navigation";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/** `initialSegments` opens the screen directly on a sub-page — e.g. a detail route by raw id — without going through a row click. */
function TestNavigation({ children, initialSegments = [], intent = null }: { children: ReactNode; initialSegments?: readonly string[]; intent?: ScreenIntent | null }) {
  const [segments, setSegments] = useState<readonly string[]>(initialSegments);
  const [pendingIntent, setPendingIntent] = useState<ScreenIntent | null>(intent);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: setSegments,
        openScreenAt: () => {},
        intent: pendingIntent,
        clearIntent: () => setPendingIntent(null),
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
  { id: "item-nails", code: "ITM-2", nameAr: "مسامير", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "10.00", costPrice: null, taxRatePercent: 0, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active" },
];
const users: UserDTO[] = [{ id: "USER-ADMIN", nameAr: "محمد الشهابي", nameEn: null, email: "admin@cyag.example", isCompanyAdmin: true, active: true, roleCode: null, photoUrl: null } as unknown as UserDTO];
const treasuryAccounts: TreasuryAccountDTO[] = [
  { id: "treas-1", code: "CASH-1", name: "خزينة الفرع الرئيسي", nameEn: null, type: "cash", currency: "EGP", branchId: "MAIN", glAccountId: null, openingBalance: "0", openingBalanceDate: null, status: "active" },
];

function goodsReceipt(overrides: Partial<GoodsReceiptDTO> = {}): GoodsReceiptDTO {
  return {
    id: "gr-1",
    number: "GR-000001",
    purchaseOrderId: "po-2",
    supplierId: "sup-1",
    warehouseId: "MAIN-WH",
    date: "2026-08-19",
    notes: null,
    lines: [{ itemId: "item-cement", description: null, qty: "20.000000", unitCost: "85.000000", batchNo: null, expiryDate: null }],
    status: "confirmed",
    invoiced: false,
    totalCost: "1700.000000",
    createdBy: "USER-ADMIN",
    createdAt: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

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
    lines: [{ itemId: "item-cement", description: null, kind: "inventory", qty: "1.000000", unitCost: "100.000000", taxRatePercent: 0, batchNo: null, expiryDate: null }],
    status: "confirmed",
    subtotal: "100.000000",
    tax: "0.000000",
    total: "100.000000",
    amountPaid: "0.000000",
    remainingBalance: "100.000000",
    createdBy: "USER-ADMIN",
    createdAt: "2026-08-20T09:30:00.000Z",
    ...overrides,
  };
}

type Handler = (init: RequestInit | undefined, path: string) => StubResult;

function renderScreen(
  invoices: PurchaseInvoiceDTO[] = [purchaseInvoice()],
  extra: Record<string, Handler> = {},
  navProps: { initialSegments?: readonly string[]; intent?: ScreenIntent | null } = {},
) {
  let current = [...invoices];
  let lastListPath = "";
  let lastCreateBody: unknown = null;
  let lastPayBody: unknown = null;
  const transport = stubTransport({
    "GET /branches": () => ({ body: branches }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /suppliers": () => ({ body: suppliers }),
    "GET /items": () => ({ body: items }),
    "GET /users": () => ({ body: users }),
    "GET /treasury-accounts": () => ({ body: treasuryAccounts }),
    "GET /purchases/receipts": () => ({ body: [] }),
    "GET /landed-costs": () => ({ body: [] }),
    "GET /settings/currencies": () => ({ body: { base: "EGP", multiCurrencyEnabled: false, allowed: [] } }),
    "GET /purchases/invoices": (_init, path) => {
      lastListPath = path;
      return { body: current };
    },
    "GET /purchases/invoices/counts": () => ({
      body: { all: current.length, overdue: 0, due_soon: 0, draft: 0, confirmed: current.length, cancelled: 0, partially_paid: 0, paid: 0 },
    }),
    "GET /purchases/invoices/stats": () => ({
      body: {
        purchases: current.reduce((s, i) => s + Number(i.total), 0).toFixed(6),
        paid: current.reduce((s, i) => s + Number(i.amountPaid), 0).toFixed(6),
        unpaid: current.reduce((s, i) => s + Number(i.remainingBalance), 0).toFixed(6),
      },
    }),
    "GET /purchases/invoices/*/fulfilment": () => ({ body: { lines: [] } }),
    "POST /purchases/invoices": (init) => {
      lastCreateBody = JSON.parse((init?.body as string) ?? "{}");
      const body = lastCreateBody as Partial<PurchaseInvoiceDTO>;
      const created = purchaseInvoice({ id: "pi-new", number: "PI-000002", subtotal: "0", total: "0", ...body });
      current = [...current, created];
      return { body: created };
    },
    "POST /purchases/invoices/*/confirm": (_init, path) => {
      const id = path.split("/")[3]!;
      current = current.map((i) => (i.id === id ? { ...i, status: "confirmed" as const } : i));
      return { body: current.find((i) => i.id === id) };
    },
    "POST /purchases/invoices/*/payments": (init, path) => {
      lastPayBody = JSON.parse((init?.body as string) ?? "{}");
      const id = path.split("/")[3]!;
      current = current.map((i) => (i.id === id ? { ...i, amountPaid: "100.000000", remainingBalance: "0.000000" } : i));
      return { body: { ...current.find((i) => i.id === id)!, voucherId: "v-1", voucherNo: "PV-000001" } };
    },
    ...extra,
  });
  const result = renderWithProviders(
    <TestNavigation initialSegments={navProps.initialSegments} intent={navProps.intent}>
      <PurchaseInvoicesScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
  return { ...result, getListPath: () => lastListPath, getCreateBody: () => lastCreateBody, getPayBody: () => lastPayBody };
}

describe("PurchaseInvoicesScreen — detail view branches", () => {
  it("confirms a draft invoice from its own detail view, and payment is blocked on a draft invoice", async () => {
    const draft = purchaseInvoice({ id: "pi-draft", number: "PI-000009", status: "draft", remainingBalance: "100.000000" });
    renderScreen([draft]);
    fireEvent.click(await screen.findByText("PI-000009"));
    fireEvent.click(await screen.findByRole("tab", { name: "السداد" }));
    expect(screen.getByText("السداد متاح على الفواتير المؤكدة فقط.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "تأكيد الفاتورة" }));
    await waitFor(() => expect(screen.getAllByText("مؤكد").length).toBeGreaterThan(0));
  });

  it("an invoice created from a receipt shows the already-stocked effect, its due date and its supplier invoice number", async () => {
    const fromReceipt = purchaseInvoice({
      id: "pi-fr",
      number: "PI-000010",
      receiptId: "gr-9",
      dueDate: "2026-09-15",
      supplierInvoiceNumber: "SUP-9",
    });
    renderScreen([fromReceipt]);
    fireEvent.click(await screen.findByText("PI-000010"));
    expect(await screen.findByText(/تمّت إضافة الأصناف للمخزون سابقاً/)).toBeInTheDocument();
    expect(screen.getByText("من إيصال استلام")).toBeInTheDocument();
    expect(screen.getByText("SUP-9")).toBeInTheDocument();
  });

  it("fulfilment progress and a draft landed-cost document against the receipt both surface in the invoice's own tabs", async () => {
    const fromReceipt = purchaseInvoice({
      id: "pi-fr2",
      number: "PI-000011",
      receiptId: "gr-9",
      lines: [
        { itemId: "item-cement", description: null, kind: "inventory", qty: "5.000000", unitCost: "85.000000", taxRatePercent: 0, batchNo: null, expiryDate: null },
        { itemId: null, description: "أجرة نقل", kind: "freight", qty: "1.000000", unitCost: "50.000000", taxRatePercent: 0, batchNo: null, expiryDate: null },
        { itemId: null, description: "صيانة", kind: "expense", qty: "1.000000", unitCost: "20.000000", taxRatePercent: 0, batchNo: null, expiryDate: null },
      ],
    });
    const landedDocs: LandedCostDocumentDTO[] = [
      {
        id: "lc-draft",
        docType: "LANDED_COST",
        docNo: null,
        date: "2026-08-21",
        memo: "شحن",
        status: "draft",
        lines: [
          {
            itemId: "item-cement",
            warehouseId: "MAIN-WH",
            sourceInvoiceId: "gr-9",
            sourceInvoiceNumber: "GR-000009",
            qty: "5.000000",
            unitCost: "85.000000",
            weight: "5.000000",
            allocatedAmount: "30.000000",
            newUnitCost: "91.000000",
            distributionMethod: "BY_WEIGHT",
            costItems: [{ costType: "SHIPPING", description: "شحن", amount: "30.000000" }],
          },
        ],
        createdAt: "2026-08-21T00:00:00.000Z",
        confirmedAt: null,
        reversesDocId: null,
        reversedByDocId: null,
        workflowRequestId: null,
        journalEntryId: null,
      },
    ];
    renderScreen([fromReceipt], {
      "GET /landed-costs": () => ({ body: landedDocs }),
      "GET /purchases/invoices/pi-fr2/fulfilment": () => ({
        body: { lines: [{ lineIndex: 0, itemId: "item-cement", invoicedQty: "5.000000", receivedQty: "5.000000", consumedQty: "2.000000", remainingQty: "3.000000" }] },
      }),
    });
    fireEvent.click(await screen.findByText("PI-000011"));

    // The lines tab is the default — freight/expense lines show their own
    // description and kind label, and the inventory line's fulfilment columns
    // populate from the fetched progress.
    expect(await screen.findByText("أجرة نقل")).toBeInTheDocument();
    expect(screen.getByText("صيانة")).toBeInTheDocument();
    expect(screen.getByText("شحن")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText((_, el) => el?.textContent === "2").length).toBeGreaterThan(0);
      expect(screen.getAllByText((_, el) => el?.textContent === "3").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole("tab", { name: /التكاليف الإضافية/ }));
    expect(await screen.findByText("lc-draft")).toBeInTheDocument();
    expect(screen.getByText("مسودة")).toBeInTheDocument();
  });

  it("a payment of exactly zero is refused the same as no amount entered", async () => {
    renderScreen([purchaseInvoice({ remainingBalance: "100.000000", status: "confirmed" })]);
    fireEvent.click(await screen.findByText("PI-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: "السداد" }));
    const amountInput = fieldInput(document.body, "قيمة السداد");
    fireEvent.change(amountInput, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل السداد" }));
    expect(await screen.findByText("قيمة السداد يجب أن تكون أكبر من صفر.")).toBeInTheDocument();
  });

  it("opening an invoice directly by its id (not its human-readable number) still finds it", async () => {
    renderScreen([purchaseInvoice()], {}, { initialSegments: ["pi-1"] });
    expect(await screen.findByText(/PI-000001/)).toBeInTheDocument();
  });
});

describe("PurchaseInvoicesScreen — create-form branches", () => {
  it("switching a line back to 'inventory' restores its item picker, and a second line can be added and removed", async () => {
    renderScreen([]);
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));

    fireEvent.click(screen.getByText("مصروف"));
    fireEvent.click(screen.getByText("مخزني"));
    expect(screen.getByLabelText("الصنف")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إضافة صنف" }));
    expect(screen.getAllByRole("button", { name: "حذف البند" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: "حذف البند" })[0]!);
    expect(screen.queryAllByRole("button", { name: "حذف البند" }).length).toBe(0);
  });

  it("a freight line's description and unit cost post as entered, an item without a listed price leaves the cost untouched, and the supplier invoice number reaches the request", async () => {
    const { getCreateBody } = renderScreen([]);
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");

    pickFromCombobox(document.body, "الصنف", "مسامير");
    const costInput = fieldInput(document.body, "التكلفة");
    expect(costInput).toHaveValue(0);

    fireEvent.click(screen.getByText("شحن"));
    expect(screen.getByText("وصف الشحن")).toBeInTheDocument();
    fireEvent.change(fieldInput(document.body, "وصف الشحن"), { target: { value: "شحن بحري" } });

    fireEvent.change(fieldInput(document.body, "رقم فاتورة المورد"), { target: { value: "SUP-INV-77" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const body = getCreateBody() as Record<string, unknown>;
    expect(body.supplierInvoiceNumber).toBe("SUP-INV-77");
    const lines = body.lines as Array<Record<string, unknown>>;
    expect(lines[0]!.itemId).toBeNull();
    expect(lines[0]!.description).toBe("شحن بحري");
    expect(lines[0]!.unitCost).toBe("0");
  });

  it("a supplier chosen with no valid line still blocks save", async () => {
    renderScreen([]);
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    expect(screen.getByRole("button", { name: "حفظ مسودة" })).toBeDisabled();
  });

  it("opens the create form pre-bound to a supplier via a screen intent", async () => {
    renderScreen([], {}, { intent: { kind: "create", prefill: { supplierId: "sup-1" } } });
    expect(await screen.findByText("طريقة الإنشاء")).toBeInTheDocument();
  });

  it("multi-currency settings offer more than the base currency, falling back to the raw code for one the app doesn't recognise", async () => {
    const user = userEvent.setup();
    renderScreen([], {
      "GET /settings/currencies": () => ({ body: { base: "EGP", multiCurrencyEnabled: true, allowed: ["USD", "ZZZ"] } }),
    });
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));

    await user.click(screen.getByRole("combobox", { name: "العملة" }));
    expect(await screen.findByRole("option", { name: /^USD/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ZZZ" })).toBeInTheDocument();
  });
});

describe("PurchaseInvoicesScreen — list branches", () => {
  it("narrows the list by due date and warehouse, and by free-text search", async () => {
    const { getListPath } = renderScreen();
    await screen.findByText("PI-000001");

    fireEvent.change(fieldInput(document.body, "إلى تاريخ"), { target: { value: "2026-12-31" } });
    await waitFor(() => expect(getListPath()).toContain("toDate=2026-12-31"));

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "المستودع" }));
    await user.click(await screen.findByRole("option", { name: "المخزن الرئيسي" }));
    await waitFor(() => expect(getListPath()).toContain("warehouseId=MAIN-WH"));

    fireEvent.change(screen.getByPlaceholderText("بحث برقم الفاتورة أو اسم المورد…"), { target: { value: "PI-000001" } });
    await waitFor(() => expect(getListPath()).toContain("search=PI-000001"));
  });

  it("shows an unset due date and an unrecognised creator id plainly rather than hiding the row", async () => {
    renderScreen([purchaseInvoice({ dueDate: null, createdBy: "USER-GHOST" })]);
    await screen.findByText("PI-000001");
    expect(screen.getByText("USER-GHOST")).toBeInTheDocument();
    const row = screen.getByText("PI-000001").closest("tr")!;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("shows a retry option when the purchase invoice list fails to load", async () => {
    renderScreen([], { "GET /purchases/invoices": () => ({ status: 500, body: { error: "SERVER_ERROR" } }) });
    expect(await screen.findByText("تعذّر تحميل فواتير المشتريات.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
  });
});
