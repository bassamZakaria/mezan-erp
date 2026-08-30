// @vitest-environment jsdom
import { useState } from "react";
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

/**
 * D113: the panel is portaled to <body> and announces `aria-modal`. Without
 * moving focus in, the keyboard user who pressed the bell is still on the
 * bell and Tab walks the page behind the "modal"; without putting focus back,
 * closing it strands them on <body>.
 */
describe("NotificationsPanel — focus management (D113)", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          الإشعارات
        </button>
        <NotificationsPanel
          open={open}
          onClose={() => setOpen(false)}
          items={makeItems()}
          unreadCount={1}
          tab="all"
          onTabChange={() => {}}
          onMarkAllRead={() => {}}
          onItemClick={() => {}}
        />
      </>
    );
  }

  it("moves focus into the dialog when it opens", () => {
    render(<Harness />);
    const bell = screen.getByRole("button", { name: "الإشعارات" });
    bell.focus();
    fireEvent.click(bell);
    const dialog = screen.getByRole("dialog", { name: "الإشعارات" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("returns focus to the control that opened it when it closes", () => {
    render(<Harness />);
    const bell = screen.getByRole("button", { name: "الإشعارات" });
    bell.focus();
    fireEvent.click(bell);
    // Focus is inside the dialog when Escape arrives — the element it is on is
    // about to be destroyed, which is the whole reason the restore is needed.
    screen.getByRole("dialog", { name: "الإشعارات" }).querySelector("button")!.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(bell);
  });

  it("keeps Tab inside the dialog, which is what aria-modal promises", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "الإشعارات" }));
    const dialog = screen.getByRole("dialog", { name: "الإشعارات" });
    const stops = [...dialog.querySelectorAll<HTMLElement>("button")];
    // jsdom never lays anything out, so every `offsetParent` is null and the
    // trap would treat the whole dialog as invisible. Declare them visible.
    for (const el of stops) Object.defineProperty(el, "offsetParent", { value: document.body, configurable: true });
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
