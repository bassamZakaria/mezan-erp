// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import type { TaxRateDTO } from "@mezan/contracts";
import { TaxesScreen } from "./TaxesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function taxRate(overrides: Partial<TaxRateDTO> = {}): TaxRateDTO {
  return {
    id: "tax-vat14",
    code: "VAT14",
    name: "ضريبة القيمة المضافة 14%",
    rate: 14,
    calculationType: "exclusive",
    isDefault: true,
    outputTaxAccountId: "2200",
    inputTaxAccountId: "1400",
    etaSubType: "V009",
    status: "active",
    ...overrides,
  };
}

const wht1 = taxRate({
  id: "tax-wht1",
  code: "WHT1",
  name: "ضريبة خصم وإضافة 1%",
  rate: 1,
  isDefault: false,
  outputTaxAccountId: null,
  inputTaxAccountId: null,
  etaSubType: "auto",
  status: "inactive",
});

function renderScreen(taxes: TaxRateDTO[] = [taxRate(), wht1]) {
  let current = [...taxes];
  const transport = stubTransport({
    "GET /tax-rates": () => ({ body: current }),
    "POST /tax-rates": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created: TaxRateDTO = {
        id: body.id,
        code: body.code,
        name: body.name,
        rate: body.rate,
        calculationType: body.calculationType ?? "exclusive",
        isDefault: body.isDefault ?? false,
        outputTaxAccountId: body.outputTaxAccountId ?? null,
        inputTaxAccountId: body.inputTaxAccountId ?? null,
        etaSubType: body.etaSubType ?? "auto",
        status: "active",
      };
      if (current.some((t) => t.code === created.code)) {
        return { status: 409, body: { error: "DUPLICATE_TAX_CODE", message: `رمز الضريبة "${created.code}" مستخدم بالفعل.` } };
      }
      current = created.isDefault ? [...current.map((t) => ({ ...t, isDefault: false })), created] : [...current, created];
      return { status: 201, body: created };
    },
    "PATCH /tax-rates/tax-wht1": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}");
      const target = current.find((t) => t.id === "tax-wht1")!;
      const updated: TaxRateDTO = { ...target, ...patch };
      current = patch.isDefault
        ? current.map((t) => (t.id === updated.id ? updated : { ...t, isDefault: false }))
        : current.map((t) => (t.id === updated.id ? updated : t));
      return { body: updated };
    },
  });
  return renderWithProviders(<TaxesScreen />, { transport, initialSession: testAdminSession });
}

describe("TaxesScreen", () => {
  it("lists tax rates from the real backend with the default badge", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "الضرائب" })).toBeInTheDocument();
    expect(await screen.findByText("ضريبة القيمة المضافة 14%")).toBeInTheDocument();
    expect(screen.getByText("الافتراضي")).toBeInTheDocument();
    expect(screen.getByText("14.00%")).toBeInTheDocument();
  });

  it("shows an empty state when there are no tax rates yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد ضرائب مطابقة")).toBeInTheDocument();
  });

  it("adds a new tax rate through the side panel", async () => {
    renderScreen();
    await screen.findByText("ضريبة القيمة المضافة 14%");
    fireEvent.click(screen.getByRole("button", { name: "إضافة ضريبة" }));

    const dialog = screen.getByRole("dialog", { name: "إضافة ضريبة" });
    fireEvent.change(within(dialog).getByLabelText("اسم الضريبة *"), { target: { value: "ضريبة تجريبية" } });
    fireEvent.change(within(dialog).getByLabelText("رمز الضريبة *"), { target: { value: "TEST5" } });
    fireEvent.change(within(dialog).getByLabelText("نسبة الضريبة (%) *"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("ضريبة تجريبية")).toBeInTheDocument();
  });

  it("rejects a duplicate tax code with an inline error", async () => {
    renderScreen();
    await screen.findByText("ضريبة القيمة المضافة 14%");
    fireEvent.click(screen.getByRole("button", { name: "إضافة ضريبة" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة ضريبة" });
    fireEvent.change(within(dialog).getByLabelText("اسم الضريبة *"), { target: { value: "نسخة" } });
    fireEvent.change(within(dialog).getByLabelText("رمز الضريبة *"), { target: { value: "VAT14" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });

  it("edits an existing tax rate and flips off the previous default when a new one is marked default", async () => {
    renderScreen();
    const row = (await screen.findByText("ضريبة خصم وإضافة 1%")).closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "تعديل" }));

    const dialog = screen.getByRole("dialog", { name: "تعديل ضريبة" });
    fireEvent.click(within(dialog).getByRole("switch", { name: "ضريبة افتراضية" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    // Only one "الافتراضي" badge should remain, now on the edited row.
    await screen.findByText("ضريبة خصم وإضافة 1%");
    expect(await screen.findAllByText("الافتراضي")).toHaveLength(1);
  });
});
