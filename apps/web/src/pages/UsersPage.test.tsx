// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearOwnerHandOver, pendingOwnerHandOver } from "../data/session";
import { render as rtlRender, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { RoleDTO, UserDTO } from "@mezan/contracts";
import { UsersPage } from "./UsersPage";
import { AppI18nProvider } from "../i18n";

afterEach(() => clearOwnerHandOver());

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
  mustChangePassword: false,
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

  it("saves every edited field — nameEn, phone, password, role, employee and the scope checkboxes — as the exact draft, keyed to the row that was opened", () => {
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
    fireEvent.change(screen.getByLabelText(/^إعادة تعيين كلمة المرور/), { target: { value: "Passw0rd!" } });

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
        roleId: "role-1",
        employeeId: "EMP1",
        branchIds: expect.arrayContaining(["MAIN", "BRANCH2"]),
      }),
      "user-partial",
    );
  });

  it("asks the signed-in user for their current password when they edit their own row, and sends it with the save", () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    const self = { ...inactiveUser, status: "active" as const };
    renderPage({ users: [self], onSave, currentUserId: self.id });

    fireEvent.click(screen.getByText(self.nameAr));
    fireEvent.change(screen.getByLabelText(/^إعادة تعيين كلمة المرور/), { target: { value: "New-Pass-2026" } });
    fireEvent.change(screen.getByLabelText(/^كلمة المرور الحالية/), { target: { value: "Cyag@2026" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ password: "New-Pass-2026", currentPassword: "Cyag@2026" }), self.id);
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("pin");
  });

  it("does not ask for a current password on somebody else's row, and says a reset becomes a temporary password", () => {
    const self = { ...inactiveUser, status: "active" as const };
    renderPage({ users: [self], currentUserId: "someone-else" });

    fireEvent.click(screen.getByText(self.nameAr));
    expect(screen.getByText("تصبح كلمة مرور مؤقتة يجب على المستخدم تغييرها عند أول دخول.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^كلمة المرور الحالية/)).toBeNull();
  });

  it("offers an optional password on create, and shows a generated temporary password once with a copy button", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, value: { ...user, id: "user-new", nameAr: "مستخدم جديد", mustChangePassword: true, temporaryPassword: "Tmp-9f3K-q2Lx" } });
    renderPage({ onSave });

    fireEvent.click(screen.getByRole("button", { name: "إضافة مستخدم" }));
    expect(screen.getByText("اتركها فارغة لتوليد كلمة مرور مؤقتة")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("الاسم بالعربية"), { target: { value: "مستخدم جديد" } });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني *", { exact: false }), { target: { value: "new@cyag.test" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));

    expect(await screen.findByText("Tmp-9f3K-q2Lx")).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ password: "" }), null);
    expect(screen.getByText("تظهر مرة واحدة فقط. سلّمها للمستخدم الآن؛ يجب تغييرها عند أول دخول.")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "كلمة المرور المؤقتة لـ مستخدم جديد" });
    expect(within(dialog).getByRole("button", { name: "تم، إخفاء كلمة المرور" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "تم، إخفاء كلمة المرور" }));
    expect(screen.queryByText("Tmp-9f3K-q2Lx")).not.toBeInTheDocument();
  });

  it("closes the issued-password dialog on Escape", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, value: { ...user, id: "user-new", nameAr: "مستخدم جديد", temporaryPassword: "Tmp-9f3K-q2Lx" } });
    renderPage({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "إضافة مستخدم" }));
    fireEvent.change(screen.getByLabelText("الاسم بالعربية"), { target: { value: "مستخدم جديد" } });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني *", { exact: false }), { target: { value: "new@cyag.test" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));
    await screen.findByText("Tmp-9f3K-q2Lx");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Tmp-9f3K-q2Lx")).not.toBeInTheDocument();
  });

  it("marks a user who still holds a temporary password", () => {
    renderPage({ users: [{ ...user, mustChangePassword: true }] });
    expect(screen.getByText("يجب تغيير كلمة المرور")).toBeInTheDocument();
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

describe("UsersPage — personal-data erasure (D348)", () => {
  const erasedUser: UserDTO = {
    ...user,
    id: "user-3",
    nameAr: "مستخدم محذوف",
    nameEn: "Deleted user",
    email: "erased-user-3@erased.invalid",
    isCompanyAdmin: false,
    roleId: "role-1",
    status: "inactive",
    erasedAt: "2026-09-23T10:00:00.000Z",
  };

  it("shows no erase control until a caller wires one", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "محو البيانات الشخصية" })).not.toBeInTheDocument();
  });

  it("names the account and what is kept, and refuses to submit until the email is typed back exactly", async () => {
    const onErase = vi.fn().mockResolvedValue({ ok: true, value: { alreadyErased: false } });
    renderPage({ onErase });

    fireEvent.click(screen.getAllByRole("button", { name: "محو البيانات الشخصية" })[0]!);
    expect(await screen.findByText(/الحساب: محمد الشهابي/)).toBeInTheDocument();
    expect(screen.getByText(/القيود المرحّلة/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("اكتب بريد الحساب للتأكيد"), { target: { value: "wrong@cyag.test" } });
    fireEvent.change(screen.getByLabelText(/سبب المحو/), { target: { value: "طلب صاحب البيانات" } });
    fireEvent.click(screen.getByRole("button", { name: "محو البيانات" }));
    expect(await screen.findByText(/اكتب بريد الحساب بالضبط/)).toBeInTheDocument();
    expect(onErase).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("اكتب بريد الحساب للتأكيد"), { target: { value: "mohamed@cyag.test" } });
    fireEvent.click(screen.getByRole("button", { name: "محو البيانات" }));
    await waitFor(() =>
      expect(onErase).toHaveBeenCalledWith("user-1", { confirmEmail: "mohamed@cyag.test", reason: "طلب صاحب البيانات" }),
    );
  });

  const NEW_OWNER_LABEL = "المالك الجديد للمنشأة";

  it("does not offer erasing the company's owner, and says in Arabic that ownership must be handed over first", () => {
    const admin: UserDTO = { ...user, isCompanyAdmin: true, isCompanyOwner: true };
    const peer: UserDTO = { ...user, id: "user-9", nameAr: "هدى المديرة", email: "huda@cyag.test", isCompanyAdmin: true };
    renderPage({ users: [admin, peer], onErase: vi.fn() });

    expect(screen.getAllByRole("button", { name: "محو البيانات الشخصية" })).toHaveLength(1);
    expect(screen.getByText("لا تُمحى بيانات مالك المنشأة قبل نقل الملكية إلى مدير آخر.")).toBeInTheDocument();
  });

  it("asks for no new owner when a company admin who is not the owner is erased", async () => {
    const admin: UserDTO = { ...user, isCompanyAdmin: true, isCompanyOwner: false };
    const peer: UserDTO = { ...user, id: "user-9", nameAr: "هدى المديرة", email: "huda@cyag.test", isCompanyAdmin: true, isCompanyOwner: true };
    renderPage({ users: [admin, peer], onErase: vi.fn() });

    fireEvent.click(screen.getAllByRole("button", { name: "محو البيانات الشخصية" })[0]!);
    await screen.findByLabelText("اكتب بريد الحساب للتأكيد");
    expect(screen.queryByRole("combobox", { name: NEW_OWNER_LABEL })).not.toBeInTheDocument();
  });

  it("asks for no new owner when the account being erased is not a company admin", async () => {
    const clerk: UserDTO = { ...user, isCompanyAdmin: false, roleId: "role-1" };
    const peer: UserDTO = { ...user, id: "user-9", nameAr: "هدى المديرة", email: "huda@cyag.test", isCompanyAdmin: true };
    renderPage({ users: [clerk, peer], onErase: vi.fn() });

    fireEvent.click(screen.getAllByRole("button", { name: "محو البيانات الشخصية" })[0]!);
    await screen.findByLabelText("اكتب بريد الحساب للتأكيد");
    expect(screen.queryByRole("combobox", { name: NEW_OWNER_LABEL })).not.toBeInTheDocument();
  });

  it("surfaces a refusal from the server instead of closing", async () => {
    const onErase = vi.fn().mockResolvedValue({ ok: false, error: "لا يمكن محو بيانات آخر مدير شركة نشط." });
    renderPage({ onErase });

    fireEvent.click(screen.getAllByRole("button", { name: "محو البيانات الشخصية" })[0]!);
    fireEvent.change(screen.getByLabelText("اكتب بريد الحساب للتأكيد"), { target: { value: "mohamed@cyag.test" } });
    fireEvent.change(screen.getByLabelText(/سبب المحو/), { target: { value: "طلب صاحب البيانات" } });
    fireEvent.click(screen.getByRole("button", { name: "محو البيانات" }));

    expect(await screen.findByText("لا يمكن محو بيانات آخر مدير شركة نشط.")).toBeInTheDocument();
  });

  it("renders an erased row as the placeholder and offers no edit, enable or erase on it", () => {
    const onErase = vi.fn();
    renderPage({ users: [erasedUser], onErase, onUnlock: vi.fn() });

    expect(screen.getByText("مستخدم محذوف")).toBeInTheDocument();
    expect(screen.getByText("محيت بياناته")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "محو البيانات الشخصية" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تفعيل" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "فكّ القفل" })).not.toBeInTheDocument();
  });
});

