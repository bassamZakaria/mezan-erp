// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { BranchDTO, EmployeeDTO } from "@mezan/contracts";
import { EmployeesScreen } from "./EmployeesScreen";
import { todayIso } from "../lib/dates";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { RoutedScreen } from "./routed-screen.test-support";

function pickFromCombobox(dialog: HTMLElement, label: string, optionLabel: string) {
  const input = within(dialog).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(dialog).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

/** `TextField`/`NumberField` render a `<label>` with no `htmlFor`/`id`, so it has no accessible name to query by. */
function fieldInput(container: HTMLElement, labelText: string): HTMLElement {
  const label = within(container).getByText(labelText);
  const input = label.parentElement?.querySelector("input");
  if (!input) throw new Error(`no input found next to label "${labelText}"`);
  return input;
}

const sampleBranches: BranchDTO[] = [
  { id: "MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
];

const sampleEmployees: EmployeeDTO[] = [
  {
    id: "emp-1",
    code: "EMP-0001",
    firstName: "Ahmed",
    lastName: "Mahmoud",
    firstNameAr: "أحمد",
    lastNameAr: "محمود",
    email: null,
    phone: null,
    birthDate: null,
    nationalId: null,
    gender: null,
    maritalStatus: null,
    departmentId: null,
    jobTitleId: null,
    managerId: null,
    branchId: "MAIN",
    hireDate: "2026-08-11",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "inherit_department",
    standardWorkHours: null,
    probationEndDate: null,
    priorServiceYears: 0,
    requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false, deviceBadgeId: null, hasPensionEntitlement: null, taxDisabilityExemption: false,
    address: null,
    emergencyContact: null,
    status: "active",
    terminatedAt: null,
    createdAt: "2026-08-11T00:00:00.000Z",
  },
];

function renderScreen(
  employees: EmployeeDTO[] = sampleEmployees,
  opts: {
    onTransition?: (id: string, status: string) => { status?: number; body: unknown } | undefined;
    onTerminate?: (id: string, body: unknown) => { status?: number; body: unknown } | undefined;
    onRehire?: (id: string, hireDate: string) => { status?: number; body: unknown } | undefined;
    /** The plan's modules; omitted, no `/entitlements` answer is stubbed and every part shows. */
    activeModules?: string[];
    /** Every path the screen asks for, in order. */
    seen?: string[];
  } = {},
) {
  let current = [...employees];
  const answer = stubTransport({
    ...(opts.activeModules
      ? { "GET /entitlements": () => ({ body: { plan: "P", activeModules: opts.activeModules, features: {}, seats: 5, expiresAt: null } }) }
      : {}),
    "GET /hr/employees": () => ({ body: current }),
    "GET /hr/departments": () => ({ body: [] }),
    "GET /hr/job-titles": () => ({ body: [] }),
    "GET /hr/contracts": () => ({ body: [] }),
    "GET /branches": () => ({ body: sampleBranches }),
    "GET /hr/employees/*/contracts": () => ({ body: [] }),
    "POST /hr/employees": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: EmployeeDTO = { ...current[0]!, ...body, id: "emp-new", code: "EMP-0002", status: "active", terminatedAt: null };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /hr/employees/*/transition": (init, path) => {
      const id = path.split("/")[3]!;
      const body = JSON.parse((init?.body as string) ?? "{}");
      const overridden = opts.onTransition?.(id, body.status);
      if (overridden) return overridden;
      const index = current.findIndex((e) => e.id === id);
      const updated: EmployeeDTO = { ...current[index]!, status: body.status };
      current = [...current.slice(0, index), updated, ...current.slice(index + 1)];
      return { body: updated };
    },
    "POST /hr/employees/*/terminate": (init, path) => {
      const id = path.split("/")[3]!;
      const overridden = opts.onTerminate?.(id, init?.body ? JSON.parse(String(init.body)) : undefined);
      if (overridden) return overridden;
      const index = current.findIndex((e) => e.id === id);
      const updated: EmployeeDTO = { ...current[index]!, status: "terminated", terminatedAt: "2026-08-25T00:00:00.000Z" };
      current = [...current.slice(0, index), updated, ...current.slice(index + 1)];
      return { body: updated };
    },
    "POST /hr/employees/*/rehire": (init, path) => {
      const id = path.split("/")[3]!;
      const body = JSON.parse((init?.body as string) ?? "{}");
      const overridden = opts.onRehire?.(id, body.hireDate);
      if (overridden) return overridden;
      const index = current.findIndex((e) => e.id === id);
      const updated: EmployeeDTO = { ...current[index]!, status: "active", terminatedAt: null, hireDate: body.hireDate };
      current = [...current.slice(0, index), updated, ...current.slice(index + 1)];
      return { body: updated };
    },
  });
  const transport: typeof answer = (path, init) => {
    opts.seen?.push(path);
    return answer(path, init);
  };
  return renderWithProviders(
    <RoutedScreen>
      <EmployeesScreen />
    </RoutedScreen>,
    { transport, initialSession: testAdminSession },
  );
}

const employee2: EmployeeDTO = {
  ...sampleEmployees[0]!,
  id: "emp-2",
  code: "EMP-0002",
  firstName: "Sara",
  lastName: "Aly",
  firstNameAr: "سارة",
  lastNameAr: "علي",
};

const terminatedEmployee: EmployeeDTO = {
  ...sampleEmployees[0]!,
  id: "emp-3",
  code: "EMP-0003",
  firstName: "Karim",
  lastName: "Adel",
  firstNameAr: "كريم",
  lastNameAr: "عادل",
  status: "terminated",
  terminatedAt: "2026-01-01T00:00:00.000Z",
};

describe("EmployeesScreen", () => {
  it("lists employees from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الموظفون" })).toBeInTheDocument();
    expect(await screen.findByText("أحمد محمود")).toBeInTheDocument();
    expect(screen.getByText("EMP-0001")).toBeInTheDocument();
  });

  it("adds a new employee on its own page, then opens the new employee's page", async () => {
    renderScreen();
    await screen.findByText("أحمد محمود");
    fireEvent.click(screen.getByRole("button", { name: "إضافة موظف" }));

    expect(await screen.findByRole("heading", { name: "موظف جديد" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    const dialog = document.body;
    fireEvent.change(fieldInput(dialog, "الاسم الأول *"), { target: { value: "Sara" } });
    fireEvent.change(fieldInput(dialog, "اسم العائلة *"), { target: { value: "Aly" } });
    pickFromCombobox(dialog, "الفرع *", "الفرع الرئيسي");
    fireEvent.change(fieldInput(dialog, "تاريخ التعيين *"), { target: { value: "2026-08-21" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(await screen.findByRole("heading", { name: "Sara Aly" })).toBeInTheDocument();
  });

  it("opens the employee's page and transitions the employee to on_leave", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("أحمد محمود"));
    expect(await screen.findByRole("heading", { name: "أحمد محمود" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "في إجازة" }));

    expect(await screen.findByRole("button", { name: "نشط" })).toBeInTheDocument();
  });

  it("transitions one employee's row via the row menu, leaving the other employee's row untouched", async () => {
    renderScreen([sampleEmployees[0]!, employee2]);
    await screen.findByText("أحمد محمود");
    await screen.findByText("سارة علي");

    const rowAhmed = screen.getByText("أحمد محمود").closest("tr")!;
    fireEvent.click(within(rowAhmed).getByRole("button", { name: "إجراءات EMP-0001" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "في إجازة" }));

    await waitFor(() => {
      expect(within(screen.getByText("أحمد محمود").closest("tr")!).getByText("في إجازة")).toBeInTheDocument();
    });
    // Sara's row was never touched by Ahmed's transition.
    const rowSara = screen.getByText("سارة علي").closest("tr")!;
    expect(within(rowSara).getByText("نشط")).toBeInTheDocument();
    fireEvent.click(within(rowSara).getByRole("button", { name: "إجراءات EMP-0002" }));
    expect(await screen.findByRole("menuitem", { name: "في إجازة" })).toBeEnabled();
  });

  it("shows the server's refusal inside the termination panel, and the employee stays active", async () => {
    renderScreen([sampleEmployees[0]!], {
      onTerminate: () => ({ status: 422, body: { message: "تاريخ إنهاء الخدمة لا يمكن أن يكون بعد 2026-10-31" } }),
    });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("button", { name: "إنهاء الخدمة" }));
    const panel = await screen.findByRole("dialog");
    fireEvent.click(within(panel).getByRole("button", { name: "تأكيد إنهاء الخدمة" }));

    expect(await within(panel).findByText("تاريخ إنهاء الخدمة لا يمكن أن يكون بعد 2026-10-31")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "في إجازة" })).toBeInTheDocument();
  });

  it("asks for the last day of service, opening on today, and sends the day chosen", async () => {
    const sent: unknown[] = [];
    renderScreen([sampleEmployees[0]!], {
      onTerminate: (_id, body) => {
        sent.push(body);
        return undefined;
      },
    });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("button", { name: "إنهاء الخدمة" }));
    const panel = await screen.findByRole("dialog");
    const field = within(panel).getByLabelText("آخر يوم عمل") as HTMLInputElement;
    expect(field.value).toBe(todayIso());
    expect(sent).toEqual([]);

    fireEvent.change(field, { target: { value: "2026-06-12" } });
    fireEvent.click(within(panel).getByRole("button", { name: "تأكيد إنهاء الخدمة" }));

    await waitFor(() => expect(sent).toEqual([{ effectiveDate: "2026-06-12" }]));
  });

  it("says what was booked when the last day falls before a day payroll already paid", async () => {
    renderScreen([sampleEmployees[0]!], {
      onTerminate: () => ({
        body: { ...sampleEmployees[0]!, status: "terminated", terminatedAt: "2026-06-12", payRecovery: { advanceId: "A", advanceNumber: "ADV-000009", days: 18, amount: "5040.000000", journalEntryId: "JE", paidThrough: "2026-06-30" } },
      }),
    });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("button", { name: "إنهاء الخدمة" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "تأكيد إنهاء الخدمة" }));

    expect(await screen.findByText(/سُجّل أجر 18 يومًا مدفوعة حتى 2026-06-30 سلفة على الموظف برقم ADV-000009/)).toBeInTheDocument();
  });

  it.each([
    { payableReduced: "1250.500000", says: true },
    { payableReduced: "0.000001", says: true },
    { payableReduced: "0.000000", says: false },
  ])("names what came off unpaid net pay only when something did ($payableReduced)", async ({ payableReduced, says }) => {
    renderScreen([sampleEmployees[0]!], {
      onTerminate: () => ({
        body: { ...sampleEmployees[0]!, status: "terminated", terminatedAt: "2026-06-12", payRecovery: { advanceId: null, advanceNumber: null, days: 18, amount: "0.000000", payableReduced, journalEntryId: "JE", paidThrough: "2026-06-30" } },
      }),
    });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    fireEvent.click(screen.getByRole("button", { name: "إنهاء الخدمة" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "تأكيد إنهاء الخدمة" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const said = screen.queryByText(/خُصم أجر 18 يومًا مدفوعة حتى 2026-06-30/);
    if (says) expect(said).toHaveTextContent(`بمبلغ ${payableReduced.slice(0, payableReduced.indexOf(".") + 3)} من صافي الراتب`);
    else expect(said).toBeNull();
  });

  it("blocks rehiring with no date entered — the rehire request is never sent", async () => {
    const rehireRequests: Array<{ id: string; hireDate: string }> = [];
    renderScreen([terminatedEmployee], {
      onRehire: (id, hireDate) => {
        rehireRequests.push({ id, hireDate });
        return undefined;
      },
    });
    fireEvent.click(await screen.findByText("كريم عادل"));
    fireEvent.click(screen.getByRole("button", { name: "إعادة تعيين" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "إعادة تعيين" }));

    expect(await screen.findByText("تاريخ إعادة التعيين مطلوب.")).toBeInTheDocument();
    expect(rehireRequests).toHaveLength(0);
  });

  it("filters the list by search text, hiding the non-matching employee", async () => {
    renderScreen([sampleEmployees[0]!, employee2]);
    await screen.findByText("أحمد محمود");
    fireEvent.change(screen.getByPlaceholderText("بحث بالاسم أو الرقم..."), { target: { value: "سارة" } });

    await waitFor(() => {
      expect(screen.queryByText("أحمد محمود")).not.toBeInTheDocument();
      expect(screen.getByText("سارة علي")).toBeInTheDocument();
    });
  });
});

describe("EmployeesScreen on a plan that holds only the free staff list", () => {
  const PAID_TABS = ["العقود", "الإجازات", "كشوف الرواتب", "السلف", "الحضور"];

  it("shows the employee's page without the tabs of HR parts the plan lacks", async () => {
    renderScreen(sampleEmployees, { activeModules: ["sales"] });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    expect(await screen.findByRole("heading", { name: "أحمد محمود" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
    for (const label of PAID_TABS) expect(tabs.some((tab) => tab.includes(label)), label).toBe(false);
    expect(screen.queryByText("يستحق معاشاً عن مدة الخدمة")).not.toBeInTheDocument();
    expect(screen.queryByText("شارة/كود جهاز البصمة")).not.toBeInTheDocument();
  });

  it("keeps clock, overtime, pension and tax fields off the new-employee form", async () => {
    renderScreen(sampleEmployees, { activeModules: ["sales"] });
    await screen.findByText("أحمد محمود");
    fireEvent.click(screen.getByRole("button", { name: "إضافة موظف" }));
    expect(await screen.findByRole("heading", { name: "موظف جديد" })).toBeInTheDocument();
    for (const label of ["شارة/كود جهاز البصمة", "يستحق معاشاً عن مدة الخدمة", "إعفاء ضريبي لذوي الإعاقة", "احتساب العمل الإضافي", "ساعات العمل القياسية", "طلب صورة شخصية عند تسجيل الحضور"]) {
      expect(screen.queryByText(label), label).not.toBeInTheDocument();
    }
  });

  it("shows every part on a plan with all of HR", async () => {
    renderScreen(sampleEmployees, { activeModules: ["sales", "hr"] });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    expect(await screen.findByRole("heading", { name: "أحمد محمود" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent ?? "");
    for (const label of PAID_TABS) expect(tabs.some((tab) => tab.includes(label)), label).toBe(true);
  });
});

describe("EmployeesScreen asks only for the HR parts the plan holds", () => {
  it("never asks for an employee's contracts or payslips on the free staff list", async () => {
    const seen: string[] = [];
    renderScreen(sampleEmployees, { activeModules: ["sales"], seen });
    fireEvent.click(await screen.findByText("أحمد محمود"));
    expect(await screen.findByRole("heading", { name: "أحمد محمود" })).toBeInTheDocument();
    await waitFor(() => expect(seen).toContain("/entitlements"));
    expect(seen.filter((path) => /\/hr\/(employees\/[^/]+\/contracts|payroll|contracts|attendance|leave|advances)/.test(path))).toEqual([]);
  });
});
