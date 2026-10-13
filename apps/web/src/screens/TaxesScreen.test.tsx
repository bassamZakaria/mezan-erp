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

/** `TextField` renders a plain `<label>` with no `for`/`aria-labelledby`, so
 * `getByLabelText` cannot find its `<input>` — locate it by DOM adjacency
 * instead, matching the `Field` primitive's label-then-control layout. */
function textboxByLabel(container: HTMLElement, label: string): HTMLInputElement {
  const labelNode = within(container).getByText(label);
  const input = labelNode.parentElement?.querySelector("input, textarea");
  if (!input) throw new Error(`no text input associated with label "${label}"`);
  return input as HTMLInputElement;
}

function openRowMenu(row: HTMLElement, itemLabel: string) {
  fireEvent.click(within(row).getByRole("button", { name: /^إجراءات/ }));
  fireEvent.click(within(row).getByRole("menuitem", { name: itemLabel }));
}

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
    "PATCH /tax-rates/*": (init, path) => {
      const id = path.split("/").pop()!;
      const patch = JSON.parse((init?.body as string) ?? "{}");
      const target = current.find((t) => t.id === id)!;
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
    fireEvent.change(textboxByLabel(dialog, "اسم الضريبة *"), { target: { value: "ضريبة تجريبية" } });
    fireEvent.change(textboxByLabel(dialog, "رمز الضريبة *"), { target: { value: "TEST5" } });
    fireEvent.change(textboxByLabel(dialog, "نسبة الضريبة (%) *"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(await screen.findByText("ضريبة تجريبية")).toBeInTheDocument();
  });

  it("rejects a duplicate tax code with an inline error", async () => {
    renderScreen();
    await screen.findByText("ضريبة القيمة المضافة 14%");
    fireEvent.click(screen.getByRole("button", { name: "إضافة ضريبة" }));
    const dialog = screen.getByRole("dialog", { name: "إضافة ضريبة" });
    fireEvent.change(textboxByLabel(dialog, "اسم الضريبة *"), { target: { value: "نسخة" } });
    fireEvent.change(textboxByLabel(dialog, "رمز الضريبة *"), { target: { value: "VAT14" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إضافة" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("مستخدم بالفعل");
  });

  it("edits an existing tax rate and flips off the previous default when a new one is marked default", async () => {
    renderScreen();
    const row = (await screen.findByText("ضريبة خصم وإضافة 1%")).closest("tr");
    expect(row).not.toBeNull();
    openRowMenu(row as HTMLElement, "تعديل");

    const dialog = screen.getByRole("dialog", { name: "تعديل ضريبة" });
    fireEvent.click(within(dialog).getByRole("switch", { name: "ضريبة افتراضية" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    // Only one "الافتراضي" badge should remain, now on the edited row.
    await screen.findByText("ضريبة خصم وإضافة 1%");
    expect(await screen.findAllByText("الافتراضي")).toHaveLength(1);
  });

  it("deactivates an active tax rate from the row menu", async () => {
    renderScreen();
    const row = (await screen.findByText("ضريبة القيمة المضافة 14%")).closest("tr");
    expect(row).not.toBeNull();
    openRowMenu(row as HTMLElement, "تعطيل النسبة");
    const confirmDialog = await screen.findByRole("dialog", { name: "تأكيد: تعطيل النسبة" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "تعطيل النسبة" }));

    expect(await within(row as HTMLElement).findByText("غير نشط")).toBeInTheDocument();
  });
});

describe("TaxesScreen — the system «غير خاضع» rate is locked", () => {
  const notSubject: TaxRateDTO = {
    id: "SYS-NOT-SUBJECT",
    code: "SYS-NOT-SUBJECT",
    name: "غير خاضع",
    rate: 0,
    calculationType: "exclusive",
    isDefault: false,
    outputTaxAccountId: null,
    inputTaxAccountId: null,
    etaSubType: "V004",
    status: "active",
    isSystem: true,
  };

  it("offers neither edit nor deactivate on it, and says why — while the tenant's own rate keeps both", async () => {
    renderScreen([taxRate(), notSubject]);
    const systemRow = (await screen.findByText("غير خاضع")).closest("tr") as HTMLElement;
    fireEvent.click(within(systemRow).getByRole("button", { name: /^إجراءات/ }));
    expect(within(systemRow).queryByRole("menuitem", { name: "تعديل" })).toBeNull();
    expect(within(systemRow).queryByRole("menuitem", { name: "تعطيل النسبة" })).toBeNull();
    expect(within(systemRow).getByRole("menuitem", { name: "معرّفة من النظام — لا تُعدَّل" })).toBeDisabled();

    const ownRow = screen.getByText("ضريبة القيمة المضافة 14%").closest("tr") as HTMLElement;
    fireEvent.click(within(ownRow).getByRole("button", { name: /^إجراءات/ }));
    expect(within(ownRow).getByRole("menuitem", { name: "تعديل" })).toBeEnabled();
  });
});

/** guards §4.5 #13 — the error card shows the SERVER's reason, not the screen's fixed sentence. */
describe("TaxesScreen — a 502 body reaches the error card", () => {
  it("renders the server's own Arabic reason", async () => {
    renderWithProviders(
      <TaxesScreen />,
      {
        transport: stubTransport({
          "GET /tax-rates": () => ({ status: 502, body: { message: "تعذّر الوصول إلى الجهاز الرئيسي. الجهاز مغلق أو غير متصل بالشبكة." } }),
        }),
        initialSession: testAdminSession,
      },
    );

    expect(await screen.findByText("تعذّر الوصول إلى الجهاز الرئيسي. الجهاز مغلق أو غير متصل بالشبكة.")).toBeInTheDocument();
  });
});
