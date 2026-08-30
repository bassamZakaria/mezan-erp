// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { RoleDTO, UserDTO } from "@mezan/contracts";
import { UsersPage } from "./UsersPage";
import { AppI18nProvider } from "../i18n";

/** UsersPage keeps its status filter in the URL (useUrlParam), so it needs a router. */
const render = (ui: React.ReactElement) =>
  rtlRender(
    <AppI18nProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </AppI18nProvider>,
  );

const role: RoleDTO = {
  id: "role-1",
  code: "VAN_SALES",
  name: "مندوب مبيعات",
  description: "",
  permissions: [],
  isSystem: false,
  createdAt: "2026-08-08T00:00:00.000Z",
};

const user: UserDTO = {
  id: "user-1",
  nameAr: "محمد الشهابي",
    nameEn: null,
  email: "mohamed@cyag.test",
  phone: null,
  hasPin: false,
  roleId: null,
  isCompanyAdmin: true,
  employeeId: null,
  branchScope: "*",
  warehouseScope: "*",
  status: "active",
  photoUrl: null,
  lastLoginAt: null,
  createdAt: "2026-08-08T00:00:00.000Z",
};

const branches = [{ id: "MAIN", name: "الفرع الرئيسي" }];
const warehouses = [{ id: "MAIN-WH", name: "مستودع الفرع الرئيسي", branchId: "MAIN" }];
const employees: { id: string; name: string; position: string }[] = [];

function renderPage(overrides: Partial<Parameters<typeof UsersPage>[0]> = {}) {
  return render(
    <UsersPage
      users={[user]}
      roles={[role]}
      branches={branches}
      warehouses={warehouses}
      employees={employees}
      onSave={vi.fn().mockResolvedValue({ ok: true })}
      onToggleStatus={vi.fn().mockResolvedValue({ ok: true })}
      {...overrides}
    />,
  );
}

const inactiveUser: UserDTO = {
  ...user,
  id: "user-2",
  nameAr: "سارة عبد الله",
  email: "sara@cyag.test",
  isCompanyAdmin: false,
  roleId: "role-1",
  status: "inactive",
};

describe("UsersPage", () => {
  it("filters to inactive users via the status chip", async () => {
    renderPage({ users: [user, inactiveUser] });
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
    expect(screen.getByText("سارة عبد الله")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /غير نشط/ }));
    expect(screen.getByText("سارة عبد الله")).toBeInTheDocument();
    // The status filter round-trips through the URL (useUrlParam), so the row list settles a tick later.
    await waitFor(() => expect(screen.queryByText("محمد الشهابي")).not.toBeInTheDocument());
  });

  it("lists users with their role badge", () => {
    renderPage();
    expect(screen.getByText("محمد الشهابي")).toBeInTheDocument();
    expect(screen.getByText("مدير المنشأة")).toBeInTheDocument();
  });

  it("opens the add-user panel and surfaces a validation error from the domain layer", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: "At least one branch is required." });
    renderPage({ onSave });

    fireEvent.click(screen.getByRole("button", { name: "إضافة مستخدم" }));
    fireEvent.change(screen.getByLabelText("الاسم بالعربية"), { target: { value: "مستخدم جديد" } });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني *", { exact: false }), { target: { value: "new@cyag.test" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));

    expect(await screen.findByText("At least one branch is required.")).toBeInTheDocument();
    expect(onSave).toHaveBeenCalled();
  });

  it("blocks saving with an Arabic message when the full name or email is empty, without calling onSave", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    renderPage({ onSave });

    fireEvent.click(screen.getByRole("button", { name: "إضافة مستخدم" }));
    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));

    expect(await screen.findByText("الاسم الكامل مطلوب.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("الاسم بالعربية"), { target: { value: "مستخدم جديد" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));

    expect(await screen.findByText("البريد الإلكتروني مطلوب.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("hides the role picker and clears roleId when company-admin is toggled on", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "إضافة مستخدم" }));
    expect(screen.getByText("الدور *")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /صلاحيات مدير المنشأة/ }));
    expect(screen.queryByText("الدور *")).not.toBeInTheDocument();
  });

  it("calls onToggleStatus with the inverted status when the row action is clicked", () => {
    const onToggleStatus = vi.fn().mockResolvedValue({ ok: true });
    renderPage({ onToggleStatus });
    fireEvent.click(screen.getByRole("button", { name: "تعطيل" }));
    expect(onToggleStatus).toHaveBeenCalledWith("user-1", "inactive");
  });

  it("associates the role and employee picker labels with their combobox inputs", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "إضافة مستخدم" }));
    expect(screen.getByLabelText("الدور *")).toHaveAttribute("role", "combobox");
    expect(screen.getByLabelText("الموظف المرتبط (اختياري)")).toHaveAttribute("role", "combobox");
  });
});
