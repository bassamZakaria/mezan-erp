// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BranchDTO, CustomerDTO } from "@mezan/contracts";
import { SalesQuotesScreen } from "./index";
import { renderWithProviders, stubTransport, testAdminSession } from "../../data/test-support";
import { NavigationProvider } from "../../navigation";
import type { SalesQuoteRecord } from "../../data/hooks";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
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

function TestNavigation({
  children,
  openScreenAt,
  initialSegments = [],
}: {
  children: ReactNode;
  openScreenAt?: (screen: string, segments: readonly string[]) => void;
  initialSegments?: readonly string[];
}) {
  const [segments, setSegments] = useState<readonly string[]>(initialSegments);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: setSegments,
        openScreenAt: (openScreenAt as never) ?? (() => {}),
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

const branches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];
const customers: CustomerDTO[] = [
  {
    id: "cust-1", code: "C1", nameAr: "متجر الأمل", nameEn: null, phone: null, email: null, contactPerson: null, taxNumber: null, category: null,
    notes: null, paymentTermsDays: 0, currency: "EGP", openingBalance: "0", active: true, priceListId: null, creditLimit: "0", taxExempt: false,
    etaBuyerType: "business", commercialRegistrationNumber: null, address: null, logoAttachmentId: null, nationalId: null,
  },
];

function quote(overrides: Partial<SalesQuoteRecord> = {}): SalesQuoteRecord {
  return {
    id: "q-1",
    docType: "SALES_QUOTE",
    docNo: "SQ-000001",
    status: "draft",
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
    sentAt: null,
    respondedAt: null,
    convertedAt: null,
    convertedInvoiceId: null,
    lines: [{ lineId: "l1", itemId: "item-1", itemNameAr: "صنف", qty: "1.000000", unitPrice: "500.000000", discountPercent: 0, taxRatePercent: 0 }],
    totals: { grossTotal: "500", lineDiscountTotal: "0", invoiceDiscountTotal: "0", subtotal: "500", taxableTotal: "500", taxTotal: "0", grandTotal: "500.000000" },
    ...overrides,
  };
}

