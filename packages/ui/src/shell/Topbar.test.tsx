// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Topbar } from "./Topbar";
import type { NotificationItem, ShellUser, UserMenuItem } from "./types";

const user: ShellUser = { name: "محمد الشهابي", role: "Company Admin", initials: "م.ش" };

describe("Topbar", () => {
  it("renders the search launcher, scope chip, and user chip", () => {
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} scopeLabel="الفرع الرئيسي" />);
    expect(screen.getByText("الفرع الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
    expect(screen.getByText("Ctrl K")).toBeInTheDocument();
  });

  it("renders the tenant chip only when tenantName is supplied", () => {
    const { rerender } = render(
      <Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} />,
    );
    expect(screen.queryByText("Cyag")).not.toBeInTheDocument();

    rerender(
      <Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} tenantName="Cyag" />,
    );
    expect(screen.getByText("Cyag")).toBeInTheDocument();
  });

  it("calls onOpenCommandPalette when the search button is clicked", () => {
    const onOpenCommandPalette = vi.fn();
    render(<Topbar onOpenCommandPalette={onOpenCommandPalette} theme="light" onToggleTheme={() => {}} user={user} />);
    fireEvent.click(screen.getByText("بحث عن صفحة، عميل، فاتورة، أو إجراء…"));
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
  });

  it("calls onToggleTheme when the theme button is clicked", () => {
    const onToggleTheme = vi.fn();
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={onToggleTheme} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "تبديل المظهر" }));
    expect(onToggleTheme).toHaveBeenCalledOnce();
  });

  it("shows a notification badge only when notificationCount > 0", () => {
    const { rerender, container } = render(
      <Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} notificationCount={0} />,
    );
    expect(container.querySelector(".bg-danger")).not.toBeInTheDocument();

    rerender(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} notificationCount={3} />);
    expect(container.querySelector(".bg-danger")).toBeInTheDocument();
  });

  it("derives the notification badge from the notifications list when no count is given", () => {
    const notifications: NotificationItem[] = [{ key: "a", title: "أقساط متأخرة" }];
    const { container } = render(
      <Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} notifications={notifications} />,
    );
    expect(container.querySelector(".bg-danger")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "الإشعارات (1)" })).toBeInTheDocument();
  });

  it("opens the notifications panel and shows an empty state when there is nothing to report", () => {
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "الإشعارات" }));
    expect(screen.getByRole("menu", { name: "الإشعارات" })).toBeInTheDocument();
    expect(screen.getByText("لا توجد تنبيهات بعد.")).toBeInTheDocument();
  });

  it("runs a notification's onSelect and closes the panel", () => {
    const onSelect = vi.fn();
    const notifications: NotificationItem[] = [{ key: "a", title: "أقساط متأخرة", detail: "3 أقساط", onSelect }];
    render(
      <Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} notifications={notifications} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "الإشعارات (1)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /أقساط متأخرة/ }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu", { name: "الإشعارات" })).not.toBeInTheDocument();
  });

  it("opens the user menu, runs an item, and closes", () => {
    const onSelect = vi.fn();
    const userMenuItems: UserMenuItem[] = [{ key: "users", label: "المستخدمون", onSelect }];
    render(
      <Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} userMenuItems={userMenuItems} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /محمد الشهابي/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "المستخدمون" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menuitem", { name: "المستخدمون" })).not.toBeInTheDocument();
  });

  it("closes an open menu on Escape", () => {
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "الإشعارات" }));
    expect(screen.getByRole("menu", { name: "الإشعارات" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "الإشعارات" })).not.toBeInTheDocument();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<Topbar onOpenCommandPalette={() => {}} theme="dark" onToggleTheme={() => {}} user={user} />);
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});
