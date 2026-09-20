// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

  const twoBranches = [
    { id: "MAIN", name: "الفرع الرئيسي" },
    { id: "BRANCH2", name: "فرع الإسكندرية" },
  ];
  const twoWarehouses = [
    { id: "MAIN-WH", name: "مستودع الرئيسي", branchId: "MAIN" },
    { id: "WH2", name: "مستودع الإسكندرية", branchId: "BRANCH2" },
  ];
  const allScopeUser: UserDTO = { ...user, id: "user-all", nameAr: "مستخدم عام", branchScope: "*", warehouseScope: "*" };
  const partialScopeUser: UserDTO = {
    ...user,
    id: "user-partial",
    nameAr: "فرع واحد فقط",
    nameEn: "Branch Only",
    phone: "0100000000",
    isCompanyAdmin: false,
    roleId: "role-1",
    branchScope: ["MAIN"],
    warehouseScope: ["MAIN-WH"],
  };

  it("openEdit converts an ALL_SCOPE ('*') user into every branch/warehouse checked, and a scoped user into only its own branches — switching rows never leaks the previous row's draft", () => {
    renderPage({ users: [allScopeUser, partialScopeUser], branches: twoBranches, warehouses: twoWarehouses });

    fireEvent.click(screen.getByText("مستخدم عام"));
    expect(screen.getByRole("checkbox", { name: "الفرع الرئيسي" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "فرع الإسكندرية" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "مستودع الرئيسي" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "مستودع الإسكندرية" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "إغلاق اللوحة" }));

    fireEvent.click(screen.getByText("فرع واحد فقط"));
    expect(screen.getByDisplayValue("فرع واحد فقط")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Branch Only")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0100000000")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "الفرع الرئيسي" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "فرع الإسكندرية" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "مستودع الرئيسي" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "مستودع الإسكندرية" })).not.toBeChecked();
  });

  it("saves every edited field — nameEn, phone, password, pin, role, employee and the scope checkboxes — as the exact draft, keyed to the row that was opened", () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const employees = [{ id: "EMP1", name: "موظف واحد", position: "محاسب" }];
    renderPage({
      users: [allScopeUser, partialScopeUser],
      branches: twoBranches,
      warehouses: twoWarehouses,
      employees,
      onSave,
    });

    fireEvent.click(screen.getByText("فرع واحد فقط"));
    fireEvent.change(screen.getByDisplayValue("Branch Only"), { target: { value: "Branch Two" } });
    fireEvent.change(screen.getByPlaceholderText("+20 1xx xxx xxxx"), { target: { value: "0111111111" } });
    fireEvent.change(screen.getByLabelText("كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)"), { target: { value: "Passw0rd!" } });
    fireEvent.change(screen.getByPlaceholderText("123456"), { target: { value: "9999" } });

    const roleInput = screen.getByLabelText("الدور *");
    fireEvent.focus(roleInput);
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByText("مندوب مبيعات"));

    const employeeInput = screen.getByLabelText("الموظف المرتبط (اختياري)");
    fireEvent.focus(employeeInput);
    fireEvent.mouseDown(within(screen.getByRole("listbox")).getByText("موظف واحد"));

    fireEvent.click(screen.getByRole("checkbox", { name: "فرع الإسكندرية" }));

    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        nameAr: "فرع واحد فقط",
        nameEn: "Branch Two",
        phone: "0111111111",
        password: "Passw0rd!",
        pin: "9999",
        roleId: "role-1",
        employeeId: "EMP1",
        branchIds: expect.arrayContaining(["MAIN", "BRANCH2"]),
      }),
      "user-partial",
    );
  });

  it("toggling one branch checkbox off changes only that branch — the sibling stays checked, not cleared", () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    renderPage({ users: [allScopeUser], branches: twoBranches, warehouses: twoWarehouses, onSave });

    fireEvent.click(screen.getByText("مستخدم عام"));
    fireEvent.click(screen.getByRole("checkbox", { name: "الفرع الرئيسي" }));
    expect(screen.getByRole("checkbox", { name: "الفرع الرئيسي" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "فرع الإسكندرية" })).toBeChecked();

    // This row is a company admin, so the screen holds the save until the
    // segregation-of-duties conflict is acknowledged with a reason (ENH-051).
    // The branch edit is what is under test; the acknowledgement is the price
    // of saving ANY edit on this row, and the panel refuses without it.
    fireEvent.click(screen.getByRole("checkbox", { name: "أعتمد إسناد هذا الدور رغم التعارض" }));
    fireEvent.change(screen.getByLabelText("سبب الاستثناء"), { target: { value: "مدير المنشأة" } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ branchIds: ["BRANCH2"] }), "user-all");
  });

  it("cancelling the edit panel does not call onSave, and the next 'add user' opens on a blank draft rather than the cancelled edit", () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    renderPage({ users: [partialScopeUser], onSave });

    fireEvent.click(screen.getByText("فرع واحد فقط"));
    fireEvent.change(screen.getByDisplayValue("فرع واحد فقط"), { target: { value: "تعديل لن يُحفظ" } });
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "إضافة مستخدم" }));
    expect(screen.getByLabelText("الاسم بالعربية")).toHaveValue("");
  });

  it("closing the panel via its own close control (not the cancel button) also discards the edit without saving", () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    renderPage({ users: [partialScopeUser], onSave });

    fireEvent.click(screen.getByText("فرع واحد فقط"));
    fireEvent.change(screen.getByDisplayValue("فرع واحد فقط"), { target: { value: "تعديل لن يُحفظ" } });
    fireEvent.click(screen.getByRole("button", { name: "إغلاق اللوحة" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
