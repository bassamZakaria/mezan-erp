// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { ApprovalRequestDTO } from "@mezan/contracts";
import { ApprovalsInboxScreen } from "./ApprovalsInboxScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const pendingRequest: ApprovalRequestDTO = {
  id: "req-1",
  actionType: "SALES_INVOICE_CONFIRM",
  submittedBy: "alice",
  steps: [{ role: "SUPERVISOR" }, { role: "FINANCE_MANAGER" }],
  currentStep: 0,
  status: "pending",
  decisions: [],
  entityLabel: "فاتورة INV-000123",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
};

function renderScreen(requests: ApprovalRequestDTO[] = [pendingRequest]) {
  let current = [...requests];
  const decisions: unknown[] = [];
  const transport = stubTransport({
    "GET /workflow/requests/pending": () => ({ body: current }),
    "POST /workflow/requests/req-1/decide": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      decisions.push(body);
      const existing = current.find((r) => r.id === "req-1");
      if (!existing) return { status: 404, body: { error: "NOT_FOUND" } };
      let updated: ApprovalRequestDTO;
      if (body.decision === "reject") {
        updated = { ...existing, status: "rejected" };
      } else if (body.decision === "request_modification") {
        updated = { ...existing, status: "modification_requested" };
      } else {
        const isFinal = existing.currentStep >= existing.steps.length - 1;
        updated = isFinal
          ? { ...existing, status: "approved", currentStep: existing.steps.length }
          : { ...existing, currentStep: existing.currentStep + 1 };
      }
      current = current.filter((r) => r.id !== "req-1").concat(updated.status === "pending" ? [updated] : []);
      return { status: 200, body: updated };
    },
  });
  return { render: renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession }), decisions };
}

describe("ApprovalsInboxScreen", () => {
  it("lists a pending approval with its action type, entity, and required role", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الموافقات" })).toBeInTheDocument();
    expect(await screen.findByText("تأكيد فاتورة المبيعات")).toBeInTheDocument();
    expect(screen.getByText("فاتورة INV-000123")).toBeInTheDocument();
    expect(screen.getByText("SUPERVISOR")).toBeInTheDocument();
  });

  it("shows the empty state with no pending approvals", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد موافقات معلّقة")).toBeInTheDocument();
  });

  it("approves a request and it drops off the pending list once the chain is exhausted", async () => {
    const { decisions } = renderScreen([{ ...pendingRequest, currentStep: 1 }]);
    const table = await screen.findByRole("table");
    const row = (await within(table).findByText("تأكيد فاتورة المبيعات")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إجراءات فاتورة INV-000123" }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "موافقة" }));

    await screen.findByText("لا توجد موافقات معلّقة");
    expect(decisions).toEqual([{ decision: "approve", comment: undefined }]);
  });

  it("rejects a request with a comment", async () => {
    const { decisions } = renderScreen();
    const table = await screen.findByRole("table");
    const row = (await within(table).findByText("تأكيد فاتورة المبيعات")).closest("tr") as HTMLElement;
    fireEvent.change(within(row).getByPlaceholderText("ملاحظة (اختياري)"), { target: { value: "بيانات ناقصة" } });
    fireEvent.click(within(row).getByRole("button", { name: "إجراءات فاتورة INV-000123" }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "رفض" }));
    fireEvent.click(within(row).getByRole("button", { name: "رفض" }));

    await screen.findByText("لا توجد موافقات معلّقة");
    expect(decisions).toEqual([{ decision: "reject", comment: "بيانات ناقصة" }]);
  });

  it("requests a modification", async () => {
    const { decisions } = renderScreen();
    const table = await screen.findByRole("table");
    const row = (await within(table).findByText("تأكيد فاتورة المبيعات")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إجراءات فاتورة INV-000123" }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "طلب تعديل" }));

    await screen.findByText("لا توجد موافقات معلّقة");
    expect(decisions).toEqual([{ decision: "request_modification", comment: undefined }]);
  });

  it("surfaces a decision error without crashing the list", async () => {
    const current = [pendingRequest];
    const transport = stubTransport({
      "GET /workflow/requests/pending": () => ({ body: current }),
      "POST /workflow/requests/req-1/decide": () => ({ status: 409, body: { error: "NOT_PENDING", message: "الطلب لم يعد بانتظار الموافقة" } }),
    });
    renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession });
    const table = await screen.findByRole("table");
    const row = (await within(table).findByText("تأكيد فاتورة المبيعات")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "إجراءات فاتورة INV-000123" }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "موافقة" }));

    expect(await screen.findByText("الطلب لم يعد بانتظار الموافقة")).toBeInTheDocument();
    // The row survives the failed decision — still in the list.
    expect(within(await screen.findByRole("table")).getByText("تأكيد فاتورة المبيعات")).toBeInTheDocument();
  });

  it("shows a retry banner instead of the list when the pending requests fail to load", async () => {
    const transport = stubTransport({
      "GET /workflow/requests/pending": () => ({ status: 500, body: { error: "INTERNAL" } }),
    });
    renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل الموافقات المعلّقة. (رمز 500)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

/** guards §4.5 #13 — the error card shows the SERVER's reason, not the screen's fixed sentence. */
describe("ApprovalsInboxScreen — a 502 body reaches the error card", () => {
  it("renders the server's own Arabic reason", async () => {
    renderWithProviders(
      <ApprovalsInboxScreen />,
      {
        transport: stubTransport({
          "GET /workflow/requests/pending": () => ({ status: 502, body: { message: "تعذّر الوصول إلى الجهاز الرئيسي. الجهاز مغلق أو غير متصل بالشبكة." } }),
        }),
        initialSession: testAdminSession,
      },
    );

    expect(await screen.findByText("تعذّر الوصول إلى الجهاز الرئيسي. الجهاز مغلق أو غير متصل بالشبكة.")).toBeInTheDocument();
    expect(screen.queryByText("تعذّر تحميل الموافقات المعلّقة.")).not.toBeInTheDocument();
  });
});
