// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SessionDTO, TaxRateDTO } from "@mezan/contracts";
import type { SalesInvoiceDTO } from "../data/hooks";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { DraftLineEditAction } from "./DraftLineEditAction";
import { VoidSalesInvoiceAction } from "./VoidSalesInvoiceAction";

const RATES = [
  { id: "VAT14", code: "VAT14", name: "ضريبة القيمة المضافة", rate: 14, status: "active", isSystem: false },
  { id: "SYS-NOT-SUBJECT", code: "SYS-NOT-SUBJECT", name: "غير خاضع", rate: 0, status: "active", isSystem: true },
] as unknown as TaxRateDTO[];

const LINE = { lineId: "A", itemNameAr: "خدمة", qty: "1.000000", unitPrice: "100.000000", taxRatePercent: 0, taxRateId: null };
const invoice = (status: string) => ({ id: "INV-1", docNo: "INV-000001", status, lines: [LINE] }) as unknown as SalesInvoiceDTO;
const viewer: SessionDTO = { ...testAdminSession, permissions: ["sales.invoice.view"] };

describe("DraftLineEditAction — «تعديل البند» on a draft", () => {
  it("is absent on a posted invoice and for a caller who may not edit", () => {
    const { unmount } = renderWithProviders(<DraftLineEditAction invoice={invoice("confirmed")} line={invoice("confirmed").lines[0]!} taxRates={RATES} />, { transport: stubTransport({}), initialSession: testAdminSession });
    expect(screen.queryByRole("button", { name: /تعديل البند/ })).toBeNull();
    unmount();
    renderWithProviders(<DraftLineEditAction invoice={invoice("draft")} line={invoice("draft").lines[0]!} taxRates={RATES} />, { transport: stubTransport({}), initialSession: viewer });
    expect(screen.queryByRole("button", { name: /تعديل البند/ })).toBeNull();
  });

  it("sends only what changed as exact decimals, never offers the system rate, and shows the server's refusal", async () => {
    const sent: unknown[] = [];
    let refuse = true;
    const transport = stubTransport({
      "PATCH /sales-invoices/*/lines/*": (init) => {
        sent.push(JSON.parse((init?.body as string) ?? "{}"));
        if (refuse) return { status: 409, body: { error: "SALES_INVOICE_NOT_DRAFT", message: "لا يُعدَّل بند فاتورة مرحّلة." } };
        return { body: invoice("draft") };
      },
    });
    renderWithProviders(<DraftLineEditAction invoice={invoice("draft")} line={invoice("draft").lines[0]!} taxRates={RATES} />, { transport, initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("button", { name: "تعديل البند «خدمة»" }));
    fireEvent.click(screen.getByLabelText("الضريبة"));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).not.toContain("غير خاضع · 0٪");
    fireEvent.mouseDown(screen.getByRole("option", { name: "ضريبة القيمة المضافة · 14٪" }));
    fireEvent.change(screen.getByLabelText("الكمية"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يُعدَّل بند فاتورة مرحّلة.");
    refuse = false;
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ qty: "2.5", taxRateId: "VAT14" });
  });
});

describe("VoidSalesInvoiceAction — «إلغاء الفاتورة»", () => {
  it("is offered only on a posted invoice to a caller who may void, needs a reason, and shows the server's Arabic refusal", async () => {
    const { unmount } = renderWithProviders(<VoidSalesInvoiceAction invoice={invoice("confirmed")} />, { transport: stubTransport({}), initialSession: viewer });
    expect(screen.queryByRole("button", { name: "إلغاء الفاتورة" })).toBeNull();
    unmount();
    const drafted = renderWithProviders(<VoidSalesInvoiceAction invoice={invoice("draft")} />, { transport: stubTransport({}), initialSession: testAdminSession });
    expect(screen.queryByRole("button", { name: "إلغاء الفاتورة" })).toBeNull();
    drafted.unmount();

    const sent: unknown[] = [];
    const transport = stubTransport({
      "POST /sales-invoices/*/void": (init) => {
        sent.push(JSON.parse((init?.body as string) ?? "{}"));
        return { status: 409, body: { error: "INVOICE_HAS_COLLECTIONS", message: "لا يمكن إلغاء فاتورة حُصّلت مبالغ عليها — اعكس التحصيل أولاً." } };
      },
    });
    renderWithProviders(<VoidSalesInvoiceAction invoice={invoice("confirmed")} />, { transport, initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("button", { name: "إلغاء الفاتورة" }));
    const confirm = screen.getAllByRole("button", { name: "إلغاء الفاتورة" }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("سبب الإلغاء"), { target: { value: "خطأ" } });
    fireEvent.click(screen.getAllByRole("button", { name: "إلغاء الفاتورة" }).at(-1)!);
    expect(await screen.findByRole("alert")).toHaveTextContent("اعكس التحصيل أولاً");
    expect(sent).toEqual([{ reason: "خطأ" }]);
  });
});