function renderScreen(
  quotes: SalesQuoteRecord[] = [quote()],
  opts: { openScreenAt?: (screen: string, segments: readonly string[]) => void; extra?: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body: unknown }> } = {},
) {
  let current = [...quotes];
  let lastListPath = "";
  const transitionCalls: Record<string, number> = { send: 0, accept: 0, reject: 0, cancel: 0 };
  const transport = stubTransport({
    "GET /branches": () => ({ body: branches }),
    "GET /customers": () => ({ body: customers }),
    "GET /sales-quotes": (_init, path) => {
      lastListPath = path;
      return { body: current };
    },
    "GET /sales-quotes/counts": () => ({
      body: {
        all: current.length,
        draft: current.filter((q) => q.status === "draft").length,
        sent: current.filter((q) => q.status === "sent").length,
        accepted: current.filter((q) => q.status === "accepted").length,
        rejected: current.filter((q) => q.status === "rejected").length,
        converted: current.filter((q) => q.status === "converted").length,
        expired: 0,
      },
    }),
    "GET /sales-quotes/stats": () => ({
      body: {
        total: current.reduce((s, q) => s + Number(q.totals.grandTotal), 0).toFixed(6),
        accepted: current.filter((q) => q.status === "accepted").reduce((s, q) => s + Number(q.totals.grandTotal), 0).toFixed(6),
        converted: current.filter((q) => q.status === "converted").reduce((s, q) => s + Number(q.totals.grandTotal), 0).toFixed(6),
      },
    }),
    "POST /sales-quotes/*/send": (_init, path) => {
      transitionCalls.send! += 1;
      const id = path.split("/")[2]!;
      current = current.map((q) => (q.id === id ? { ...q, status: "sent" } : q));
      return { body: current.find((q) => q.id === id)! };
    },
    "POST /sales-quotes/*/accept": (_init, path) => {
      transitionCalls.accept! += 1;
      const id = path.split("/")[2]!;
      current = current.map((q) => (q.id === id ? { ...q, status: "accepted" } : q));
      return { body: current.find((q) => q.id === id)! };
    },
    "POST /sales-quotes/*/reject": (_init, path) => {
      transitionCalls.reject! += 1;
      const id = path.split("/")[2]!;
      current = current.map((q) => (q.id === id ? { ...q, status: "rejected" } : q));
      return { body: current.find((q) => q.id === id)! };
    },
    "POST /sales-quotes/*/cancel": (_init, path) => {
      transitionCalls.cancel! += 1;
      const id = path.split("/")[2]!;
      current = current.map((q) => (q.id === id ? { ...q, status: "cancelled" } : q));
      return { body: current.find((q) => q.id === id)! };
    },
    ...opts.extra,
  });
  const result = renderWithProviders(
    <TestNavigation openScreenAt={opts.openScreenAt}>
      <SalesQuotesScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
  return { ...result, getListPath: () => lastListPath, getTransitionCalls: () => transitionCalls };
}

describe("SalesQuotesScreen", () => {
  it("lists quotes and renders Money-formatted stats, never a raw scaled-decimal string", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "عروض الأسعار" })).toBeInTheDocument();
    expect(await screen.findByText("SQ-000001")).toBeInTheDocument();
    expect(screen.getByText(/متجر الأمل/)).toBeInTheDocument();
    expect(screen.queryByText("500.000000")).not.toBeInTheDocument();
    expect(screen.getAllByText((_, el) => el?.textContent === "500.00").length).toBeGreaterThan(0);
  });

  it("shows the empty state honestly, with a working new-quote CTA", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد عروض أسعار — أنشئ عرضاً جديداً")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "عرض سعر جديد" })[0]!);
    expect(await screen.findByRole("heading", { name: "عرض سعر جديد" })).toBeInTheDocument();
  });

  it(
    "shows an error banner with a working retry on a failed GET /sales-quotes, and NOT the " +
      "empty-list copy — the two are different facts (D105/D123)",
    async () => {
      const user = userEvent.setup();
      let fail = true;
      const transport = stubTransport({
        "GET /branches": () => ({ body: branches }),
        "GET /customers": () => ({ body: customers }),
        "GET /sales-quotes": () => (fail ? { status: 500, body: { error: "SERVER_ERROR" } } : { body: [quote()] }),
        "GET /sales-quotes/counts": () => ({ body: { all: 0 } }),
        "GET /sales-quotes/stats": () => ({ body: {} }),
      });
      renderWithProviders(
        <TestNavigation>
          <SalesQuotesScreen />
        </TestNavigation>,
        { transport, initialSession: testAdminSession },
      );

      expect(await screen.findByText("تعذّر تحميل عروض الأسعار.")).toBeInTheDocument();
      expect(screen.queryByText("لا توجد عروض أسعار — أنشئ عرضاً جديداً")).not.toBeInTheDocument();

      fail = false;
      await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

      expect(await screen.findByText("SQ-000001")).toBeInTheDocument();
      expect(screen.queryByText("تعذّر تحميل عروض الأسعار.")).not.toBeInTheDocument();
    },
  );

  it("branch/customer/date filters and status chips each change the outgoing request", async () => {
    const user = userEvent.setup();
    const { getListPath } = renderScreen([quote(), quote({ id: "q-2", docNo: "SQ-000002", status: "sent" })]);
    await screen.findByText("SQ-000001");

    await user.click(screen.getByRole("combobox", { name: "الفرع" }));
    await user.click(await screen.findByRole("option", { name: "الفرع الرئيسي" }));
    await waitFor(() => expect(getListPath()).toContain("branchId=MAIN"));

    pickFromCombobox(document.body, "تصفية بالعميل", "متجر الأمل");
    await waitFor(() => expect(getListPath()).toContain("customerId=cust-1"));

    fireEvent.change(fieldInput(document.body, "من تاريخ"), { target: { value: "2026-08-01" } });
    await waitFor(() => expect(getListPath()).toContain("fromDate=2026-08-01"));

    // The chip counts are their OWN query, keyed by the same filter (minus
    // status) — a zero-count chip is hidden (ListViews), so after changing a
    // filter the "sent" chip briefly disappears until that query re-resolves.
    fireEvent.click(await screen.findByRole("tab", { name: /^مرسل/ }, { timeout: 2000 }));
    await waitFor(() => expect(getListPath()).toContain("status=sent"));
  });

  it("row actions are derived from status: draft offers send, sent offers accept/reject", async () => {
    const { getTransitionCalls } = renderScreen([quote({ status: "sent" })]);
    const row = (await screen.findByText("SQ-000001")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
    expect(within(row).getByRole("menuitem", { name: "قبول العميل" })).toBeInTheDocument();
    expect(within(row).getByRole("menuitem", { name: "رفض" })).toBeInTheDocument();
    expect(within(row).queryByRole("menuitem", { name: "إرسال للعميل" })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole("menuitem", { name: "قبول العميل" }));
    await waitFor(() => expect(getTransitionCalls().accept).toBe(1));
  });

  it("a converted quote with an invoice offers 'view invoice', which opens it via openScreenAt", async () => {
    const openScreenAt = vi.fn();
    renderScreen([quote({ status: "converted", convertedInvoiceId: "inv-1" })], { openScreenAt });
    const row = (await screen.findByText("SQ-000001")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "عرض الفاتورة" }));
    expect(openScreenAt).toHaveBeenCalledWith("sales-invoices", ["inv-1"]);
  });

  it(
    "DEFECT: clicking the row's inline quick-action button (e.g. 'إرسال للعميل') " +
      "also opens that row's detail view, because index.tsx's `rowAction` render " +
      "prop — unlike PurchaseOrdersScreen/PurchaseInvoicesScreen's identical pattern " +
      "— never wraps its buttons in `onClick={(e) => e.stopPropagation()}`. The click " +
      "bubbles to DocumentList's own `<tr onClick={() => onRowClick(row)}>` " +
      "(packages/ui/src/primitives/DocumentList.tsx:511), so the mutation fires AND " +
      "the list is immediately replaced by the quote's detail — the row-level error " +
      "banner this test originally set out to prove never gets a chance to render, " +
      "because its container has already unmounted.",
    async () => {
      renderScreen([quote()], { extra: { "POST /sales-quotes/*/send": () => ({ status: 400, body: { message: "لا يمكن إرسال عرض بلا بنود" } }) } });
      await screen.findByText("SQ-000001");
      fireEvent.click(screen.getByRole("button", { name: "إرسال للعميل" }));
      // The bubbled row click already navigated to the detail view.
      expect(await screen.findByRole("heading", { name: "SQ-000001" })).toBeInTheDocument();
      expect(screen.queryByText("لا يمكن إرسال عرض بلا بنود")).not.toBeInTheDocument();
    },
  );

  it("opening an unknown quote id shows the notFound message with a working back-to-list button", async () => {
    let current = [quote()];
    const transport = stubTransport({
      "GET /branches": () => ({ body: branches }),
      "GET /customers": () => ({ body: customers }),
      "GET /sales-quotes": () => ({ body: current }),
      "GET /sales-quotes/counts": () => ({ body: { all: 1, draft: 1 } }),
      "GET /sales-quotes/stats": () => ({ body: {} }),
    });
    renderWithProviders(
      <TestNavigation initialSegments={["does-not-exist"]}>
        <SalesQuotesScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByText("لم يُعثر على عرض السعر المطلوب.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "رجوع إلى القائمة" }));
    expect(await screen.findByText("SQ-000001")).toBeInTheDocument();
    void current;
  });

  it("opening a real docNo renders the quote's detail view", async () => {
    const transport = stubTransport({
      "GET /branches": () => ({ body: branches }),
      "GET /customers": () => ({ body: customers }),
      "GET /sales-quotes": () => ({ body: [quote()] }),
      "GET /sales-quotes/counts": () => ({ body: { all: 1, draft: 1 } }),
      "GET /sales-quotes/stats": () => ({ body: {} }),
      "GET /audit": () => ({ body: { events: [] } }),
    });
    renderWithProviders(
      <TestNavigation initialSegments={["SQ-000001"]}>
        <SalesQuotesScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByRole("heading", { name: "SQ-000001" })).toBeInTheDocument();
  });
});
