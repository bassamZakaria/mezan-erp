// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Topbar } from "./Topbar";
import type { ShellUser } from "./types";

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

  it("shows a notification badge only when there are real notifications", () => {
    const { rerender, container } = render(
      <Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} notifications={[]} />,
    );
    expect(container.querySelector(".bg-danger")).not.toBeInTheDocument();

    rerender(
      <Topbar
        onOpenCommandPalette={() => {}}
        theme="light"
        onToggleTheme={() => {}}
        user={user}
        notifications={[{ id: "n1", title: "أمر تصنيع مكتمل" }]}
      />,
    );
    expect(container.querySelector(".bg-danger")).toBeInTheDocument();
  });

  it("opens the notifications panel and shows the empty state when there is nothing to show", () => {
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "الإشعارات" }));
    expect(screen.getByText("لا توجد إشعارات")).toBeInTheDocument();
  });

  it("logs out from the user menu", () => {
    const onLogout = vi.fn();
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole("button", { name: /محمد الشهابي/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "تسجيل الخروج" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<Topbar onOpenCommandPalette={() => {}} theme="dark" onToggleTheme={() => {}} user={user} />);
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});
