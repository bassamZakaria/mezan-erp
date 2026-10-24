// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { InstallmentPlanDocumentDTO } from "@mezan/contracts";
import type { SalesInvoiceDTO } from "../data/hooks";
import { InstallmentPlansScreen } from "./InstallmentPlansScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

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
    remainingBalance: "600.000000",
    journalEntryId: "je-1",
    workflowRequestId: null,
    createdAt: "2026-08-10T09:00:00.000Z",
    confirmedAt: "2026-08-10T09:05:00.000Z",
    projectId: null,
    fxRate: null,
    lines: [
      {
        unitCode: "", unitFactor: 1, discountType: "percent", discountAmount: "0.000000", costCenterId: null, taxRateId: null, baseQty: "10.000000", lineId: "l1", itemId: "item-cement", itemNameAr: "أسمنت بورتلاندي", isStock: true, qty: "10.000000",
        unitPrice: "60.000000", discountPercent: 0, taxRatePercent: 0, revenueAccountId: "acc-rev",
        cogsAccountId: "acc-cogs", inventoryAccountId: "acc-inv", unitCost: "50.000000",
      },
    ],
    totals: { taxInclusive: false, grossTotal: "600.000000", lineDiscountTotal: "0", promotionDiscountTotal: "0", invoiceDiscountTotal: "0", subtotal: "600.000000", taxableTotal: "600.000000", taxTotal: "0", grandTotal: "600.000000" },
    ...overrides,
    baseGrandTotal: overrides.baseGrandTotal ?? overrides.totals?.grandTotal ?? "600.000000",
  };
}

function installmentPlan(overrides: Partial<InstallmentPlanDocumentDTO> = {}): InstallmentPlanDocumentDTO {
  return {
    id: "plan-1",
    docType: "INSTALLMENT_PLAN",
    docNo: "IP-000001",
    date: "2026-08-20",
    memo: "",
    status: "confirmed",
    lines: [
      {
        no: 1, customerId: "cust-1", sourceInvoiceId: "inv-1", sourceInvoiceNumber: "INV-000123",
        frequency: "MONTHLY", downPayment: "0", dueDate: "2026-09-20", amount: "300.00",
        paidAmount: "0", status: "pending", lateFeeAmount: "0",
      },
      {
        no: 2, customerId: "cust-1", sourceInvoiceId: "inv-1", sourceInvoiceNumber: "INV-000123",
        frequency: "MONTHLY", downPayment: "0", dueDate: "2026-10-20", amount: "300.00",
        paidAmount: "0", status: "pending", lateFeeAmount: "0",
      },
    ],
    createdAt: "2026-08-20T09:00:00.000Z",
    confirmedAt: "2026-08-20T09:05:00.000Z",
    reversesDocId: null,
    reversedByDocId: null,
    workflowRequestId: null,
    journalEntryId: null,
    ...overrides,
  };
}

function baseHandlers(plans: InstallmentPlanDocumentDTO[], invoicePaths: string[] = []) {
  return {
    "GET /sales-invoices": (_init: RequestInit | undefined, path: string) => {
      invoicePaths.push(path);
      return { body: [salesInvoice()] };
    },
    "GET /sales-invoices/*": (_init: RequestInit | undefined, path: string) =>
      path.split("?")[0]!.endsWith(`/${salesInvoice().id}`) ? { body: salesInvoice() } : { status: 404, body: { error: "NOT_FOUND" } },
    "GET /installments/plans": () => ({ body: plans }),
  };
}

