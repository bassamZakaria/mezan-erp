// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { AccountDTO, PayrollComponentDTO } from "@mezan/contracts";
import { PayrollComponentsScreen } from "./PayrollComponentsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

// jsdom has no layout engine and does not implement scrollIntoView; the
// dropdown menu (Select) calls it when the active option changes.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function fieldInput(container: HTMLElement, labelText: string): HTMLElement {
  const label = within(container).getByText(labelText);
  const input = label.parentElement?.querySelector("input");
  if (!input) throw new Error(`no input found next to label "${labelText}"`);
  return input;
}

function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

const accounts: AccountDTO[] = [
  { id: "acc-5100", code: "5100", nameAr: "الرواتب والأجور", nameEn: "Salaries Expense", type: "expense", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "acc-2300", code: "2300", nameAr: "التأمينات الاجتماعية المستحقة", nameEn: "Social Insurance Payable", type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
];

function component(overrides: Partial<PayrollComponentDTO> = {}): PayrollComponentDTO {
  return {
    id: "comp-1",
    code: "BASIC",
    nameAr: "الراتب الأساسي",
    nameEn: "Basic Salary",
    kind: "earning",
    glAccountId: "acc-5100",
    active: true,
    createdAt: "2026-08-11T00:00:00.000Z",
    updatedAt: "2026-08-11T00:00:00.000Z",
    ...overrides,
  };
}

function renderScreen(components: PayrollComponentDTO[] = [component()]) {
  let current = [...components];
  let lastMethod = "";
  let lastBody: unknown = null;
  const transport = stubTransport({
    "GET /accounts": () => ({ body: accounts }),
    "GET /hr/payroll/components": () => ({ body: current }),
    "POST /hr/payroll/components": (init) => {
      lastMethod = "POST";
      lastBody = JSON.parse((init?.body as string) ?? "{}");
      const body = lastBody as Partial<PayrollComponentDTO>;
      const created = component({ id: "comp-new", nameEn: null, glAccountId: null, ...body });
      current = [...current, created];
      return { body: created };
    },
    "PUT /hr/payroll/components/*": (init, path) => {
      lastMethod = "PUT";
      lastBody = JSON.parse((init?.body as string) ?? "{}");
      const id = path.split("/").pop()!;
      const body = lastBody as Partial<PayrollComponentDTO>;
      current = current.map((c) => (c.id === id ? { ...c, ...body } : c));
      return { body: current.find((c) => c.id === id)! };
    },
  });
  const result = renderWithProviders(<PayrollComponentsScreen />, { transport, initialSession: testAdminSession });
  return { ...result, getBody: () => lastBody, getMethod: () => lastMethod };
}

describe("PayrollComponentsScreen", () => {
  it("lists components, resolving the GL account to its real code and name", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "مكوّنات الرواتب" })).toBeInTheDocument();
    expect(await screen.findByText("الراتب الأساسي")).toBeInTheDocument();
    expect(screen.getByText("5100 — الرواتب والأجور")).toBeInTheDocument();
  });

  it("a component with no GL account shows the run-default label, not a raw null", async () => {
    renderScreen([component({ glAccountId: null })]);
    await screen.findByText("الراتب الأساسي");
    expect(screen.getByText("الحساب الافتراضي للدورة")).toBeInTheDocument();
  });

  it("shows the empty state honestly when there are no components", async () => {
    renderScreen([]);
    expect(await screen.findByText(/لا توجد مكوّنات بعد/)).toBeInTheDocument();
  });

  it("shows an Arabic error banner with a working retry on load failure", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /accounts": () => ({ body: accounts }),
      "GET /hr/payroll/components": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "SERVER_ERROR" } } : { body: [component()] };
      },
    });
    renderWithProviders(<PayrollComponentsScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل مكوّنات الرواتب.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByText("الراتب الأساسي");
    expect(screen.queryByText("تعذّر تحميل مكوّنات الرواتب.")).not.toBeInTheDocument();
  });

  it("the kind status-chip filter narrows the rows", async () => {
    renderScreen([component(), component({ id: "comp-2", code: "TAX", nameAr: "ضريبة الدخل", kind: "deduction", glAccountId: null })]);
    await screen.findByText("الراتب الأساسي");
    fireEvent.click(screen.getByRole("tab", { name: /^استقطاع/ }));
    // `useUrlParam`'s patch is applied via `queueMicrotask` (apps/web/src/lib/url-state.ts),
    // so the filtered re-render lands a tick after the click — `waitFor` yields to it.
    await waitFor(() => expect(screen.queryByText("الراتب الأساسي")).not.toBeInTheDocument());
    expect(screen.getByText("ضريبة الدخل")).toBeInTheDocument();
  });

  it("the search box narrows by code or name", async () => {
    renderScreen([component(), component({ id: "comp-2", code: "TAX", nameAr: "ضريبة الدخل" })]);
    await screen.findByText("الراتب الأساسي");
    fireEvent.change(screen.getByPlaceholderText("ابحث بالكود أو الاسم"), { target: { value: "TAX" } });
    await waitFor(() => expect(screen.queryByText("الراتب الأساسي")).not.toBeInTheDocument());
    expect(screen.getByText("ضريبة الدخل")).toBeInTheDocument();
  });

  it("creates a component with the real picked GL account id (الحساب), nameEn null when left blank", async () => {
    const { getBody, getMethod } = renderScreen([]);
    await screen.findByText(/لا توجد مكوّنات بعد/);
    fireEvent.click(screen.getAllByRole("button", { name: "إضافة مكوّن" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(fieldInput(dialog, "الكود"), { target: { value: "OT" } });
    fireEvent.change(fieldInput(dialog, "الاسم بالعربية"), { target: { value: "بدل إضافي" } });
    pickFromCombobox(dialog, "الحساب المحاسبي", "5100");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(getMethod()).toBe("POST"));
    const body = getBody() as Record<string, unknown>;
    expect(body.code).toBe("OT");
    expect(body.nameAr).toBe("بدل إضافي");
    expect(body.glAccountId).toBe("acc-5100");
    expect(body.nameEn).toBeNull();
    expect(body.kind).toBe("earning");
  });

  it("blocks submit with an Arabic message when the code or Arabic name is missing", async () => {
    renderScreen([]);
    await screen.findByText(/لا توجد مكوّنات بعد/);
    fireEvent.click(screen.getAllByRole("button", { name: "إضافة مكوّن" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(await within(dialog).findByText("يلزم كود واسم بالعربية.")).toBeInTheDocument();
  });

  it("edits an existing component via PUT, code and kind stay locked (disabled)", async () => {
    const { getBody, getMethod } = renderScreen([component({ id: "comp-2" })]);
    fireEvent.click(await screen.findByText("الراتب الأساسي"));
    const dialog = screen.getByRole("dialog");
    expect(fieldInput(dialog, "الكود")).toBeDisabled();
    fireEvent.change(fieldInput(dialog, "الاسم بالعربية"), { target: { value: "الراتب الأساسي المعدّل" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(getMethod()).toBe("PUT"));
    expect((getBody() as Record<string, unknown>).nameAr).toBe("الراتب الأساسي المعدّل");
  });

  it("a server refusal on create renders the server's Arabic message, not raw JSON", async () => {
    const transport = stubTransport({
      "GET /accounts": () => ({ body: accounts }),
      "GET /hr/payroll/components": () => ({ body: [] }),
      "POST /hr/payroll/components": () => ({ status: 400, body: { message: "الكود مستخدم بالفعل" } }),
    });
    renderWithProviders(<PayrollComponentsScreen />, { transport, initialSession: testAdminSession });
    await screen.findByText(/لا توجد مكوّنات بعد/);
    fireEvent.click(screen.getAllByRole("button", { name: "إضافة مكوّن" })[0]!);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(fieldInput(dialog, "الكود"), { target: { value: "BASIC" } });
    fireEvent.change(fieldInput(dialog, "الاسم بالعربية"), { target: { value: "الراتب الأساسي" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
    expect(await within(dialog).findByText("الكود مستخدم بالفعل")).toBeInTheDocument();
  });

  it("shows the active/inactive status pill, not a raw boolean", async () => {
    renderScreen([component({ active: false })]);
    expect(await screen.findByText("موقوف")).toBeInTheDocument();
  });
});
