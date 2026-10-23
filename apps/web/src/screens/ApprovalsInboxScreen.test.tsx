// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { ApprovalRequestDTO } from "@mezan/contracts";
import { ApprovalsInboxScreen } from "./ApprovalsInboxScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { Transport } from "../data/transport";

const pendingRequest: ApprovalRequestDTO = {
  id: "req-1",
  actionType: "SALES_INVOICE_CONFIRM",
  submittedBy: "alice",
  submittedByName: null,
  documentId: null,
  documentNo: null,
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
  it("names the approver role and the submitter, not the role's code and the user's id", async () => {
    const transport = stubTransport({
      "GET /workflow/requests/pending": () => ({ body: [{ ...pendingRequest, submittedBy: "USER-77", steps: [{ role: "FINANCE_MANAGER" }], currentStep: 0 }] }),
      "GET /roles": () => ({ body: [{ id: "r1", code: "FINANCE_MANAGER", name: "المدير المالي", description: "", permissions: [], isSystem: false }] }),
      "GET /users": () => ({ body: [{ id: "USER-77", nameAr: "هالة مصطفى", nameEn: null, email: "hala@example.test" }] }),
    });
    renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("المدير المالي")).toBeInTheDocument();
    expect(await screen.findByText("هالة مصطفى")).toBeInTheDocument();
    expect(screen.queryByText("FINANCE_MANAGER")).toBeNull();
    expect(screen.queryByText("USER-77")).toBeNull();
  });

  it("lists a pending approval with its action type, entity, and required role", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الموافقات" })).toBeInTheDocument();
    expect(await screen.findByText("تأكيد فاتورة المبيعات")).toBeInTheDocument();
    expect(screen.getByText("فاتورة INV-000123")).toBeInTheDocument();
    expect(screen.getByText("SUPERVISOR")).toBeInTheDocument();
  });

  it("names who asked and the held document: the submitter's name, and the document's number or reference under its type", async () => {
    renderScreen([
      { ...pendingRequest, id: "req-held", actionType: "TREASURY_VOUCHER_CONFIRM", submittedBy: "5b1c9c2e-user", submittedByName: "أمين الخزينة سامي", entityLabel: null, documentId: "VCH-77", documentNo: null },
      { ...pendingRequest, id: "req-numbered", submittedBy: "9d0e-user", submittedByName: "منى المحاسبة", entityLabel: null, documentId: "inv-uuid", documentNo: "INV-000456" },
    ]);
    expect(await screen.findByText("أمين الخزينة سامي")).toBeInTheDocument();
    expect(screen.getByText("منى المحاسبة")).toBeInTheDocument();
    expect(screen.getByText("VCH-77")).toBeInTheDocument();
    expect(screen.getByText("INV-000456")).toBeInTheDocument();
    expect(screen.queryByText("inv-uuid")).not.toBeInTheDocument();
    expect(screen.queryByText("5b1c9c2e-user")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
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

describe("ApprovalsInboxScreen — طلباتي and إجراءاتي are paged on the server", () => {
  function mineTransport(total: number) {
    const asked: string[] = [];
    const transport = stubTransport({
      "GET /workflow/requests/pending": () => ({ body: [] }),
      "GET /workflow/requests/counts": (_init, path) => {
        const query = new URLSearchParams(path.split("?")[1]);
        const filtered = query.has("search") || query.has("actionType");
        return { body: filtered ? { mine: 1, acted: 0 } : { mine: total, acted: 3 } };
      },
      "GET /workflow/requests/mine": (_init, path) => {
        asked.push(path);
        const page = Number(new URLSearchParams(path.split("?")[1]).get("page") ?? "1");
        return { body: [{ ...pendingRequest, id: `mine-${page}`, status: "approved", entityLabel: `طلب صفحة ${page}` }] };
      },
    });
    return { transport, asked };
  }

  it("reads the tab totals from /counts, asks for one page, and pages on the server", async () => {
    const { transport, asked } = mineTransport(60);
    renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession });
    expect(asked).toEqual([]);

    fireEvent.click(await screen.findByRole("tab", { name: /طلباتي.*60/ }));
    expect(await screen.findByText("طلب صفحة 1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /إجراءاتي.*3/ })).toBeInTheDocument();
    expect(asked.at(-1)).toBe("/workflow/requests/mine?page=1&pageSize=25");

    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(await screen.findByText("طلب صفحة 3")).toBeInTheDocument();
    expect(asked.at(-1)).toBe("/workflow/requests/mine?page=3&pageSize=25");
    expect(screen.queryByRole("button", { name: "4" })).toBeNull();
  });

  it("sends the type filter and the search to the server instead of filtering a page", async () => {
    const { transport, asked } = mineTransport(1);
    renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByRole("tab", { name: /طلباتي/ }));
    await screen.findByText("طلب صفحة 1");
    fireEvent.change(screen.getByPlaceholderText("بحث بنوع الإجراء أو التفاصيل…"), { target: { value: "INV-9" } });
    await vi.waitFor(() => expect(asked.at(-1)).toBe(`/workflow/requests/mine?search=INV-9&page=1&pageSize=25`));
  });

  it("keeps the tab totals unfiltered while the pager follows the filtered count", async () => {
    const { transport } = mineTransport(60);
    renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByRole("tab", { name: /طلباتي.*60/ }));
    await screen.findByText("طلب صفحة 1");
    expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("بحث بنوع الإجراء أو التفاصيل…"), { target: { value: "INV-9" } });
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "2" })).toBeNull());
    expect(screen.getByRole("tab", { name: /طلباتي.*60/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /إجراءاتي.*3/ })).toBeInTheDocument();
  });
});

