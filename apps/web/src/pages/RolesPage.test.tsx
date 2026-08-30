// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { RoleDTO as Role } from "@mezan/contracts";
import { RolesPage } from "./RolesPage";
import { AppI18nProvider } from "../i18n";

/** RolesPage keeps its kind filter in the URL (useUrlParam), so it needs a router. */
const render = (ui: React.ReactElement) =>
  rtlRender(
    <AppI18nProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </AppI18nProvider>,
  );

const role: Role = {
  id: "role-1",
  code: "VAN_SALES",
  name: "مندوب مبيعات",
  description: "",
  permissions: ["sales.invoice.view_own", "sales.invoice.create", "field.van_trip.view_own", "field.van_trip.open"],
  isSystem: false,
  createdAt: "2026-08-08T00:00:00.000Z",
};

const systemRole: Role = {
  id: "role-2",
  code: "ADMIN",
  name: "مدير النظام",
  description: "",
  permissions: [],
  isSystem: true,
  createdAt: "2026-08-08T00:00:00.000Z",
};

describe("RolesPage", () => {
  it("filters to system roles via the kind chip, then narrows further by search", async () => {
    render(
      <RolesPage
        roles={[role, systemRole]}
        usersByRoleId={new Map()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("مندوب مبيعات")).toBeInTheDocument();
    expect(screen.getByText("مدير النظام")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /نظام/ }));
    expect(screen.getByText("مدير النظام")).toBeInTheDocument();
    // The kind filter round-trips through the URL (useUrlParam), so the row list settles a tick later.
    await waitFor(() => expect(screen.queryByText("مندوب مبيعات")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: /الكل/ }));
    await screen.findByText("مندوب مبيعات");
    fireEvent.change(screen.getByPlaceholderText("بحث باسم الدور أو الكود…"), { target: { value: "VAN_SALES" } });
    expect(screen.getByText("مندوب مبيعات")).toBeInTheDocument();
    expect(screen.queryByText("مدير النظام")).not.toBeInTheDocument();
  });

  it("renders the role's permission count and custom/system badge", () => {
    render(<RolesPage roles={[role]} usersByRoleId={new Map()} onCreate={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("مندوب مبيعات")).toBeInTheDocument();
    expect(screen.getByText("VAN_SALES")).toBeInTheDocument();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("مخصص").length).toBeGreaterThan(0);
  });

  it("disables delete for a role still assigned to a user", () => {
    const usersByRoleId = new Map([["role-1", 1]]);
    render(<RolesPage roles={[role]} usersByRoleId={usersByRoleId} onCreate={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: "حذف" })).toBeDisabled();
  });

  it("allows delete for an unused custom role and calls onDelete", async () => {
    const onDelete = vi.fn().mockResolvedValue({ ok: true });
    render(<RolesPage roles={[role]} usersByRoleId={new Map()} onCreate={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={onDelete} />);
    const deleteButton = screen.getByRole("button", { name: "حذف" });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith("role-1");
  });

  it("calls onCreate when 'دور جديد' is clicked", () => {
    const onCreate = vi.fn();
    render(<RolesPage roles={[role]} usersByRoleId={new Map()} onCreate={onCreate} onEdit={vi.fn()} onDuplicate={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "دور جديد" }));
    expect(onCreate).toHaveBeenCalled();
  });
});
