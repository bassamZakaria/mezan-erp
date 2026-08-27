// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Topbar, type TopbarScopeOption } from "./Topbar";
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

  it("renders the appearance toggle beside the language switcher and fires it", () => {
    const onToggleTheme = vi.fn();
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" onToggleTheme={onToggleTheme} user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "تبديل المظهر" }));
    expect(onToggleTheme).toHaveBeenCalledOnce();
  });

  it("omits the appearance toggle when no handler is supplied", () => {
    render(<Topbar onOpenCommandPalette={() => {}} theme="light" user={user} />);
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

  it("renders the branch and warehouse switchers as real selects and narrows on change", () => {
    const branchOptions: TopbarScopeOption[] = [{ id: "BR-MAIN", label: "الفرع الرئيسي" }];
    const warehouseOptions: TopbarScopeOption[] = [{ id: "WH-MAIN", label: "المستودع الرئيسي" }];
    const onSelectBranch = vi.fn();
    render(
      <Topbar
        user={user}
        branchOptions={branchOptions}
        warehouseOptions={warehouseOptions}
        selectedBranchId={null}
        selectedWarehouseId={null}
        onSelectBranch={onSelectBranch}
      />,
    );
    const branchSelect = screen.getByRole("combobox", { name: "الفرع الحالي" });
    expect(screen.getByRole("combobox", { name: "المخزن الحالي" })).toBeInTheDocument();
    // `Select` is a portaled listbox, not a native <select>: it commits on the
    // option's mousedown, which is the only path a real user has.
    fireEvent.click(branchSelect);
    fireEvent.mouseDown(screen.getByRole("option", { name: "الفرع الرئيسي" }));
    expect(onSelectBranch).toHaveBeenCalledWith("BR-MAIN");
  });

  it("omits the scope switchers when no branch options are supplied — never a fabricated list", () => {
    render(<Topbar user={user} />);
    expect(screen.queryByRole("combobox", { name: "الفرع الحالي" })).not.toBeInTheDocument();
  });
});