describe("ApprovalsInboxScreen — the paged tabs between pages", () => {
  it("keeps the current page on screen while the next one loads", async () => {
    const page2: { release?: () => void } = {};
    const stub = stubTransport({
      "GET /workflow/requests/pending": () => ({ body: [] }),
      "GET /workflow/requests/counts": () => ({ body: { mine: 60, acted: 0 } }),
      "GET /workflow/requests/mine": (_init, path) => {
        const page = Number(new URLSearchParams(path.split("?")[1]).get("page") ?? "1");
        return { body: [{ ...pendingRequest, id: `mine-${page}`, status: "approved", entityLabel: `طلب صفحة ${page}` }] };
      },
    });
    const transport: Transport = (path, init) =>
      path.includes("/mine?page=2") ? new Promise((resolve) => (page2.release = () => resolve(stub(path, init)))) : stub(path, init);
    renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByRole("tab", { name: /طلباتي/ }));
    await screen.findByText("طلب صفحة 1");

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    await vi.waitFor(() => expect(page2.release).toBeDefined());
    expect(screen.getByText("طلب صفحة 1")).toBeInTheDocument();

    page2.release?.();
    expect(await screen.findByText("طلب صفحة 2")).toBeInTheDocument();
  });

  it("keeps the pager from the same snapshot as the rows while a search's count loads", async () => {
    const stub = stubTransport({
      "GET /workflow/requests/pending": () => ({ body: [] }),
      "GET /workflow/requests/counts": () => ({ body: { mine: 60, acted: 0 } }),
      "GET /workflow/requests/mine": () => ({ body: [{ ...pendingRequest, id: "mine-1", status: "approved", entityLabel: "طلب صفحة 1" }] }),
    });
    const searched: string[] = [];
    const transport: Transport = (path, init) => {
      if (!path.includes("search=")) return stub(path, init);
      searched.push(path);
      return new Promise(() => {});
    };
    renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByRole("tab", { name: /طلباتي/ }));
    await screen.findByRole("button", { name: "2" });

    fireEvent.change(screen.getByPlaceholderText("بحث بنوع الإجراء أو التفاصيل…"), { target: { value: "INV-9" } });
    await vi.waitFor(() => expect(searched.some((path) => path.startsWith("/workflow/requests/counts"))).toBe(true));
    expect(screen.getByText("طلب صفحة 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2" })).toBeInTheDocument();
  });

  it("never shows one tab's rows under another while the other loads", async () => {
    const stub = stubTransport({
      "GET /workflow/requests/pending": () => ({ body: [] }),
      "GET /workflow/requests/counts": () => ({ body: { mine: 1, acted: 1 } }),
      "GET /workflow/requests/mine": () => ({ body: [{ ...pendingRequest, id: "mine-1", status: "approved", entityLabel: "طلب من طلباتي" }] }),
    });
    const transport: Transport = (path, init) => (path.startsWith("/workflow/requests/acted") ? new Promise(() => {}) : stub(path, init));
    renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession });
    fireEvent.click(await screen.findByRole("tab", { name: /طلباتي/ }));
    await screen.findByText("طلب من طلباتي");

    fireEvent.click(screen.getByRole("tab", { name: /إجراءاتي/ }));
    await vi.waitFor(() => expect(screen.queryByText("طلب من طلباتي")).toBeNull());
  });

  it("asks for no filtered counts while the inbox tab, which never reads them, is open", async () => {
    const asked: string[] = [];
    const stub = stubTransport({
      "GET /workflow/requests/pending": () => ({ body: [pendingRequest] }),
      "GET /workflow/requests/counts": () => ({ body: { mine: 0, acted: 0 } }),
    });
    const transport: Transport = (path, init) => {
      asked.push(path);
      return stub(path, init);
    };
    renderWithProviders(<ApprovalsInboxScreen />, { transport, initialSession: testAdminSession });
    fireEvent.change(await screen.findByPlaceholderText("بحث بنوع الإجراء أو التفاصيل…"), { target: { value: "INV-9" } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(asked.filter((path) => path.startsWith("/workflow/requests/counts"))).toEqual(["/workflow/requests/counts"]);
  });
});
