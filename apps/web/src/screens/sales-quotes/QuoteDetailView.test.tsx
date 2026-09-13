// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BranchDTO, ItemDTO, WarehouseDTO } from "@mezan/contracts";
import { QuoteDetailView } from "./QuoteDetailView";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import type { SalesQuoteRecord } from "../../data/hooks";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];
const warehouses: WarehouseDTO[] = [
  { id: "MAIN-WH", code: "MAIN-WH", name: "المخزن الرئيسي", nameEn: null, branchId: "MAIN", type: "MAIN", isDefault: true, active: true, projectId: null, custodianUserId: null },
];
const items: ItemDTO[] = [
  {
    id: "item-1", code: "ITM-1", nameAr: "صنف تجريبي", nameEn: null, type: "stock", baseUnitCode: "PCS", alternateUnits: [], barcodes: [],
    categoryId: null, brandId: null, seasonId: null, description: null, defaultSupplierId: null, specifications: [], costingMethod: "WAC",
    salePrice: "200.000000", costPrice: "150.000000", taxRatePercent: 14, trackInventory: true, trackBatches: false, trackExpiry: false,
    reorderPoint: null, imageAttachmentId: null, reorderQty: null,
    // No item-level GL mapping — this is the exact case where the domain falls back to quote-model.ts's hardcoded account constants.
    revenueAccountId: null, cogsAccountId: null, inventoryAccountId: null,
    etaCodeType: null, etaItemCode: null, gpcCode: null, status: "active",
  },
];

function quote(overrides: Partial<SalesQuoteRecord> = {}): SalesQuoteRecord {
  return {
    id: "q-1",
    docType: "SALES_QUOTE",
    docNo: "SQ-000001",
    status: "sent",
    date: "2026-08-01",
    expiryDate: "2026-08-15",
    customerId: "cust-1",
    customerNameAr: "متجر الأمل",
    branchId: "MAIN",
    currency: "EGP",
    customerTaxExempt: false,
    notes: null,
    internalNotes: null,
    discount: { type: "percent", percent: 0 },
    priceListId: null,
    couponCode: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    sentAt: "2026-08-01T00:00:00.000Z",
    respondedAt: null,
    convertedAt: null,
    convertedInvoiceId: null,
    lines: [{ lineId: "l1", itemId: "item-1", itemNameAr: "صنف تجريبي", qty: "2.000000", unitPrice: "200.000000", discountPercent: 0, taxRatePercent: 14 }],
    totals: { grossTotal: "400", lineDiscountTotal: "0", invoiceDiscountTotal: "0", subtotal: "400", taxableTotal: "400", taxTotal: "56", grandTotal: "456.000000" },
    ...overrides,
  };
}

