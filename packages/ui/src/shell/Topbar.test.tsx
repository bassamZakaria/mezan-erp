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

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<Topbar onOpenCommandPalette={() => {}} theme="dark" onToggleTheme={() => {}} user={user} />);
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});
