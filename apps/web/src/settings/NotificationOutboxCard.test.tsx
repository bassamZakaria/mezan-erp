// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DrainOutcomeKind, type DrainResult } from "@mezan/domain";
import { NotificationOutboxCard } from "./NotificationOutboxCard";
import type { NotificationOutboxDTO } from "../data/notification-outbox-hooks";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { Session } from "../data/session";

const WAITING: NotificationOutboxDTO = {
  queued: 3,
  queuedIsCapped: false,
  oldestQueuedAt: "2026-09-12T08:00:00.000Z",
  mailConfigured: true,
  transportAvailable: true,
};

const DRAINED: DrainResult = {
  attempted: 3,
  sent: 1,
  stillQueued: 1,
  failed: 1,
  skipped: 0,
  outcomes: [
    { notificationId: "n1", title: "فاتورة جديدة", channel: "email", recipient: "owner@shop.test", outcome: DrainOutcomeKind.Sent, reason: null },
    { notificationId: "n2", title: "سند قبض", channel: "email", recipient: "ghost@shop.test", outcome: DrainOutcomeKind.Failed, reason: "العنوان غير موجود" },
    { notificationId: "n3", title: "أمر شراء", channel: "email", recipient: "buyer@shop.test", outcome: DrainOutcomeKind.StillQueued, reason: "لا يوجد اتصال" },
  ],
};

function transportWith(outbox: NotificationOutboxDTO, drains: string[] = [], drain: { status?: number; body: unknown } = { body: DRAINED }) {
  return stubTransport({
    "GET /notifications/outbox": () => ({ body: outbox }),
    "POST /notifications/drain": (_init, path) => {
      drains.push(path);
      return drain;
    },
  });
}

describe("NotificationOutboxCard — what is waiting to be emailed", () => {
  it("shows how many messages are waiting and the oldest of them", async () => {
    renderWithProviders(<NotificationOutboxCard />, { transport: transportWith(WAITING), initialSession: testAdminSession });
    const waiting = await screen.findByTestId("outbox-queued");
    expect(waiting).toHaveTextContent("3");
    expect(screen.getByTestId("outbox-oldest")).toHaveTextContent("2026");
    expect(screen.getByRole("button", { name: "إرسال الآن" })).toBeEnabled();
  });

  it("sends on request and reports each message — sent, refused with the server's reason, or still waiting", async () => {
    const drains: string[] = [];
    renderWithProviders(<NotificationOutboxCard />, { transport: transportWith(WAITING, drains), initialSession: testAdminSession });
    const send = await screen.findByRole("button", { name: "إرسال الآن" });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);

    await waitFor(() => expect(drains).toEqual(["/notifications/drain"]));
    const sent = await screen.findByRole("row", { name: /فاتورة جديدة/ });
    expect(within(sent).getByText("أُرسلت")).toBeInTheDocument();
    expect(within(sent).getByText("owner@shop.test")).toBeInTheDocument();
    const failed = screen.getByRole("row", { name: /سند قبض/ });
    expect(within(failed).getByText("فشلت")).toBeInTheDocument();
    expect(within(failed).getByText("العنوان غير موجود")).toBeInTheDocument();
    const still = screen.getByRole("row", { name: /أمر شراء/ });
    expect(within(still).getByText("ما زالت في الانتظار")).toBeInTheDocument();
    expect(within(still).getByText("لا يوجد اتصال")).toBeInTheDocument();
  });

  it("says mail is not configured and does not offer to send", async () => {
    const drains: string[] = [];
    renderWithProviders(<NotificationOutboxCard />, {
      transport: transportWith({ ...WAITING, mailConfigured: false }, drains),
      initialSession: testAdminSession,
    });
    expect(await screen.findByText(/البريد الإلكتروني غير مُفعَّل/)).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "إرسال الآن" });
    expect(send).toBeDisabled();
    fireEvent.click(send);
    expect(drains).toEqual([]);
  });

  it("says so when this server has no outbound channel at all", async () => {
    renderWithProviders(<NotificationOutboxCard />, {
      transport: transportWith({ ...WAITING, transportAvailable: false, mailConfigured: false }),
      initialSession: testAdminSession,
    });
    expect(await screen.findByText(/لا توجد قناة إرسال خارجية موصولة/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إرسال الآن" })).toBeDisabled();
  });

  it("does not offer to send when nothing is waiting", async () => {
    renderWithProviders(<NotificationOutboxCard />, {
      transport: transportWith({ ...WAITING, queued: 0, oldestQueuedAt: null }),
      initialSession: testAdminSession,
    });
    expect(await screen.findByText("لا توجد رسائل في الانتظار.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إرسال الآن" })).toBeDisabled();
  });

  it("shows the server's Arabic refusal when the send is refused", async () => {
    renderWithProviders(<NotificationOutboxCard />, {
      transport: transportWith(WAITING, [], { status: 409, body: { error: "NOTIFICATION_MAIL_NOT_CONFIGURED", message: "البريد الإلكتروني غير مُفعَّل في الإعدادات؛ لم يُرسَل شيء وبقيت الرسائل في الانتظار." } }),
      initialSession: testAdminSession,
    });
    const send = await screen.findByRole("button", { name: "إرسال الآن" });
    await waitFor(() => expect(send).toBeEnabled());
    fireEvent.click(send);
    expect(await screen.findByRole("alert")).toHaveTextContent("لم يُرسَل شيء وبقيت الرسائل في الانتظار");
  });

  it("renders nothing and asks nothing for a session that cannot edit the settings", async () => {
    const asked: string[] = [];
    const base = transportWith(WAITING);
    const session: Session = { ...testAdminSession, userId: "USER-R", isCompanyAdmin: false, permissions: ["notifications.rule.view", "admin.settings.view"], roleCode: "R" };
    const { container } = renderWithProviders(<NotificationOutboxCard />, {
      transport: (path, init) => {
        asked.push(path);
        return base(path, init);
      },
      initialSession: session,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked).not.toContain("/notifications/outbox");
    expect(container.querySelector("[data-testid='outbox-queued']")).toBeNull();
    expect(screen.queryByRole("button", { name: "إرسال الآن" })).not.toBeInTheDocument();
  });
});