describe("InstallmentPlansScreen", () => {
  it("shows the empty state when there are no plans", async () => {
    const transport = stubTransport(baseHandlers([]));
    renderWithProviders(<InstallmentPlansScreen />, { transport, initialSession: testAdminSession });
    expect(screen.getByRole("heading", { name: "خطط الأقساط" })).toBeInTheDocument();
    expect(await screen.findByText("أنشئ خطة أقساط لتقسيم مبلغ الفاتورة على دفعات")).toBeInTheDocument();
  });

  it("lists installment plans from the real API", async () => {
    const transport = stubTransport(baseHandlers([installmentPlan()]));
    renderWithProviders(<InstallmentPlansScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("IP-000001")).toBeInTheDocument();
    expect(screen.getByText("INV-000123")).toBeInTheDocument();
  });

  it("creates a plan against a confirmed sales invoice and confirms it", async () => {
    const generatedId = "plan-0001-0000-0000-000000000000";
    const uuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(generatedId as ReturnType<typeof crypto.randomUUID>);
    let current: InstallmentPlanDocumentDTO[] = [];
    const invoicePaths: string[] = [];
    const transport = stubTransport({
      ...baseHandlers(current, invoicePaths),
      "GET /installments/plans": () => ({ body: current }),
      "POST /installments/plans": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const created = installmentPlan({ id: body.id, docNo: null, status: "draft", confirmedAt: null });
        current = [...current, created];
        return { status: 201, body: created };
      },
      [`POST /installments/plans/${generatedId}/confirm`]: () => {
        current = current.map((d) => (d.id === generatedId ? { ...d, status: "confirmed" as const, docNo: "IP-000001", confirmedAt: "2026-08-20T10:00:00.000Z" } : d));
        return { body: { document: current[0], held: false } };
      },
    });
    renderWithProviders(<InstallmentPlansScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText("أنشئ خطة أقساط لتقسيم مبلغ الفاتورة على دفعات");
    // The header action and the empty state's own action both read "خطة جديدة"
    // while the list is empty — the header one is used here.
    fireEvent.click(screen.getAllByRole("button", { name: "خطة جديدة" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "خطة أقساط جديدة" });
    expect(within(dialog).queryByText(/#1/)).toBeNull();
    fireEvent.focus(within(dialog).getByRole("combobox", { name: "الفاتورة *" }));
    fireEvent.mouseDown(await within(dialog).findByText(new RegExp(salesInvoice().docNo ?? salesInvoice().id)));
    await within(dialog).findByText(/#1/);
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(await screen.findByText("IP-000001")).toBeInTheDocument();
    // The picker asks for one small page of OPEN invoices — never the whole table.
    expect(invoicePaths.length).toBeGreaterThan(0);
    for (const path of invoicePaths) {
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      expect(params.get("status")).toBe("open");
      expect(params.get("page")).toBe("1");
      expect(params.get("pageSize")).toBe("20");
    }
    uuidSpy.mockRestore();
  });

  it("cancels a confirmed plan", async () => {
    let current: InstallmentPlanDocumentDTO[] = [installmentPlan()];
    let cancels = 0;
    const transport = stubTransport({
      ...baseHandlers(current),
      "GET /installments/plans": () => ({ body: current }),
      "POST /installments/plans/plan-1/cancel": () => {
        cancels += 1;
        current = current.map((d) => (d.id === "plan-1" ? { ...d, status: "cancelled" as const } : d));
        return { body: current[0] };
      },
    });
    renderWithProviders(<InstallmentPlansScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("IP-000001"));
    const dialog = screen.getByRole("dialog", { name: "IP-000001" });
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء الخطة" }));

    await within(dialog).findByText("ملغي");
    expect(cancels).toBe(1);
    // Cancelling must not stay a dialog-local flourish: the list behind it
    // has to reflect the new status too, or the user closes the panel and
    // sees a plan that still looks live.
    await waitFor(() => expect(within(screen.getByRole("table")).getByText("ملغي")).toBeInTheDocument());
    // And an already-cancelled plan cannot be cancelled again.
    expect(within(dialog).queryByRole("button", { name: "إلغاء الخطة" })).toBeNull();
  });
});

describe("InstallmentPlansScreen — a held document whose approval no longer stands", () => {
  it("says why in Arabic and asks for approval again through the document's own confirm", async () => {
    let standing = "reapproval_required";
    let confirms = 0;
    const held = installmentPlan({ id: "held-1", docNo: "HELD-0001", status: "pending", workflowRequestId: "held-1:confirm" });
    const transport = stubTransport({
      ...baseHandlers([]),
      "GET /installments/plans": () => ({ body: [held] }),
      "GET /workflow/requests/*/standing": () => ({ body: { id: "held-1:confirm", status: standing, reason: standing === "reapproval_required" ? "الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد." : null, reasonEn: null } }),
      "POST /installments/plans/held-1/confirm": () => {
        confirms += 1;
        standing = "pending";
        return { body: held };
      },
    });
    renderWithProviders(<InstallmentPlansScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByText("HELD-0001"));
    const notice = await screen.findByTestId("reapproval-notice");
    expect(notice).toHaveTextContent("الموافقة السابقة لم تعد صالحة للترحيل. اطلب الموافقة من جديد.");
    fireEvent.click(within(notice).getByRole("button", { name: "طلب الموافقة من جديد" }));
    await waitFor(() => expect(confirms).toBe(1));
    await waitFor(() => expect(screen.queryByTestId("reapproval-notice")).not.toBeInTheDocument());
  });
});
