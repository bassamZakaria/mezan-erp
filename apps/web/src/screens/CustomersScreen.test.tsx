// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { CustomerDTO } from "@mezan/contracts";
import { CustomersScreen } from "./CustomersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/**
 * `TextField` (settings/form-controls.tsx) renders a `<label>` that is never
 * associated with its input via `for`/`id`, so `getByLabelText` can't find
 * these fields. Fall back to the DOM structure the shared `Field` wrapper
 * always uses: a `<label>` immediately followed by its control in the same
 * wrapper `<div>`.
 */
function textFieldInput(container: HTMLElement, labelText: string): HTMLInputElement {
  const label = within(container).getByText(labelText, { selector: "label" });
  const input = label.parentElement?.querySelector<HTMLInputElement>("input, textarea");
  if (!input) throw new Error(`No input control found next to label "${labelText}"`);
  return input;
}

function customer(overrides: Partial<CustomerDTO> = {}): CustomerDTO {
  return {
    id: "cust-1",
    code: "C000001",
    nameAr: "شركة الأمل للتجارة",
    nameEn: "Al Amal Trading Co.",
    phone: "01012345001",
    email: "accounts@alamal.example",
    contactPerson: "محمود فتحي",
    taxNumber: "300111222300003",
    category: "تجزئة",
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "450.00",
    active: true,
    priceListId: null,
    creditLimit: "15000.00",
    taxExempt: false,
    etaBuyerType: "business",
    commercialRegistrationNumber: null,
    address: null,
    logoAttachmentId: null,
    nationalId: null,
    ...overrides,
  };
}

const inactiveCustomer = customer({
  id: "cust-2",
  code: "C000002",
  nameAr: "مصنع الوادي الأخضر",
  nameEn: "Green Valley Factory",
  active: false,
});

function renderScreen(customers: CustomerDTO[] = [customer(), inactiveCustomer]) {
  let current = [...customers];
  const transport = stubTransport({
    "GET /customers": (_init, path) => {
      const status = new URL(path, "http://test").searchParams.get("status");
      const rows = status === "active" ? current.filter((c) => c.active) : status === "inactive" ? current.filter((c) => !c.active) : current;
      return { body: rows };
    },
    // The status chips (ListViews) hide any chip whose count is 0, so the
    // real counts endpoint has to be stubbed too, or the "active"/"inactive"
    // tabs never render for the test to click.
    "GET /customers/counts": () => {
      const active = current.filter((c) => c.active).length;
      return { body: { all: current.length, active, inactive: current.length - active } };
    },
    "GET /customers/stats": () => ({
      body: {
        count: current.length,
        active: current.filter((c) => c.active).length,
        creditLimits: "0",
        toCollect: "0",
      },
    }),
    "POST /customers": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: CustomerDTO = { ...customer(), ...body, id: body.id, code: body.code };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /customers/cust-1": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}");
      const updated: CustomerDTO = { ...current[0]!, ...patch };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
    // The statement tab (كشف حساب) builds a real AR ledger from these.
    "GET /sales-invoices": () => ({ body: [] }),
    "GET /sales-returns": () => ({ body: [] }),
    "GET /vouchers": () => ({ body: [] }),
    "GET /reports/aging/customers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
  });
  return renderWithProviders(<CustomersScreen />, { transport, initialSession: testAdminSession });
}

describe("CustomersScreen", () => {
  it("lists customers from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "العملاء" })).toBeInTheDocument();
    expect(await screen.findByText("شركة الأمل للتجارة")).toBeInTheDocument();
    expect(screen.getByText("C000001")).toBeInTheDocument();
  });

  it("shows an empty state when there are no customers yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا يوجد عملاء مطابقون")).toBeInTheDocument();
  });

  it("opens the customer detail on row click, with an overview tab and a real statement tab", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    expect(screen.getByRole("heading", { name: /شركة الأمل للتجارة/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "كشف حساب" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب" }));
    // كشف حساب is a real AR movement ledger now, not a "قريباً" stub — the opening-balance
    // label appears both as a MiniStat and as the ledger's first row.
    expect((await screen.findAllByText("رصيد افتتاحي")).length).toBeGreaterThan(0);
  });

  it("returns to the list from the detail view", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة العملاء" }));
    expect(screen.getByRole("heading", { name: "العملاء" })).toBeInTheDocument();
  });

  it("filters by status chip", async () => {
    renderScreen();
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("tab", { name: /غير نشط/ }));
    // `useUrlParam`'s write is buffered onto a microtask (url-state.ts), and the
    // list itself is server-filtered by status, so the rows only settle once
    // both the URL update and the refetch it triggers have gone through.
    await waitFor(() => {
      expect(screen.queryByText("شركة الأمل للتجارة")).not.toBeInTheDocument();
      expect(screen.getByText("مصنع الوادي الأخضر")).toBeInTheDocument();
    });
  });

  it("adds a new customer through the side panel", async () => {
    renderScreen();
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    fireEvent.change(textFieldInput(dialog, "اسم العميل *"), { target: { value: "عميل تجريبي" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));

    expect(await screen.findByText("عميل تجريبي")).toBeInTheDocument();
  });

  it("shows an Arabic validation error instead of adding an invalid customer", async () => {
    renderScreen();
    await screen.findByText("شركة الأمل للتجارة");
    fireEvent.click(screen.getByRole("button", { name: "إضافة عميل" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة عميل" });
    // Leave the required Arabic name empty and try to save.
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة عميل" }));
    expect(within(dialog).getByText("الاسم بالعربية مطلوب")).toBeInTheDocument();
  });

  it("edits an existing customer from the detail view without clobbering its credit limit", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("شركة الأمل للتجارة"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل عميل" });
    fireEvent.change(textFieldInput(dialog, "الهاتف"), { target: { value: "01000000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(screen.getByText(/15,000|15000/)).toBeInTheDocument());
  });

  it("shows an error banner with a retry action when customers fail to load", async () => {
    const transport = stubTransport({
      "GET /customers": () => ({ status: 500, body: { error: "INTERNAL" } }),
      "GET /customers/counts": () => ({ body: {} }),
      "GET /customers/stats": () => ({ body: {} }),
      "GET /sales-invoices": () => ({ body: [] }),
      "GET /sales-returns": () => ({ body: [] }),
      "GET /vouchers": () => ({ body: [] }),
      "GET /reports/aging/customers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    });
    renderWithProviders(<CustomersScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل العملاء.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });
});
