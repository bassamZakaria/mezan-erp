// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CustomerDTO } from "@mezan/contracts";
import { SalesQuotesScreen } from "./SalesQuotesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { SalesQuoteRecord } from "../data/hooks";

function customer(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cust-1",
    code: "C-001",
    nameAr: "متجر النور",
    nameEn: null,
    phone: null,
    email: null,
    contactPerson: null,
    taxNumber: null,
    category: null,
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "0",
    active: true,
    priceListId: null,
    creditLimit: "0",
    taxExempt: false,
    etaBuyerType: "auto",
    nationalId: null,
    ...overrides,
  };
}

function quote(overrides: Partial<SalesQuoteRecord> = {}): SalesQuoteRecord {
  return {
    id: "quote-1",
    docType: "SALES_QUOTE",
    docNo: "QT-000001",
    status: "draft",
    date: "2026-08-22",
    expiryDate: "2026-09-22",
    customerId: "cust-1",
    customerNameAr: "متجر النور",
    branchId: "BR1",
    currency: "EGP",
    notes: null,
    internalNotes: null,
    convertedInvoiceId: null,
    lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة استشارية", qty: "1", unitPrice: "500" }],
    totals: { subtotal: "500.000000", taxTotal: "0.000000", grandTotal: "500.000000" },
    ...overrides,
  };
}

describe("SalesQuotesScreen", () => {
  it("renders the real quotes list from GET /sales-quotes", async () => {
    renderWithProviders(<SalesQuotesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /sales-quotes": () => ({ body: [quote()] }),
        "GET /customers": () => ({ body: [customer()] }),
      }),
    });
    expect(await screen.findByText("QT-000001")).toBeInTheDocument();
    expect(screen.getAllByText("متجر النور").length).toBeGreaterThan(0);
  });

  it("shows the real empty state when there are no quotes", async () => {
    renderWithProviders(<SalesQuotesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /sales-quotes": () => ({ body: [] }),
        "GET /customers": () => ({ body: [customer()] }),
      }),
    });
    expect(await screen.findByText("لا توجد عروض أسعار — أنشئ عرضاً جديداً")).toBeInTheDocument();
  });

  it("creates a draft quote against a real customer through POST /sales-quotes", async () => {
    const user = userEvent.setup();
    let created: SalesQuoteRecord | null = null;
    renderWithProviders(<SalesQuotesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /sales-quotes": () => ({ body: created ? [created] : [] }),
        "GET /customers": () => ({ body: [customer()] }),
        "POST /sales-quotes": (init) => {
          const body = JSON.parse(String(init?.body));
          created = quote({ id: "quote-2", docNo: null, customerNameAr: body.customerNameAr });
          return { status: 201, body: created };
        },
      }),
    });

    await screen.findByText("لا توجد عروض أسعار — أنشئ عرضاً جديداً");
    await user.click(screen.getByRole("button", { name: "عرض سعر جديد" }));

    const dialog = screen.getByRole("dialog", { name: "عرض سعر جديد" });
    await user.selectOptions(within(dialog).getByLabelText("العميل *"), "cust-1");
    await user.type(within(dialog).getByLabelText("اسم الصنف"), "خدمة صيانة");
    await user.clear(within(dialog).getByLabelText("سعر الوحدة"));
    await user.type(within(dialog).getByLabelText("سعر الوحدة"), "250");
    await user.click(within(dialog).getByRole("button", { name: "حفظ كمسودة" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "عرض سعر جديد" })).not.toBeInTheDocument());
    expect(await screen.findAllByText("متجر النور")).not.toHaveLength(0);
  });

  it("walks the full lifecycle: send -> accept -> convert to invoice", async () => {
    const user = userEvent.setup();
    let current = quote({ status: "draft", docNo: "QT-000001" });
    renderWithProviders(<SalesQuotesScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /sales-quotes": () => ({ body: [current] }),
        "GET /customers": () => ({ body: [customer()] }),
        "POST /sales-quotes/quote-1/send": () => {
          current = { ...current, status: "sent" };
          return { body: current };
        },
        "POST /sales-quotes/quote-1/accept": () => {
          current = { ...current, status: "accepted" };
          return { body: current };
        },
        "POST /sales-quotes/quote-1/convert-to-invoice": () => {
          current = { ...current, status: "converted" };
          return { status: 201, body: { quote: current, invoiceId: "inv-9", invoiceDocNo: null } };
        },
      }),
    });

    await user.click(await screen.findByText("QT-000001"));
    const panel = screen.getByRole("dialog", { name: "QT-000001" });
    await user.click(within(panel).getByRole("button", { name: "إرسال للعميل" }));

    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "QT-000001" })).getByText("مرسل")).toBeInTheDocument());
    await user.click(within(screen.getByRole("dialog", { name: "QT-000001" })).getByRole("button", { name: "قبول العميل" }));

    await waitFor(() => expect(within(screen.getByRole("dialog", { name: "QT-000001" })).getByText("مقبول")).toBeInTheDocument());
    const acceptedPanel = screen.getByRole("dialog", { name: "QT-000001" });
    await user.type(within(acceptedPanel).getByLabelText("المستودع *"), "WH1");
    await user.click(within(acceptedPanel).getByRole("button", { name: "إنشاء الفاتورة" }));

    await waitFor(() =>
      expect(within(screen.getByRole("dialog", { name: "QT-000001" })).getByText("تم تحويل هذا العرض إلى فاتورة مبيعات.")).toBeInTheDocument(),
    );
  });
});
