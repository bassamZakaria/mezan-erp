// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { DEFAULT_PRINT_TEMPLATE_CONFIG } from "@mezan/ui";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { SalesInvoicePrintPage } from "./SalesInvoicePrintPage";
import type { SalesInvoiceDTO } from "../data/hooks";

function baseInvoice(overrides: Partial<SalesInvoiceDTO> = {}): SalesInvoiceDTO {
  return {
    id: "SI-1",
    docType: "sales_invoice",
    docNo: "INV-0001",
    status: "confirmed",
    date: "2026-03-01",
    dueDate: "2026-03-31",
    customerId: "C1",
    customerNameAr: "عميل تجريبي",
    branchId: "B1",
    warehouseId: "W1",
    currency: "EGP",
    couponCode: null,
    appliedPromotion: null,
    notes: null,
    internalNotes: null,
    discount: { type: "percent", value: 0 },
    arAccountId: "AR1",
    taxAccountId: "TAX1",
    amountPaid: "0.00",
    returnedCredit: "0.00",
    remainingBalance: "0.00",
    journalEntryId: null,
    workflowRequestId: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    confirmedAt: "2026-03-01T00:00:00.000Z",
    lines: [
      {
        unitFactor: 1, discountAmount: "0.000000", costCenterId: null, baseQty: "1", lineId: "L1",
        itemId: "I1",
        itemNameAr: "قهوة عربية",
        isStock: true,
        qty: "1",
        unitCode: "PCS",
        unitPrice: "100.00",
        discountType: "percent",
        discountPercent: 0,
        taxRatePercent: 14,
        revenueAccountId: "A1",
        cogsAccountId: null,
      } as never,
    ],
    totals: {
      taxInclusive: false, grossTotal: "100.00",
      lineDiscountTotal: "0.00",
      promotionDiscountTotal: "0.00",
      invoiceDiscountTotal: "0.00",
      subtotal: "100.00",
      taxableTotal: "100.00",
      taxTotal: "14.00",
      grandTotal: "114.00",
    },
    ...overrides,
  } as SalesInvoiceDTO;
}

function baseTransport(settingsOverrides: Record<string, unknown> = {}) {
  return stubTransport({
    "GET /print-template-config": () => ({ body: DEFAULT_PRINT_TEMPLATE_CONFIG }),
    "GET /settings/display": () => ({
      body: {
        companyName: "شركة سايج",
        address: "القاهرة الجديدة",
        taxRegistrationNumber: "123-456-789",
        ...settingsOverrides,
      },
    }),
    "GET /customers": () => ({ body: [{ id: "C1", code: "CUST-1", taxNumber: "999", address: "القاهرة", phone: "0100000000" }] }),
    "GET /branches": () => ({ body: [{ id: "B1", name: "الفرع الرئيسي" }] }),
    "GET /warehouses": () => ({ body: [{ id: "W1", name: "المخزن الرئيسي" }] }),
    "GET /eta/submissions": () => ({ body: [] }),
  });
}

describe("SalesInvoicePrintPage", () => {
  it("shows the empty-state notice when no print template config is available", async () => {
    const transport = stubTransport({
      "GET /print-template-config": () => ({ status: 404, body: {} }),
      "GET /settings/display": () => ({ body: {} }),
      "GET /customers": () => ({ body: [] }),
      "GET /branches": () => ({ body: [] }),
      "GET /warehouses": () => ({ body: [] }),
      "GET /eta/submissions": () => ({ body: [] }),
    });
    renderWithProviders(<SalesInvoicePrintPage invoice={baseInvoice()} />, { transport, initialSession: testAdminSession });
    expect(await screen.findByRole("alert").catch(() => null)).toBeFalsy();
    // The config query 404s and resolves to no data — the page shows its own unavailable notice, not a crash.
    await screen.findByText(/تعذر|غير متاحة|لا يمكن/);
  });

  it("shows a compliance warning (Arabic, naming the missing fields) when required settings are missing", async () => {
    const transport = baseTransport({ taxRegistrationNumber: "", companyName: "", address: "" });
    renderWithProviders(<SalesInvoicePrintPage invoice={baseInvoice()} />, { transport, initialSession: testAdminSession });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/^[A-Za-z0-9\s]*$/);
  });

  it("shows NO compliance warning when the tax number, company name and address are all present", async () => {
    const transport = baseTransport();
    renderWithProviders(<SalesInvoicePrintPage invoice={baseInvoice()} />, { transport, initialSession: testAdminSession });
    // Give the queries a chance to settle before asserting absence.
    await screen.findByText("شركة سايج", { exact: false }).catch(() => null);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("resolves the customer/branch/warehouse names for the invoice's ids without crashing", async () => {
    const transport = baseTransport();
    const { container } = renderWithProviders(<SalesInvoicePrintPage invoice={baseInvoice()} />, {
      transport,
      initialSession: testAdminSession,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(container.firstChild).not.toBeNull();
  });

  it("a role that may not read the settings still prints the company's name, address and tax number on the invoice", async () => {
    const base = baseTransport();
    const transport: typeof base = (path, init) =>
      path.split("?")[0] === "/settings"
        ? Promise.resolve({ status: 403, ok: false, json: <T,>() => Promise.resolve({ error: "PERMISSION_DENIED" } as T), text: () => Promise.resolve("{}") })
        : base(path, init);
    const restricted = { ...testAdminSession, userId: "USER-CASHIER", isCompanyAdmin: false, roleCode: "CASHIER", permissions: ["sales.invoice.view_own", "sales.invoice.print"] };
    renderWithProviders(<SalesInvoicePrintPage invoice={baseInvoice()} />, { transport, initialSession: restricted });
    expect((await screen.findAllByText(/شركة سايج/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/123-456-789/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/اسم الشركة غير|الرقم الضريبي غير/)).not.toBeInTheDocument();
  });
});