describe("UsersPage — the company's owner", () => {
  const owner: UserDTO = { ...user, isCompanyOwner: true };
  const peer: UserDTO = { ...user, id: "user-9", nameAr: "هدى المديرة", email: "huda@cyag.test", isCompanyAdmin: true };

  it("marks the owner's row", () => {
    renderPage({ users: [owner, peer] });

    expect(screen.getAllByText("مالك المنشأة")).toHaveLength(1);
  });

  it("asks who takes over before the owner's account is disabled, and sends the admin chosen", async () => {
    const onToggleStatus = vi.fn().mockResolvedValue({ ok: true });
    renderPage({ users: [owner, peer], onToggleStatus });

    fireEvent.click(screen.getAllByRole("button", { name: "تعطيل" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "تعطيل حساب مالك المنشأة" });
    expect(onToggleStatus).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "تعطيل الحساب" }));
    expect(await within(dialog).findByText("اختر مدير المنشأة الذي يصبح المالك قبل المتابعة.")).toBeInTheDocument();
    expect(onToggleStatus).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("combobox", { name: "المالك الجديد للمنشأة" }));
    fireEvent.mouseDown((await screen.findAllByRole("option"))[0]!);
    fireEvent.click(within(dialog).getByRole("button", { name: "تعطيل الحساب" }));

    await waitFor(() => expect(onToggleStatus).toHaveBeenCalledWith("user-1", "inactive", "user-9"));
  });

  it.each([
    ["pending", /نقل ملكية المنشأة بانتظار التأكيد: أُرسل رابط التأكيد إلى بريد المالك السابق/],
    ["pending_unmailed", /نقل ملكية المنشأة بانتظار تأكيد دعم المنصة: لم يُرسل رابط تأكيد/],
    ["failed", /تعذّر تسجيل المالك الجديد على المنصة/],
  ])("tells the owner what became of the hand-over after stepping down: %s", async (outcome, notice) => {
    const onToggleStatus = vi.fn().mockResolvedValue({ ok: true, value: { ...owner, status: "inactive", ownerHandOver: outcome } });
    renderPage({ users: [owner, peer], onToggleStatus });

    fireEvent.click(screen.getAllByRole("button", { name: "تعطيل" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "تعطيل حساب مالك المنشأة" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "المالك الجديد للمنشأة" }));
    fireEvent.mouseDown((await screen.findAllByRole("option"))[0]!);
    fireEvent.click(within(dialog).getByRole("button", { name: "تعطيل الحساب" }));

    expect(await screen.findByText(notice)).toBeInTheDocument();
  });

  it("leaves what became of the hand-over for the sign-in screen, because stepping down ends the owner's session", async () => {
    const onToggleStatus = vi.fn().mockResolvedValue({ ok: true, value: { ...owner, status: "inactive", ownerHandOver: "pending" } });
    renderPage({ users: [owner, peer], onToggleStatus });

    fireEvent.click(screen.getAllByRole("button", { name: "تعطيل" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "تعطيل حساب مالك المنشأة" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "المالك الجديد للمنشأة" }));
    fireEvent.mouseDown((await screen.findAllByRole("option"))[0]!);
    fireEvent.click(within(dialog).getByRole("button", { name: "تعطيل الحساب" }));

    await waitFor(() => expect(pendingOwnerHandOver()).toBe("pending"));
  });

  it("says nothing more when the hand-over was verified at once", async () => {
    const onToggleStatus = vi.fn().mockResolvedValue({ ok: true, value: { ...owner, status: "inactive", ownerHandOver: "verified" } });
    renderPage({ users: [owner, peer], onToggleStatus });

    fireEvent.click(screen.getAllByRole("button", { name: "تعطيل" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "تعطيل حساب مالك المنشأة" });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "المالك الجديد للمنشأة" }));
    fireEvent.mouseDown((await screen.findAllByRole("option"))[0]!);
    fireEvent.click(within(dialog).getByRole("button", { name: "تعطيل الحساب" }));

    await waitFor(() => expect(onToggleStatus).toHaveBeenCalled());
    expect(screen.queryByText(/نقل ملكية المنشأة بانتظار/)).not.toBeInTheDocument();
  });

  it("stops saying a confirmation link is waiting once a later hand-over needed none", async () => {
    const onToggleStatus = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: { ...owner, status: "inactive", ownerHandOver: "pending" } })
      .mockResolvedValueOnce({ ok: true, value: { ...owner, status: "inactive", ownerHandOver: "verified" } });
    renderPage({ users: [owner, peer], onToggleStatus });
    const stepDown = async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "تعطيل" })[0]!);
      const dialog = await screen.findByRole("dialog", { name: "تعطيل حساب مالك المنشأة" });
      fireEvent.click(within(dialog).getByRole("combobox", { name: "المالك الجديد للمنشأة" }));
      fireEvent.mouseDown((await screen.findAllByRole("option"))[0]!);
      fireEvent.click(within(dialog).getByRole("button", { name: "تعطيل الحساب" }));
    };

    await stepDown();
    expect(await screen.findByText(/أُرسل رابط التأكيد إلى بريد المالك السابق/)).toBeInTheDocument();
    await stepDown();

    await waitFor(() => expect(onToggleStatus).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/نقل ملكية المنشأة بانتظار/)).not.toBeInTheDocument());
  });

  it("disables any other account without asking for a new owner", () => {
    const onToggleStatus = vi.fn().mockResolvedValue({ ok: true });
    renderPage({ users: [owner, peer], onToggleStatus });

    fireEvent.click(screen.getAllByRole("button", { name: "تعطيل" })[1]!);

    expect(onToggleStatus).toHaveBeenCalledWith("user-9", "inactive");
  });

  it("shows the server's refusal when disabling an account fails", async () => {
    const onToggleStatus = vi.fn().mockResolvedValue({ ok: false, error: "هذا حساب مالك المنشأة." });
    renderPage({ users: [{ ...owner, isCompanyOwner: false }, peer], onToggleStatus });

    fireEvent.click(screen.getAllByRole("button", { name: "تعطيل" })[0]!);

    expect(await screen.findByText("هذا حساب مالك المنشأة.")).toBeInTheDocument();
  });

  it("asks for the new owner in the edit form when the owner removes their own admin access, and sends it with the save", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    renderPage({ users: [owner, peer], onSave });

    fireEvent.click(screen.getByText(owner.nameAr));
    fireEvent.click(await screen.findByRole("checkbox", { name: /مدير المنشأة/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "المالك الجديد للمنشأة" }));
    fireEvent.mouseDown((await screen.findAllByRole("option")).find((option) => option.textContent?.includes("huda@cyag.test"))!);
    fireEvent.click(screen.getByRole("button", { name: "حفظ المستخدم" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ isCompanyAdmin: false, newOwnerUserId: "user-9" });
  });
});
