// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationDTO } from "@mezan/contracts";
import { NotificationsScreen } from "./NotificationsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { NavigationProvider } from "../navigation";
import type { ReactNode } from "react";
import { useState } from "react";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

/**
 * `useNavigation()` falls back to a no-op (console.warn) outside a real
 * `NavigationProvider` rather than throwing — this stands in one so the
 * empty-state CTA's `navigate("notification-rules")` call is observable.
 */
function TestNavigation({ children, navigate }: { children: ReactNode; navigate: (screen: string) => void }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate,
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

function notification(overrides: Partial<NotificationDTO> = {}): NotificationDTO {
  return {
    id: "notif-1",
    ruleId: "rule-1",
    recipientUserId: "USER-ADMIN",
    eventCode: "SALES_INVOICE_CONFIRMED",
    title: "تم تأكيد الفاتورة",
    body: "فاتورة مبيعات SI-000001 بقيمة 500 جنيه",
    priority: "normal",
    channels: ["in_app"],
    channelStatus: { in_app: "delivered" },
    status: "unread",
    payload: {},
    createdAt: "2026-08-20T10:00:00.000Z",
    readAt: null,
    ...overrides,
  };
}

function renderScreen(notifications: NotificationDTO[] = [notification()], navigate: (s: string) => void = () => {}) {
  let current = [...notifications];
  const readCalls: string[] = [];
  let markAllCalled = false;
  const transport = stubTransport({
    "GET /notifications": () => ({ body: current }),
    "GET /notifications/unread-count": () => ({ body: { count: current.filter((n) => n.status === "unread").length } }),
    "POST /notifications/*/read": (_init, path) => {
      const id = path.split("/")[2]!;
      readCalls.push(id);
      current = current.map((n) => (n.id === id ? { ...n, status: "read" as const, readAt: "2026-08-20T11:00:00.000Z" } : n));
      return { body: current.find((n) => n.id === id)! };
    },
    "POST /notifications/read-all": () => {
      markAllCalled = true;
      current = current.map((n) => ({ ...n, status: "read" as const, readAt: "2026-08-20T11:00:00.000Z" }));
      return { status: 204, body: null };
    },
  });
  const result = renderWithProviders(
    <TestNavigation navigate={navigate}>
      <NotificationsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
  return { ...result, getReadCalls: () => readCalls, wasMarkAllCalled: () => markAllCalled };
}

describe("NotificationsScreen", () => {
  it("lists notifications from the real /notifications feed", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الإشعارات" })).toBeInTheDocument();
    expect(await screen.findByText("تم تأكيد الفاتورة")).toBeInTheDocument();
    expect(screen.getByText("فاتورة مبيعات SI-000001 بقيمة 500 جنيه")).toBeInTheDocument();
    // Type column resolves the event code to its real Arabic label off the shared domain-events catalog.
    expect(screen.getByText("تم تأكيد فاتورة مبيعات")).toBeInTheDocument();
  });

  it("shows the true-empty state with a CTA that navigates to notification-rules", async () => {
    const navigate = vi.fn();
    renderScreen([], navigate);
    expect(await screen.findByText("لا توجد إشعارات بعد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعداد قواعد الإشعارات" }));
    expect(navigate).toHaveBeenCalledWith("notification-rules");
  });

  it("shows the filtered-empty state (distinct from true-empty) and its CTA clears the filters", async () => {
    renderScreen([notification()]);
    await screen.findByText("تم تأكيد الفاتورة");
    fireEvent.change(screen.getByPlaceholderText("ابحث في العنوان أو التفاصيل…"), { target: { value: "لا يوجد تطابق أبداً" } });
    expect(await screen.findByText("لا توجد نتائج مطابقة")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "مسح التصفية" }));
    await screen.findByText("تم تأكيد الفاتورة");
  });

  it("shows an Arabic error banner with a working retry on load failure", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /notifications": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "SERVER_ERROR" } } : { body: [notification()] };
      },
      "GET /notifications/unread-count": () => ({ body: { count: 1 } }),
    });
    renderWithProviders(
      <TestNavigation navigate={() => {}}>
        <NotificationsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    expect(await screen.findByText("تعذّر تحميل الإشعارات.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByText("تم تأكيد الفاتورة");
    expect(screen.queryByText("تعذّر تحميل الإشعارات.")).not.toBeInTheDocument();
  });

  it("the unread tab filters to unread rows only", async () => {
    renderScreen([notification(), notification({ id: "notif-2", title: "إشعار مقروء", status: "read", readAt: "2026-08-19T00:00:00.000Z" })]);
    await screen.findByText("تم تأكيد الفاتورة");
    expect(screen.getByText("إشعار مقروء")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /^غير مقروء/ }));
    expect(screen.getByText("تم تأكيد الفاتورة")).toBeInTheDocument();
    expect(screen.queryByText("إشعار مقروء")).not.toBeInTheDocument();
  });

  it("the priority filter narrows the rows", async () => {
    const user = userEvent.setup();
    renderScreen([notification(), notification({ id: "notif-2", title: "إشعار عاجل", priority: "urgent" })]);
    await screen.findByText("تم تأكيد الفاتورة");
    await user.click(screen.getByRole("combobox", { name: "الأولوية" }));
    await user.click(await screen.findByRole("option", { name: "عاجلة" }));
    expect(await screen.findByText("إشعار عاجل")).toBeInTheDocument();
    expect(screen.queryByText("تم تأكيد الفاتورة")).not.toBeInTheDocument();
  });

  it("the type filter narrows the rows to that event code", async () => {
    const user = userEvent.setup();
    renderScreen([
      notification(),
      notification({ id: "notif-2", title: "عرض سعر جديد لعميل", eventCode: "SALES_QUOTE_SENT" }),
    ]);
    await screen.findByText("تم تأكيد الفاتورة");
    await user.click(screen.getByRole("combobox", { name: "النوع" }));
    await user.click(await screen.findByRole("option", { name: "تم إرسال عرض سعر" }));
    expect(await screen.findByText("عرض سعر جديد لعميل")).toBeInTheDocument();
    expect(screen.queryByText("تم تأكيد الفاتورة")).not.toBeInTheDocument();
  });

  it("search narrows by title or body (debounced 300ms via useUrlSearch)", async () => {
    renderScreen([notification(), notification({ id: "notif-2", title: "شيء آخر تماماً", body: "بلا صلة" })]);
    await screen.findByText("تم تأكيد الفاتورة");
    fireEvent.change(screen.getByPlaceholderText("ابحث في العنوان أو التفاصيل…"), { target: { value: "SI-000001" } });
    await waitFor(() => expect(screen.queryByText("شيء آخر تماماً")).not.toBeInTheDocument(), { timeout: 1000 });
    expect(screen.getByText("تم تأكيد الفاتورة")).toBeInTheDocument();
  });

  it("marks a single unread notification read, but only offers that action while it is unread", async () => {
    const { getReadCalls } = renderScreen();
    const row = (await screen.findByText("تم تأكيد الفاتورة")).closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
    fireEvent.click(within(row).getByRole("menuitem", { name: "تعليم كمقروء" }));
    await waitFor(() => expect(getReadCalls()).toEqual(["notif-1"]));
  });

  it("a read notification's row offers no actions menu at all (RowMenu renders nothing for zero items)", async () => {
    renderScreen([notification({ status: "read", readAt: "2026-08-20T11:00:00.000Z" })]);
    const row = (await screen.findByText("تم تأكيد الفاتورة")).closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button", { name: /^إجراءات/ })).not.toBeInTheDocument();
  });

  it("mark-all-read is disabled when there is nothing unread", async () => {
    renderScreen([notification({ status: "read", readAt: "2026-08-20T11:00:00.000Z" })]);
    await screen.findByText("تم تأكيد الفاتورة");
    expect(screen.getByRole("button", { name: "تحديد الكل كمقروء" })).toBeDisabled();
  });

  it("mark-all-read posts to the real endpoint when there is something unread", async () => {
    const { wasMarkAllCalled } = renderScreen([notification()]);
    await screen.findByText("تم تأكيد الفاتورة");
    const button = screen.getByRole("button", { name: "تحديد الكل كمقروء" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(wasMarkAllCalled()).toBe(true));
  });

  it("renders createdAt as a formatted date/time, not the raw ISO string", async () => {
    renderScreen([notification({ createdAt: "2026-08-20T10:00:00.000Z" })]);
    await screen.findByText("تم تأكيد الفاتورة");
    expect(screen.queryByText("2026-08-20T10:00:00.000Z")).not.toBeInTheDocument();
  });
});
