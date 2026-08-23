// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationDTO } from "@mezan/contracts";
import { useNotificationsBell } from "./NotificationsBell";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function notification(overrides: Partial<NotificationDTO> = {}): NotificationDTO {
  return {
    id: "n-1",
    ruleId: "rule-1",
    recipientUserId: testAdminSession.userId,
    eventCode: "SALES_INVOICE_CONFIRMED",
    title: "تم تأكيد فاتورة مبيعات",
    body: "رقم المستند: INV-000123 — العميل: شركة الأمل للتجارة",
    priority: "normal",
    channels: ["in_app"],
    channelStatus: { in_app: "delivered" },
    status: "unread",
    payload: { documentNumber: "INV-000123" },
    createdAt: new Date().toISOString(),
    readAt: null,
    ...overrides,
  };
}

/** Minimal host component — the real host is `<AppShell notificationsPanel={...}>` in App.tsx. */
function BellHarness() {
  const bell = useNotificationsBell();
  return (
    <div>
      <button type="button" onClick={bell.onToggle}>
        الإشعارات ({bell.unreadCount})
      </button>
      {bell.panel}
    </div>
  );
}

describe("useNotificationsBell", () => {
  it("shows the real unread count on the bell trigger", async () => {
    renderWithProviders(<BellHarness />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /notifications": () => ({ body: [notification()] }),
        "GET /notifications/unread-count": () => ({ body: { count: 1 } }),
      }),
    });
    expect(await screen.findByRole("button", { name: "الإشعارات (1)" })).toBeInTheDocument();
  });

  it("opens the panel and shows the real notification list", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BellHarness />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /notifications": () => ({ body: [notification()] }),
        "GET /notifications/unread-count": () => ({ body: { count: 1 } }),
      }),
    });
    await user.click(await screen.findByRole("button", { name: /الإشعارات/ }));
    expect(await screen.findByText("تم تأكيد فاتورة مبيعات")).toBeInTheDocument();
    expect(screen.getByText(/رقم المستند: INV-000123/)).toBeInTheDocument();
  });

  it("marks a notification read through POST /notifications/:id/read on click", async () => {
    const user = userEvent.setup();
    let read = false;
    renderWithProviders(<BellHarness />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /notifications": () => ({ body: [notification({ status: read ? "read" : "unread" })] }),
        "GET /notifications/unread-count": () => ({ body: { count: read ? 0 : 1 } }),
        "POST /notifications/n-1/read": () => {
          read = true;
          return { body: notification({ status: "read", readAt: "2026-08-23T10:00:00.000Z" }) };
        },
      }),
    });

    await user.click(await screen.findByRole("button", { name: /الإشعارات/ }));
    await user.click(await screen.findByText("تم تأكيد فاتورة مبيعات"));

    await waitFor(() => expect(screen.getByRole("button", { name: "الإشعارات (0)" })).toBeInTheDocument());
  });
});
