// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppShell } from "./AppShell";
import type { CommandItem, NavItem, ShellUser } from "./types";

const topNavItem: NavItem = { key: "dashboard", label: "لوحة التحكم" };
const user: ShellUser = { name: "محمد الشهابي", role: "Company Admin", initials: "م.ش" };

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});

describe("AppShell", () => {
  it("renders the sidebar, topbar, and page children together", () => {
    render(
      <AppShell activeNavKey="dashboard" topNavItem={topNavItem} navGroups={[]} user={user}>
        <div>محتوى الصفحة</div>
      </AppShell>,
    );
    expect(screen.getByText("ميزان")).toBeInTheDocument();
    // Appears once in the sidebar footer and once in the topbar user chip.
    expect(screen.getAllByText("محمد الشهابي")).toHaveLength(2);
    expect(screen.getByText("محتوى الصفحة")).toBeInTheDocument();
  });

  it("opens the command palette from the topbar search button", () => {
    render(
      <AppShell activeNavKey="dashboard" topNavItem={topNavItem} navGroups={[]} user={user}>
        <div>محتوى</div>
      </AppShell>,
    );
    expect(screen.queryByRole("dialog", { name: "لوحة الأوامر" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("بحث عن صفحة، عميل، فاتورة، أو إجراء…"));
    expect(screen.getByRole("dialog", { name: "لوحة الأوامر" })).toBeInTheDocument();
  });

  it("opens the command palette on Ctrl+K", () => {
    render(
      <AppShell activeNavKey="dashboard" topNavItem={topNavItem} navGroups={[]} user={user}>
        <div>محتوى</div>
      </AppShell>,
    );
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "لوحة الأوامر" })).toBeInTheDocument();
  });

  it("runs a command item's onSelect from the palette", () => {
    const onSelect = vi.fn();
    const commandItems: CommandItem[] = [{ id: "go-coa", label: "دليل الحسابات", group: "الانتقال إلى", onSelect }];
    render(
      <AppShell activeNavKey="dashboard" topNavItem={topNavItem} navGroups={[]} user={user} commandItems={commandItems}>
        <div>محتوى</div>
      </AppShell>,
    );
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByText("دليل الحسابات"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("toggles the theme via the topbar button and applies [data-theme]", () => {
    render(
      <AppShell activeNavKey="dashboard" topNavItem={topNavItem} navGroups={[]} user={user}>
        <div>محتوى</div>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "تبديل المظهر" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
