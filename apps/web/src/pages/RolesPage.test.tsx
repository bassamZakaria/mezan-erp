// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import type { RoleDTO as Role } from "@mezan/contracts";
import { RolesPage } from "./RolesPage";
import { AppI18nProvider } from "../i18n";

const render = (ui: React.ReactElement) => rtlRender(<AppI18nProvider>{ui}</AppI18nProvider>);

const role: Role = {
  id: "role-1",
  code: "VAN_SALES",
  name: "مندوب مبيعات",
  description: "",
  permissions: ["sales.invoice.view_own", "sales.invoice.create", "field.van_trip.view_own", "field.van_trip.open"],
  isSystem: false,
  createdAt: "2026-08-08T00:00:00.000Z",
};

describe("RolesPage", () => {
  it("renders the role's permission count and custom/system badge", () => {
    render(<RolesPage roles={[role]} usersByRoleId={new Map()} onCreate={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("مندوب مبيعات")).toBeInTheDocument();
    expect(screen.getByText("VAN_SALES")).toBeInTheDocument();
    expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("مخصص").length).toBeGreaterThan(0);
  });

  it("disables delete for a role still assigned to a user", () => {
    const usersByRoleId = new Map([["role-1", 1]]);
    render(<RolesPage roles={[role]} usersByRoleId={usersByRoleId} onCreate={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: "حذف" })).toBeDisabled();
  });

  it("allows delete for an unused custom role and calls onDelete", async () => {
    const onDelete = vi.fn().mockResolvedValue({ ok: true });
    render(<RolesPage roles={[role]} usersByRoleId={new Map()} onCreate={vi.fn()} onEdit={vi.fn()} onDelete={onDelete} />);
    const deleteButton = screen.getByRole("button", { name: "حذف" });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith("role-1");
  });

  it("calls onCreate when 'دور جديد' is clicked", () => {
    const onCreate = vi.fn();
    render(<RolesPage roles={[role]} usersByRoleId={new Map()} onCreate={onCreate} onEdit={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "دور جديد" }));
    expect(onCreate).toHaveBeenCalled();
  });
});
