import { GoodsReceiptInvoicingStatusDTO } from "@mezan/contracts";
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
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

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

function typeDecimal(input: HTMLElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
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
  { id: "MAIN-WH", code: "MAIN-WH", name: "المخزن الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null },
];
const suppliers: SupplierDTO[] = [
  { id: "sup-1", code: "S1", nameAr: "شركة النيل للتوريدات", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null, category: null, notes: null, paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, addressCity: null, addressDistrict: null, addressStreet: null, bankAccount: null },
];
const items: ItemDTO[] = [
  { id: "item-cement", code: "ITM-1", nameAr: "أسمنت بورتلاندي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [], categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC", salePrice: "100.00", costPrice: "85.00", taxRatePercent: 14, trackInventory: true, trackBatches: false, trackExpiry: false, reorderPoint: null, imageAttachmentId: null, reorderQty: null, revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null, etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active" },
];
const users: UserDTO[] = [{ id: "USER-ADMIN", nameAr: "محمد الشهابي", nameEn: null, email: "admin@cyag.example", isCompanyAdmin: true, active: true, roleCode: null, photoUrl: null } as unknown as UserDTO];
const treasuryAccounts: TreasuryAccountDTO[] = [
  { id: "treas-1", code: "CASH-1", name: "خزينة الفرع الرئيسي", nameEn: null, type: "cash", currency: "EGP", bankAccountNumber: null, branchId: "MAIN", glAccountId: null, openingBalance: "0", openingBalanceDate: null, guaranteeFacilityLimit: null, status: "active" },
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
    lines: [{ itemId: "item-cement", description: null, qty: "20.000000", unitCost: "85.000000", batchNo: null, expiryDate: null, invoicedQty: "0.000000", remainingQty: "20.000000" }],
    status: "confirmed",
    invoiced: false,
    invoicingStatus: GoodsReceiptInvoicingStatusDTO.NotInvoiced,
    uninvoicedCost: "1700.000000",
    totalCost: "1700.000000",
    createdBy: "USER-ADMIN",
    createdAt: "2026-08-19T10:00:00.000Z",
    projectId: null,
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
    projectId: null,
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

function renderScreen(
  invoices: PurchaseInvoiceDTO[] = [purchaseInvoice()],
  extra: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> = {},
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
    "GET /projects": () => ({ body: [] }),
    "GET /settings/currencies": () => ({ body: { base: "EGP", multiCurrencyEnabled: false, allowed: [] } }),
    "GET /purchases/invoices": (_init, path) => {
      lastListPath = path;
      // guards Q-9: the route now applies the newest-first order and cuts the
      // page, so the stub honours the same contract — a stub returning
      // everything would let a client-side slice pass unnoticed.
      const params = new URL(path, "http://x").searchParams;
      const ordered = [...current].sort((a, b) => b.number.localeCompare(a.number));
      const pageSize = Number(params.get("pageSize") ?? 25);
      const page = Number(params.get("page") ?? 1);
      return { body: ordered.slice((page - 1) * pageSize, page * pageSize) };
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
    "POST /purchases/invoices/*/payments": (init, path) => {
      lastPayBody = JSON.parse((init?.body as string) ?? "{}");
      const id = path.split("/")[3]!;
      current = current.map((i) => (i.id === id ? { ...i, amountPaid: "100.000000", remainingBalance: "0.000000" } : i));
      return { body: { ...current.find((i) => i.id === id)!, voucherId: "v-1", voucherNo: "PV-000001" } };
    },
    ...extra,
  });
  const result = renderWithProviders(
    <TestNavigation>
      <PurchaseInvoicesScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
  return { ...result, getListPath: () => lastListPath, getCreateBody: () => lastCreateBody, getPayBody: () => lastPayBody };
}

describe("PurchaseInvoicesScreen (filters, stats, entity ids, payments)", () => {
  it("the branch/warehouse/supplier filters and date range each change the outgoing list request", async () => {
    const user = userEvent.setup();
    const { getListPath } = renderScreen();
    await screen.findByText("PI-000001");

    await user.click(screen.getByRole("combobox", { name: "الفرع" }));
    await user.click(await screen.findByRole("option", { name: "الفرع الرئيسي" }));
    await waitFor(() => expect(getListPath()).toContain("branchId=MAIN"));

    await user.click(screen.getByRole("combobox", { name: "المورد" }));
    await user.click(await screen.findByRole("option", { name: "شركة النيل للتوريدات" }));
    await waitFor(() => expect(getListPath()).toContain("supplierId=sup-1"));

    fireEvent.change(fieldInput(document.body, "من تاريخ"), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(getListPath()).toContain("fromDate=2026-08-01"));
  });

  it("status chips change the outgoing status filter", async () => {
    const { getListPath } = renderScreen();
    await screen.findByText("PI-000001");
    fireEvent.click(screen.getByRole("tab", { name: /^مؤكدة|^مؤكد/ }));
    await waitFor(() => expect(getListPath()).toContain("status=confirmed"));
  });

  it("the attention banners set the status filter when clicked", async () => {
    const { getListPath } = renderScreen([purchaseInvoice({ dueDate: "2020-01-01" })], {
      "GET /purchases/invoices/counts": () => ({ body: { all: 1, overdue: 1, due_soon: 0, draft: 0, confirmed: 1, cancelled: 0, partially_paid: 0, paid: 0 } }),
    });
    await screen.findByText("PI-000001");
    fireEvent.click(screen.getByText(/فواتير موردين متأخرة عن السداد/));
    await waitFor(() => expect(getListPath()).toContain("status=overdue"));
  });

  it("the KPI strip renders Money-formatted stats, never a raw scaled-decimal string, and unpaid turns danger-toned", async () => {
    renderScreen([purchaseInvoice({ total: "5000.000000", remainingBalance: "5000.000000" })]);
    await screen.findByText("PI-000001");
    await waitFor(() => expect(screen.queryByText("5000.000000")).not.toBeInTheDocument());
    expect(screen.getAllByText((_, el) => el?.textContent === "5,000.00").length).toBeGreaterThan(0);
  });

  it("creates a manual invoice with the real picked supplier and item ids in the POST body", async () => {
    const { getCreateBody } = renderScreen([]);
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    pickFromCombobox(document.body, "الصنف", "أسمنت بورتلاندي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const body = getCreateBody() as Record<string, unknown>;
    expect(body.supplierId).toBe("sup-1");
    const lines = body.lines as Array<Record<string, unknown>>;
    expect(lines[0]!.itemId).toBe("item-cement");
    expect(lines[0]!.kind).toBe("inventory");
  });

  it("opens the invoice already saved, with a notice, when its id was used with other contents", async () => {
    let sends = 0;
    renderScreen([], {
      "POST /purchases/invoices": () => {
        sends += 1;
        return { status: 409, body: { error: "IDEMPOTENCY_KEY_REUSED", message: "سبق تسجيل مستند بهذا المعرّف ببيانات مختلفة" } };
      },
    });
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    pickFromCombobox(document.body, "الصنف", "أسمنت بورتلاندي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "حفظ مسودة" })).not.toBeInTheDocument());
    expect(sends).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a quantity, a cost and a line total reach the wire and the screen as the decimals that were typed, where a binary number would not hold them", async () => {
    const { getCreateBody } = renderScreen([]);
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    pickFromCombobox(document.body, "الصنف", "أسمنت بورتلاندي");
    typeDecimal(fieldInput(document.body, "الكمية"), "0.333333");
    typeDecimal(fieldInput(document.body, "التكلفة"), "9007199254740993.10");
    expect(screen.getByText("3,002,396,749,180,579.45")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const lines = (getCreateBody() as { lines: Array<Record<string, unknown>> }).lines;
    expect(lines[0]).toMatchObject({ qty: "0.333333", unitCost: "9007199254740993.10" });
  });

  it("the subtotal is added up as money: three at 1.255 and one at 0.1 and one at 0.2 make 4.07, and each figure goes out as typed", async () => {
    const { getCreateBody } = renderScreen([]);
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    const figures = [["3", "1.255"], ["1", "0.1"], ["1", "0.2"]] as const;
    for (const [index, [qty, cost]] of figures.entries()) {
      if (index > 0) fireEvent.click(screen.getByRole("button", { name: "إضافة صنف" }));
      fireEvent.click(screen.getAllByText("مصروف")[index]!);
      typeDecimal(screen.getAllByLabelText("الكمية")[index]!, qty);
      typeDecimal(screen.getAllByLabelText("التكلفة")[index]!, cost);
    }
    expect(screen.getByText("4.07")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const lines = (getCreateBody() as { lines: Array<Record<string, unknown>> }).lines;
    expect(lines.map((line) => [line.qty, line.unitCost])).toEqual([["3", "1.255"], ["1", "0.1"], ["1", "0.2"]]);
  });

  it("an item's own cost prefills the line and goes out as the catalogue states it", async () => {
    const { getCreateBody } = renderScreen([], {
      "GET /items": () => ({ body: [{ ...items[0]!, costPrice: "85.100000" }] }),
    });
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    pickFromCombobox(document.body, "الصنف", "أسمنت بورتلاندي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    expect((getCreateBody() as { lines: Array<Record<string, unknown>> }).lines[0]).toMatchObject({ qty: "1", unitCost: "85.100000" });
  });

  it("billing part of a receipt sends the quantity typed, and a quantity above what is left to bill is refused in Arabic", async () => {
    const receipt = goodsReceipt({ lines: [{ itemId: "item-cement", description: null, qty: "1.000000", unitCost: "85.000000", batchNo: null, expiryDate: null, invoicedQty: "0.666667", remainingQty: "0.333333" }] });
    const { getCreateBody } = renderScreen([], { "GET /purchases/receipts": () => ({ body: [receipt] }) });
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(await screen.findByText("من إيصال استلام"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "إيصال الاستلام *", "GR-000001");
    const billQty = await screen.findByLabelText("الكمية المفوترة");

    typeDecimal(billQty, "0.333334");
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/[\u0600-\u06FF]/);
    expect(getCreateBody()).toBeNull();

    typeDecimal(billQty, "0.111111");
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    expect((getCreateBody() as Record<string, unknown>).receiptQuantities).toEqual([{ lineIndex: 0, qty: "0.111111" }]);
  });

  it("switching a line's kind off 'inventory' clears the item id and switches to a free-text description field", async () => {
    renderScreen([]);
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    pickFromCombobox(document.body, "الصنف", "أسمنت بورتلاندي");
    fireEvent.click(screen.getByText("مصروف"));
    expect(screen.queryByLabelText("الصنف")).not.toBeInTheDocument();
    expect(screen.getByText("وصف المصروف")).toBeInTheDocument();
  });

  it("creating from a receipt derives preview lines from the real receipt and posts its id", async () => {
    const { getCreateBody } = renderScreen([], {
      "GET /purchases/receipts": () => ({ body: [goodsReceipt()] }),
    });
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(await screen.findByText("من إيصال استلام"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "إيصال الاستلام *", "GR-000001");
    expect(await screen.findByText("أسمنت بورتلاندي")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    await waitFor(() => expect(getCreateBody()).not.toBeNull());
    const body = getCreateBody() as Record<string, unknown>;
    expect(body.receiptId).toBe("gr-1");
    expect(body.lines).toBeUndefined();
  });

  it("a server refusal on create renders the screen's Arabic formError, not raw JSON", async () => {
    renderScreen([], {
      "POST /purchases/invoices": () => ({ status: 400, body: { message: "لا يمكن إنشاء فاتورة بدون بنود" } }),
    });
    fireEvent.click((await screen.findAllByRole("button", { name: "فاتورة مشتريات جديدة" }))[0]!);
    fireEvent.click(screen.getByText("إنشاء فاتورة جديدة"));
    fireEvent.click(screen.getByRole("button", { name: "متابعة" }));
    pickFromCombobox(document.body, "المورد *", "شركة النيل للتوريدات");
    pickFromCombobox(document.body, "الصنف", "أسمنت بورتلاندي");
    fireEvent.click(screen.getByRole("button", { name: "حفظ مسودة" }));
    expect(await screen.findByText("لا يمكن إنشاء فاتورة بدون بنود")).toBeInTheDocument();
  });

  it("D216: the payment tab names the returned amount the remaining balance nets", async () => {
    renderScreen([purchaseInvoice({ status: "confirmed", total: "200.000000", returnedCredit: "60.000000", remainingBalance: "140.000000" })]);
    fireEvent.click(await screen.findByText("PI-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: "السداد" }));
    expect(await screen.findByText("المرتجع")).toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === "140.00").length).toBeGreaterThan(0);
  });

  it("payment tab: guards block submit with Arabic messages, then posts the real treasury id and shows the voucher note", async () => {
    const { getPayBody } = renderScreen([purchaseInvoice({ remainingBalance: "100.000000", status: "confirmed" })]);
    fireEvent.click(await screen.findByText("PI-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: "السداد" }));

    fireEvent.click(screen.getByRole("button", { name: "تسجيل السداد" }));
    expect(await screen.findByText("قيمة السداد يجب أن تكون أكبر من صفر.")).toBeInTheDocument();

    const amountInput = fieldInput(document.body, "قيمة السداد");
    typeDecimal(amountInput, "100.10");
    fireEvent.click(screen.getByRole("button", { name: "تسجيل السداد" }));
    expect(await screen.findByText("اختر الخزينة التي سيُصرف منها.")).toBeInTheDocument();
    expect(getPayBody()).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "الخزينة" }));
    await user.click(await screen.findByRole("option", { name: /خزينة الفرع الرئيسي/ }));
    fireEvent.click(screen.getByRole("button", { name: "تسجيل السداد" }));
    await waitFor(() => expect(getPayBody()).not.toBeNull());
    const body = getPayBody() as Record<string, unknown>;
    expect(body.treasuryAccountId).toBe("treas-1");
    expect(body.amount).toBe("100.10");
    // The successful-payment note (voucher PV-000001) and the post-refetch
    // "fully settled" message are mutually exclusive renders of the same slot
    // (`canPay` flips false the instant the invalidated invoice refetches with
    // remainingBalance 0) — assert whichever the DOM has settled on.
    await waitFor(() => {
      const done = screen.queryByText((_, el) => el?.textContent === "تم إنشاء سند الصرف PV-000001 وتخصيصه على الفاتورة.");
      const settled = screen.queryByText("الفاتورة مسدَّدة بالكامل.");
      expect(done ?? settled).not.toBeNull();
    });
  });

  it("landed-costs tab shows only the lines that reference THIS invoice, formatted money and the real item name", async () => {
    const landedDocs: LandedCostDocumentDTO[] = [
      {
        id: "lc-1",
        docType: "LANDED_COST",
        docNo: "LC-000001",
        date: "2026-08-21",
        memo: "شحن ورسوم جمركية",
        status: "confirmed",
        lines: [
          {
            itemId: "item-cement",
            warehouseId: "MAIN-WH",
            sourceInvoiceId: "pi-1",
            sourceInvoiceNumber: "PI-000001",
            qty: "1.000000",
            unitCost: "100.000000",
            weight: "1.000000",
            allocatedAmount: "50.000000",
            newUnitCost: "150.000000",
            distributionMethod: "BY_VALUE",
            costItems: [{ costType: "SHIPPING", description: "شحن", amount: "50.000000" }],
          },
        ],
        createdAt: "2026-08-21T00:00:00.000Z",
        confirmedAt: "2026-08-21T00:00:00.000Z",
        reversesDocId: null,
        reversedByDocId: null,
        workflowRequestId: null,
        journalEntryId: null,
      },
      {
        id: "lc-2",
        docType: "LANDED_COST",
        docNo: "LC-000002",
        date: "2026-08-21",
        memo: "غير متعلق",
        status: "confirmed",
        lines: [
          {
            itemId: "item-cement",
            warehouseId: "MAIN-WH",
            sourceInvoiceId: "pi-unrelated",
            sourceInvoiceNumber: "PI-999999",
            qty: "1.000000",
            unitCost: "100.000000",
            weight: "1.000000",
            allocatedAmount: "999.000000",
            newUnitCost: "200.000000",
            distributionMethod: "BY_VALUE",
            costItems: [{ costType: "CUSTOMS", description: "جمارك", amount: "999.000000" }],
          },
        ],
        createdAt: "2026-08-21T00:00:00.000Z",
        confirmedAt: "2026-08-21T00:00:00.000Z",
        reversesDocId: null,
        reversedByDocId: null,
        workflowRequestId: null,
        journalEntryId: null,
      },
    ];
    renderScreen([purchaseInvoice()], { "GET /landed-costs": () => ({ body: landedDocs }) });
    fireEvent.click(await screen.findByText("PI-000001"));
    fireEvent.click(await screen.findByRole("tab", { name: /التكاليف الإضافية/ }));
    expect(await screen.findByText("أسمنت بورتلاندي")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("999.000000")).not.toBeInTheDocument());
    expect(screen.getAllByText((_, el) => el?.textContent === "50.00").length).toBeGreaterThan(0);
    // The unrelated document's allocation must not leak in.
    expect(screen.queryByText((_, el) => el?.textContent === "999.00")).not.toBeInTheDocument();
  });

  it("the row action menu offers 'confirm' only on a draft invoice, and switches to landed-cost/return options on a confirmed one — never confirm again", async () => {
    const draft = purchaseInvoice({ id: "pi-draft", number: "PI-000002", status: "draft" });
    const confirmed = purchaseInvoice({ id: "pi-confirmed", number: "PI-000003", status: "confirmed", remainingBalance: "0.000000" });
    renderScreen([draft, confirmed]);
    await screen.findByText("PI-000002");

    // The list sorts by number descending, so PI-000003 (confirmed) renders before PI-000002 (draft).
    const rows = screen.getAllByRole("row").slice(1);
    const [rowConfirmed, rowDraft] = rows;

    fireEvent.click(within(rowDraft!).getByRole("button", { name: /^إجراءات/ }));
    expect(await screen.findByRole("menuitem", { name: "تأكيد الفاتورة" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "توزيع تكلفة إضافية" })).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "Escape" });

    fireEvent.click(within(rowConfirmed!).getByRole("button", { name: /^إجراءات/ }));
    expect(await screen.findByRole("menuitem", { name: "توزيع تكلفة إضافية" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "مرتجع مشتريات" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "تأكيد الفاتورة" })).not.toBeInTheDocument();
  });

  it("an owing confirmed invoice shows the inline pay button on its row; a fully-settled one does not", async () => {
    const owing = purchaseInvoice({ id: "pi-owing", number: "PI-000004", status: "confirmed", total: "500.000000", remainingBalance: "500.000000" });
    const settled = purchaseInvoice({ id: "pi-settled", number: "PI-000005", status: "confirmed", total: "500.000000", amountPaid: "500.000000", remainingBalance: "0.000000" });
    renderScreen([owing, settled]);
    await screen.findByText("PI-000004");

    // The list sorts by number descending, so PI-000005 (settled) renders before PI-000004 (owing).
    const rows = screen.getAllByRole("row").slice(1);
    const [rowSettled, rowOwing] = rows;
    expect(within(rowOwing!).getByRole("button", { name: "تسجيل السداد" })).toBeInTheDocument();
    expect(within(rowSettled!).queryByRole("button", { name: "تسجيل السداد" })).not.toBeInTheDocument();
  });

  it("D218: the «الإجمالي» column is in base under the base label, and a foreign invoice's own figure sits under it in its own currency", async () => {
    const local = purchaseInvoice({ id: "pi-egp", number: "PI-000006", total: "500.000000", baseTotal: "500.000000", remainingBalance: "500.000000" });
    const foreign = purchaseInvoice({ id: "pi-sar", number: "PI-000007", currency: "SAR", fxRate: "13.2", total: "100.000000", baseTotal: "1320.000000", remainingBalance: "1320.000000" });
    renderScreen([local, foreign]);
    await screen.findByText("PI-000007");
    const [rowForeign, rowLocal] = screen.getAllByRole("row").slice(1);
    const baseLabel = within(rowLocal!).getByText("500.00").nextElementSibling?.textContent;
    expect(within(rowForeign!).getByText("1,320.00").nextElementSibling?.textContent).toBe(baseLabel);
    expect(within(rowForeign!).getByText("100.00").nextElementSibling?.textContent).toBe("SAR");
  });

  it("KNOWN DEFECT: a rejected confirm from the row menu leaves the invoice a draft but shows the user no error at all — confirmSelected swallows the failure silently", async () => {
    const draft = purchaseInvoice({ id: "pi-draft", number: "PI-000002", status: "draft" });
    renderScreen([draft], {
      "POST /purchases/invoices/pi-draft/confirm": () => ({ status: 409, body: { message: "الفترة المحاسبية مقفلة." } }),
    });
    await screen.findByText("PI-000002");
    fireEvent.click(within(screen.getAllByRole("row")[1]!).getByRole("button", { name: /^إجراءات/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "تأكيد الفاتورة" }));

    // Give the rejected mutation a tick to settle, then confirm: still a draft…
    await waitFor(() => expect(screen.getAllByText("مسودة").length).toBeGreaterThan(0));
    // …and — this is the defect — the server's refusal message never reaches the screen anywhere.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("الفترة المحاسبية مقفلة.")).not.toBeInTheDocument();
  });
});
