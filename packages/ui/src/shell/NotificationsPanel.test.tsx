// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationsPanel, type NotificationPanelItem } from "./NotificationsPanel";

function makeItems(): NotificationPanelItem[] {
  return [
    { id: "n1", title: "تم تأكيد فاتورة مبيعات", body: "رقم المستند: INV-000123", timeLabel: "قبل 5 دقائق", read: false, priority: "high" },
    { id: "n2", title: "اكتمل أمر التصنيع", body: "WO-0010 — الكمية المنتجة: 2", timeLabel: "قبل 17 دقيقة", read: true, priority: "normal" },
  ];
}

describe("NotificationsPanel", () => {
  it("renders nothing when closed", () => {
    render(
      <NotificationsPanel
        open={false}
        onClose={() => {}}
        items={makeItems()}
        unreadCount={1}
        tab="all"
        onTabChange={() => {}}
        onMarkAllRead={() => {}}
        onItemClick={() => {}}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the unread count and every item's title when open", () => {
    render(
      <NotificationsPanel
        open
        onClose={() => {}}
        items={makeItems()}
        unreadCount={1}
        tab="all"
        onTabChange={() => {}}
        onMarkAllRead={() => {}}
        onItemClick={() => {}}
      />,
    );
    expect(screen.getByRole("dialog", { name: "الإشعارات" })).toBeInTheDocument();
    expect(screen.getByText("تم تأكيد فاتورة مبيعات")).toBeInTheDocument();
    expect(screen.getByText("اكتمل أمر التصنيع")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows the empty state when there are no items", () => {
    render(
      <NotificationsPanel
        open
        onClose={() => {}}
        items={[]}
        unreadCount={0}
        tab="all"
        onTabChange={() => {}}
        onMarkAllRead={() => {}}
        onItemClick={() => {}}
      />,
    );
    expect(screen.getByText("لا توجد إشعارات")).toBeInTheDocument();
  });

  it("shows the loading state instead of the empty state while loading", () => {
    render(
      <NotificationsPanel
        open
        onClose={() => {}}
        items={[]}
        unreadCount={0}
        tab="all"
        onTabChange={() => {}}
        onMarkAllRead={() => {}}
        onItemClick={() => {}}
        loading
      />,
    );
    expect(screen.getByText("جارِ التحميل…")).toBeInTheDocument();
    expect(screen.queryByText("لا توجد إشعارات")).not.toBeInTheDocument();
  });

  it("calls onTabChange when switching tabs", () => {
    const onTabChange = vi.fn();
    render(
      <NotificationsPanel
        open
        onClose={() => {}}
        items={makeItems()}
        unreadCount={1}
        tab="all"
        onTabChange={onTabChange}
        onMarkAllRead={() => {}}
        onItemClick={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/غير مقروء/));
    expect(onTabChange).toHaveBeenCalledWith("unread");
  });

  it("calls onItemClick with the clicked notification's id", () => {
    const onItemClick = vi.fn();
    render(
      <NotificationsPanel
        open
        onClose={() => {}}
        items={makeItems()}
        unreadCount={1}
        tab="all"
        onTabChange={() => {}}
        onMarkAllRead={() => {}}
        onItemClick={onItemClick}
      />,
    );
    fireEvent.click(screen.getByText("تم تأكيد فاتورة مبيعات"));
    expect(onItemClick).toHaveBeenCalledWith("n1");
  });

  it("calls onMarkAllRead when the header button is clicked", () => {
    const onMarkAllRead = vi.fn();
    render(
      <NotificationsPanel
        open
        onClose={() => {}}
        items={makeItems()}
        unreadCount={1}
        tab="all"
        onTabChange={() => {}}
        onMarkAllRead={onMarkAllRead}
        onItemClick={() => {}}
      />,
    );
    fireEvent.click(screen.getByText("تحديد الكل كمقروء"));
    expect(onMarkAllRead).toHaveBeenCalledOnce();
  });

  it("renders the عرض جميع الإشعارات footer only when onViewAll is supplied", () => {
    const { rerender } = render(
      <NotificationsPanel
        open
        onClose={() => {}}
        items={makeItems()}
        unreadCount={1}
        tab="all"
        onTabChange={() => {}}
        onMarkAllRead={() => {}}
        onItemClick={() => {}}
      />,
    );
    expect(screen.queryByText("عرض جميع الإشعارات")).not.toBeInTheDocument();

    rerender(
      <NotificationsPanel
        open
        onClose={() => {}}
        items={makeItems()}
        unreadCount={1}
        tab="all"
        onTabChange={() => {}}
        onMarkAllRead={() => {}}
        onItemClick={() => {}}
        onViewAll={() => {}}
      />,
    );
    expect(screen.getByText("عرض جميع الإشعارات")).toBeInTheDocument();
  });
});
