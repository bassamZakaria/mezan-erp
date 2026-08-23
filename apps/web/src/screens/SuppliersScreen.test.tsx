// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { SupplierDTO } from "@mezan/contracts";
import { SuppliersScreen } from "./SuppliersScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function supplier(overrides: Partial<SupplierDTO> = {}): SupplierDTO {
  return {
    id: "sup-1",
    code: "S000001",
    nameAr: "جاري",
    nameEn: "Gary Supply Co.",
    phone: "01011112001",
    email: "sales@gary.example",
    contactPerson: "كريم عادل",
    taxNumber: "300777888900001",
    category: "مواد خام",
    notes: null,
    paymentTermsDays: 30,
    currency: "EGP",
    openingBalance: "3200.00",
    active: true,
    addressCity: "القاهرة",
    addressDistrict: "مدينة نصر",
    addressStreet: "شارع مكرم عبيد",
    ...overrides,
  };
}

const inactiveSupplier = supplier({
  id: "sup-2",
  code: "S000002",
  nameAr: "مورد قطع الغيار الشرقي",
  nameEn: null,
  active: false,
});

function renderScreen(suppliers: SupplierDTO[] = [supplier(), inactiveSupplier]) {
  let current = [...suppliers];
  const transport = stubTransport({
    "GET /suppliers": () => ({ body: current }),
    "POST /suppliers": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: SupplierDTO = { ...supplier(), ...body, id: body.id, code: body.code };
      current = [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /suppliers/sup-1": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}");
      const updated: SupplierDTO = { ...current[0]!, ...patch };
      current = [updated, ...current.slice(1)];
      return { body: updated };
    },
    // The statement tab (كشف حساب المورد) builds a real AP ledger from these.
    "GET /purchases/invoices": () => ({ body: [] }),
    "GET /vouchers": () => ({ body: [] }),
    "GET /open-invoices": () => ({ body: [] }),
    "GET /reports/aging/suppliers": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
  });
  return renderWithProviders(<SuppliersScreen />, { transport, initialSession: testAdminSession });
}

describe("SuppliersScreen", () => {
  it("lists suppliers from the real backend", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الموردون" })).toBeInTheDocument();
    expect(await screen.findByText("جاري")).toBeInTheDocument();
    expect(screen.getByText("S000001")).toBeInTheDocument();
  });

  it("shows an empty state when there are no suppliers yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا يوجد موردون مطابقون")).toBeInTheDocument();
  });

  it("opens the supplier detail on row click, with an overview tab and a real statement tab", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("جاري"));
    expect(screen.getByRole("heading", { name: /جاري/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "نظرة عامة" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "كشف حساب المورد" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "كشف حساب المورد" }));
    // كشف حساب المورد is a real AP movement ledger now, not a "قريباً" stub — the opening-balance
    // label appears both as a MiniStat and as the ledger's first row.
    expect((await screen.findAllByText("رصيد افتتاحي")).length).toBeGreaterThan(0);
  });

  it("returns to the list from the detail view", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("button", { name: "رجوع لقائمة الموردين" }));
    expect(screen.getByRole("heading", { name: "الموردون" })).toBeInTheDocument();
  });

  it("filters by status chip", async () => {
    renderScreen();
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("tab", { name: /غير نشط/ }));
    expect(screen.queryByText("جاري")).not.toBeInTheDocument();
    expect(screen.getByText("مورد قطع الغيار الشرقي")).toBeInTheDocument();
  });

  it("adds a new supplier through the side panel", async () => {
    renderScreen();
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة مورد" });
    fireEvent.change(within(dialog).getByLabelText("اسم المورد *"), { target: { value: "مورد تجريبي" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مورد" }));

    expect(await screen.findByText("مورد تجريبي")).toBeInTheDocument();
  });

  it("shows an Arabic validation error instead of adding an invalid supplier", async () => {
    renderScreen();
    await screen.findByText("جاري");
    fireEvent.click(screen.getByRole("button", { name: "إضافة مورد" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة مورد" });
    // Leave the required Arabic name empty and try to save.
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة مورد" }));
    expect(within(dialog).getByText("الاسم بالعربية مطلوب")).toBeInTheDocument();
  });

  it("edits an existing supplier from the detail view without clobbering its opening balance", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل مورد" });
    fireEvent.change(within(dialog).getByLabelText("الهاتف"), { target: { value: "01000000000" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(screen.getByText(/3,200|3200/)).toBeInTheDocument());
  });

  it("lets an editing supplier be toggled inactive via the active/inactive switch", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("جاري"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل مورد" });
    expect(within(dialog).getByRole("switch", { name: "نشط" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(dialog).getByRole("switch", { name: "نشط" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(screen.getByText("غير نشط")).toBeInTheDocument());
  });
});
