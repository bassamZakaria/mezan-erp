// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Topbar } from "./Topbar";
import type { ShellUser, UserMenuItem } from "./types";

const user: ShellUser = { name: "محمد الشهابي", role: "Company Admin", initials: "م.ش" };

describe("Topbar", () => {
  it("renders the search launcher, scope chip, and user chip", () => {
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} scopeLabel="الفرع الرئيسي" />);
    expect(screen.getByText("الفرع الرئيسي")).toBeInTheDocument();
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
    // The Ctrl+K hint is now two separate <kbd> elements, not one "Ctrl K" text node.
    expect(screen.getByText("Ctrl")).toBeInTheDocument();
    expect(screen.getByText("K")).toBeInTheDocument();
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

  it("opens the always-visible command bar's results on focus, superseding the old modal palette", () => {
    // onOpenCommandPalette is accepted for source compatibility only (see Topbar.tsx) — the
    // topbar now carries its own always-visible CommandBar instead of opening a modal.
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} />);
    expect(screen.queryByRole("listbox", { name: "لوحة الأوامر" })).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole("combobox", { name: "لوحة الأوامر" }));
    expect(screen.getByRole("listbox", { name: "لوحة الأوامر" })).toBeInTheDocument();
  });

  it("no longer renders a theme toggle — that control moved to the sidebar rail", () => {
    const onToggleTheme = vi.fn();
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={onToggleTheme} user={user} />);
    expect(screen.queryByRole("button", { name: "تبديل المظهر" })).not.toBeInTheDocument();
  });

  it("shows a notification badge only when notificationCount > 0", () => {
    const { rerender, container } = render(
      <Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} notificationCount={0} />,
    );
    expect(container.querySelector(".bg-danger")).not.toBeInTheDocument();

    rerender(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} notificationCount={3} />);
    expect(container.querySelector(".bg-danger")).toBeInTheDocument();
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
    const userMenuItems: UserMenuItem[] = [{ key: "users", label: "المستخدمون", onSelect: () => {} }];
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={() => {}} user={user} userMenuItems={userMenuItems} />);
    fireEvent.click(screen.getByRole("button", { name: /محمد الشهابي/ }));
    expect(screen.getByRole("menu", { name: "محمد الشهابي" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "محمد الشهابي" })).not.toBeInTheDocument();
  });

  it("renders against a dark theme root without crashing", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<Topbar onOpenCommandPalette={() => {}} theme="dark" onToggleTheme={() => {}} user={user} />);
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
    document.documentElement.removeAttribute("data-theme");
  });
});