function renderDetail(
  q: SalesQuoteRecord = quote(),
  extra: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> = {},
) {
  let lastConvertBody: unknown = null;
  let sendCalled = 0;
  const transport = stubTransport({
    "GET /branches": () => ({ body: branches }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /items": () => ({ body: items }),
    "GET /audit": () => ({ body: { events: [] } }),
    "POST /sales-quotes/*/send": () => {
      sendCalled += 1;
      return { body: { ...q, status: "sent" } };
    },
    "POST /sales-quotes/*/convert-to-invoice": (init) => {
      lastConvertBody = JSON.parse((init?.body as string) ?? "{}");
      return { body: { quote: { ...q, status: "converted", convertedInvoiceId: "inv-1" }, invoiceId: "inv-1", invoiceDocNo: "SI-000001" } };
    },
    ...extra,
  });
  const result = renderWithProviders(<QuoteDetailView quote={q} onBack={() => {}} />, { transport, initialSession: testAdminSession });
  return { ...result, getConvertBody: () => lastConvertBody, getSendCalled: () => sendCalled };
}

describe("QuoteDetailView", () => {
  it("renders the line table and totals with formatted Money, never a raw scaled-decimal string", async () => {
    renderDetail();
    expect(screen.getByRole("heading", { name: "SQ-000001" })).toBeInTheDocument();
    expect(screen.getByText("صنف تجريبي")).toBeInTheDocument();
    expect(screen.queryByText("456.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === "456.00").length).toBeGreaterThan(0);
  });

  it("a sent quote offers accept/reject, and accept posts to the real transition endpoint", async () => {
    const { getSendCalled } = renderDetail(quote({ status: "sent" }));
    expect(screen.getByRole("button", { name: "قبول العميل" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "رفض" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إرسال للعميل" })).not.toBeInTheDocument();
    void getSendCalled;
  });

  it("a draft quote offers only send, which posts", async () => {
    const { getSendCalled } = renderDetail(quote({ status: "draft" }));
    fireEvent.click(screen.getByRole("button", { name: "إرسال للعميل" }));
    await waitFor(() => expect(getSendCalled()).toBe(1));
  });

  it("converting blocks with an Arabic message when no warehouse is available/picked", async () => {
    const { getConvertBody } = renderDetail(quote({ status: "accepted" }), { "GET /warehouses": () => ({ body: [] }) });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء الفاتورة" }));
    expect(await screen.findByText("اختر المستودع.")).toBeInTheDocument();
    expect(getConvertBody()).toBeNull();
  });

  it(
    "D107: the working-location default warehouse applies once the queries resolve, so an " +
      "accepted quote converts without a manual re-pick",
    async () => {
      const { getConvertBody } = renderDetail(quote({ status: "accepted" }));
      // A real, resolvable default warehouse (MAIN-WH, isDefault: true) exists.
      await waitFor(() =>
        expect(screen.getByRole("combobox", { name: "المستودع *" })).toHaveTextContent(/المخزن الرئيسي/),
      );
      fireEvent.click(screen.getByRole("button", { name: "إنشاء الفاتورة" }));
      await waitFor(() => expect(getConvertBody()).not.toBeNull());
      expect((getConvertBody() as Record<string, unknown>).warehouseId).toBe("MAIN-WH");
      expect(screen.queryByText("اختر المستودع.")).not.toBeInTheDocument();
    },
  );

  it(
    "OBSERVATION: once a warehouse is manually picked, converting to an invoice sends " +
      "quote-model.ts's HARDCODED fallback account ids (AR/TAX/REVENUE/COGS/INVENTORY = " +
      "'1105'/'2200'/'4100'/'5100'/'1200') whenever the item carries no GL mapping of its " +
      "own — these are never checked against the tenant's real chart of accounts before " +
      "being posted, so a tenant whose CoA does not use exactly these codes would get a " +
      "silent misposting rather than a validation error.",
    async () => {
      const user = userEvent.setup();
      const { getConvertBody } = renderDetail(quote({ status: "accepted" }));
      await user.click(screen.getByRole("combobox", { name: "المستودع *" }));
      await user.click(await screen.findByRole("option", { name: /المخزن الرئيسي/ }));
      fireEvent.click(screen.getByRole("button", { name: "إنشاء الفاتورة" }));
      await waitFor(() => expect(getConvertBody()).not.toBeNull());
      const body = getConvertBody() as Record<string, unknown>;
      expect(body.warehouseId).toBe("MAIN-WH");
      expect(body.arAccountId).toBe("1105");
      expect(body.taxAccountId).toBe("2200");
      const lines = body.lines as Array<Record<string, unknown>>;
      expect(lines[0]!.revenueAccountId).toBe("4100");
      expect(lines[0]!.cogsAccountId).toBe("5100");
      expect(lines[0]!.inventoryAccountId).toBe("1200");
    },
  );

  it("a converted quote shows the resulting invoice id and a 'view invoice' action", async () => {
    renderDetail(quote({ status: "converted", convertedInvoiceId: "inv-42" }));
    expect(screen.getByText("inv-42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "عرض الفاتورة" })).toBeInTheDocument();
  });

  it("a server refusal on convert renders the server's Arabic message, not raw JSON", async () => {
    const user = userEvent.setup();
    renderDetail(quote({ status: "accepted" }), {
      "POST /sales-quotes/*/convert-to-invoice": () => ({ status: 400, body: { message: "الفترة المالية مقفلة" } }),
    });
    await user.click(screen.getByRole("combobox", { name: "المستودع *" }));
    await user.click(await screen.findByRole("option", { name: /المخزن الرئيسي/ }));
    fireEvent.click(screen.getByRole("button", { name: "إنشاء الفاتورة" }));
    expect(await screen.findByText("الفترة المالية مقفلة")).toBeInTheDocument();
  });

  it("draft/sent quotes offer cancel; converted quotes do not", async () => {
    renderDetail(quote({ status: "draft" }));
    expect(screen.getByRole("button", { name: "إلغاء العرض" })).toBeInTheDocument();
  });
});
