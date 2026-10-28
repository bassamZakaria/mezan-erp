// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { COMPANY_NAME_MAX_LENGTH, type TenantSettingsDTO } from "@mezan/contracts";
import { SettingsGeneral } from "./SettingsGeneral";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/** `TextField`/`NumberField` render a plain `<label>` with no `for`/`aria-labelledby`, so
 * `getByLabelText` cannot find their `<input>` — locate it by DOM adjacency instead,
 * matching the `Field` primitive's label-then-control layout (form-controls.tsx). */
function textboxByLabel(label: string, container: HTMLElement = document.body): HTMLInputElement {
  const labelNode = within(container).getByText(label);
  const input = labelNode.parentElement?.querySelector("input, textarea");
  if (!input) throw new Error(`no text input associated with label "${label}"`);
  return input as HTMLInputElement;
}

/** Counts the actual `<label>` elements naming a field — `getByLabelText` finds none (see above). */
function labelsByText(label: string): HTMLElement[] {
  return screen.getAllByText(label, { selector: "label" });
}

/** `Select` is a custom listbox (packages/ui/src/primitives/Select.tsx), not a native `<select>` —
 * open it and mouseDown the option, the same interaction its own component test uses. */
function selectOption(comboboxLabel: string, optionLabel: string): void {
  fireEvent.click(screen.getByRole("combobox", { name: comboboxLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: optionLabel }));
}

const baseSettings: TenantSettingsDTO = {
  currency: "EGP",
  secondaryCurrencies: ["SAR", "USD", "AED", "EUR", "KWD", "QAR", "JOD"],
  language: "ar",
  timezone: "Africa/Cairo",
  direction: "RTL",
  dateFormat: "DD/MM/YYYY",
  dateNumerals: "western",
  weekendDays: [5, 6],
  fiscalYearStartMonth: 1,
  fxRateMissingPolicy: "STRICT",
  multiCurrencyEnabled: false,
  weekStartDay: 6,
  companyName: "Cyag — شركة سياج للصناعات",
  taxRegistrationNumber: "300123456700003",
  commercialRegistrationNumber: "",
  phone: "0223456789",
  allowedEmailDomains: [],
  email: "info@cyag.example",
  address: "القاهرة الجديدة، القاهرة",
  hrContractExpiryWarningDays: 30,
  payrollDayDivisorBasis: "FIXED_30",
  standardDailyWorkHours: 8,
  taxEnabled: true,
  defaultTaxRate: 14,
  taxCalculation: "EXCLUSIVE",
  depreciationProrate: "DAILY",
  priceListsEnabled: true,
  creditControlEnabled: false,
  creditControlMode: "WARNING",
  maxLineDiscountPercent: 100,
  contractingCbeCreditDiscountRatePercent: null,
  contractingSingleOperatorMode: false,
  periodCloseSingleOperatorMode: false,
  allowCrossWarehouseSales: true,
  showOtherWarehouseStock: true,
  allowBackorder: false,
  allowNegativeStock: false,
  agingWritedownEnabled: false,
  agingWritedownMonths: 6,
  agingWritedownRatePercent: 25,
  autoGenerateBatchNumbers: false,
  requirePoForGrn: false,
  requireGrnForInvoice: false,
  trackSoldPurchaseItems: true,
  overReceiptTolerancePercent: 0,
  preventNegativeCashBalance: true,
  allowNegativeTreasury: true,
  smtpEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecurity: "STARTTLS",
  smtpUsername: "",
  smtpPassword: "",
  smtpFromName: "",
  smtpFromEmail: "",
  emailTemplateSubject: "{{documentType}} رقم {{documentNumber}}",
  emailTemplateBody: "{{recipientName}}",
};

function renderScreen(initial: TenantSettingsDTO = baseSettings) {
  let current: TenantSettingsDTO = { ...initial };
  const transport = stubTransport({
    "GET /settings": () => ({ body: current }),
    "PUT /settings": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}") as Partial<TenantSettingsDTO>;
      const next = { ...current, ...patch };
      // Mirrors packages/api/src/settings-routes.ts exactly: the wire schema's own
      // `defaultTaxRate` max(100) rejects an out-of-range patch with 400 BEFORE the
      // domain's `updateSettings` ever runs (packages/api/src/settings-foundation-
      // routes.test.ts's "PUT /settings rejects an out-of-range value with 422" —
      // despite its name — asserts exactly this: `expect(res.status).toBe(400); //
      // fails zod's own max(100) first`). No "message" field on a 400, so the
      // client falls back to its own generic copy.
      if (next.defaultTaxRate < 0 || next.defaultTaxRate > 100) {
        return { status: 400, body: { error: "VALIDATION_ERROR" } };
      }
      current = next;
      return { body: current };
    },
  });
  return renderWithProviders(<SettingsGeneral />, { transport, initialSession: testAdminSession });
}

describe("SettingsGeneral", () => {
  it("opens on بيانات المنشأة and keeps the currency on الإقليمية والعملة", async () => {
    renderScreen();
    expect(await screen.findByRole("heading", { name: "الإعدادات" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "بيانات المنشأة" })).toHaveAttribute("aria-selected", "true");
    expect(textboxByLabel("اسم المنشأة")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "الإقليمية والعملة" }));
    expect(textboxByLabel("العملة الافتراضية")).toBeInTheDocument();
  });

  it("renders each field exactly once across the whole screen", async () => {
    renderScreen();
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    // Guards the defect this shape was built to remove: الرقم الضريبي used to
    // render on «بيانات المنشأة» AND «الضريبة», and أيام نهاية الأسبوع on
    // «عام» AND «بيانات المنشأة» — two controls writing one field behind one
    // save button, so whichever tab was touched last silently won.
    for (const tab of ["الضريبة", "السياسات", "الإقليمية والعملة", "بيانات المنشأة"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
    }
    expect(labelsByText("الرقم الضريبي")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "الإقليمية والعملة" }));
    expect(labelsByText("أيام نهاية الأسبوع")).toHaveLength(1);
  });

  it("keeps the save button disabled until a field is dirtied", async () => {
    renderScreen();
    expect(await screen.findByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: "بيانات المنشأة" }));
    fireEvent.change(textboxByLabel("اسم المنشأة"), { target: { value: "Cyag" } });

    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
  });

  it("saves a valid patch and clears the dirty flag", async () => {
    renderScreen();
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "الضريبة" }));
    fireEvent.change(textboxByLabel("نسبة الضريبة الافتراضية (%)"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled());
  });

  // guards §4.5 #13 — the fixed fallback sentence now carries the HTTP status
  // as a support code when the refusal body names no reason of its own.
  it("surfaces the server error instead of saving an out-of-range value", async () => {
    renderScreen();
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "الضريبة" }));
    fireEvent.change(textboxByLabel("نسبة الضريبة الافتراضية (%)"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    // Still dirty — the invalid patch was rejected by the server, not silently saved.
    expect(await screen.findByText(/^تعذر حفظ الإعدادات\. \(رمز \d{3}\)$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
  });

  it("shows the load-error copy with a retry button when /settings fails", async () => {
    const transport = stubTransport({
      "GET /settings": () => ({ status: 500, body: { error: "INTERNAL" } }),
    });
    renderWithProviders(<SettingsGeneral />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText(/تعذّر تحميل الإعدادات\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة المحاولة" })).toBeInTheDocument();
  });

  it("exposes the credit-control / inventory / purchase / treasury policy toggles", async () => {
    renderScreen();
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "السياسات" }));
    expect(screen.getByRole("switch", { name: "تفعيل الرقابة الائتمانية" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "السماح بالمخزون السالب" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "يجب وجود أمر شراء قبل استلام البضاعة" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "منع الرصيد السالب للحسابات النقدية" })).toBeInTheDocument();
  });

  it("drives every field on بيانات المنشأة and الضريبة and PUTs the exact resulting values", async () => {
    let lastBody: Record<string, unknown> | null = null;
    let current: TenantSettingsDTO = { ...baseSettings };
    const transport = stubTransport({
      "GET /settings": () => ({ body: current }),
      "PUT /settings": (init) => {
        lastBody = JSON.parse((init?.body as string) ?? "{}");
        current = { ...current, ...lastBody };
        return { body: current };
      },
    });
    renderWithProviders(<SettingsGeneral />, { transport, initialSession: testAdminSession });
    await screen.findByRole("button", { name: "حفظ الإعدادات" });

    fireEvent.click(screen.getByRole("tab", { name: "بيانات المنشأة" }));
    fireEvent.change(textboxByLabel("اسم المنشأة"), { target: { value: "شركة سياج الجديدة" } });
    fireEvent.change(textboxByLabel("الرقم الضريبي"), { target: { value: "300999999900003" } });
    fireEvent.change(textboxByLabel("السجل التجاري"), { target: { value: "12345" } });
    fireEvent.change(textboxByLabel("الهاتف"), { target: { value: "0298765432" } });
    fireEvent.change(textboxByLabel("البريد الإلكتروني", screen.getByRole("tabpanel")), { target: { value: "new@cyag.example" } });
    fireEvent.change(textboxByLabel("العنوان"), { target: { value: "مدينة نصر، القاهرة" } });

    fireEvent.click(screen.getByRole("tab", { name: "الضريبة" }));
    fireEvent.click(screen.getByRole("switch", { name: "تفعيل ضريبة القيمة المضافة" }));
    fireEvent.change(textboxByLabel("نسبة الضريبة الافتراضية (%)"), { target: { value: "15" } });
    selectOption("طريقة حساب الضريبة", "شاملة (مضمنة في السعر)");

    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled());

    const body = lastBody as unknown as Partial<TenantSettingsDTO>;
    expect(body.companyName).toBe("شركة سياج الجديدة");
    expect(body.taxRegistrationNumber).toBe("300999999900003");
    expect(body.commercialRegistrationNumber).toBe("12345");
    expect(body.phone).toBe("0298765432");
    expect(body.email).toBe("new@cyag.example");
    expect(body.address).toBe("مدينة نصر، القاهرة");
    expect(body.taxEnabled).toBe(false);
    expect(body.defaultTaxRate).toBe(15);
    expect(body.taxCalculation).toBe("INCLUSIVE");
  });

  it("drives every field on الإقليمية والعملة — text, toggle, select and both multi-chip pickers — and PUTs the exact values", async () => {
    let lastBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      "GET /settings": () => ({ body: baseSettings }),
      "PUT /settings": (init) => {
        lastBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { ...baseSettings, ...lastBody } };
      },
    });
    renderWithProviders(<SettingsGeneral />, { transport, initialSession: testAdminSession });
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "الإقليمية والعملة" }));

    fireEvent.change(textboxByLabel("العملة الافتراضية"), { target: { value: "usd" } });
    fireEvent.click(screen.getByRole("switch", { name: "تفعيل تعدد العملات" }));
    // Additional currencies: remove SAR (present), add BHD (absent).
    fireEvent.click(screen.getByRole("button", { name: "SAR" }));
    fireEvent.click(screen.getByRole("button", { name: "BHD" }));
    selectOption("سياسة غياب سعر الصرف", "السماح بالمتابعة بدون سعر صرف");
    selectOption("اللغة الافتراضية", "English");
    fireEvent.change(textboxByLabel("المنطقة الزمنية"), { target: { value: "Africa/Alexandria" } });
    fireEvent.change(textboxByLabel("تنسيق التاريخ"), { target: { value: "YYYY-MM-DD" } });
    selectOption("نظام الأرقام", "أرقام عربية (٠, ١, ٢, ٣)");
    fireEvent.change(textboxByLabel("بداية السنة المالية (شهر)"), { target: { value: "7" } });
    selectOption("أول أيام الأسبوع", "الأحد");
    // Weekend days: drop السبت, add الأحد.
    fireEvent.click(screen.getByRole("button", { name: "السبت" }));
    fireEvent.click(screen.getByRole("button", { name: "الأحد" }));

    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled());

    const body = lastBody as unknown as Partial<TenantSettingsDTO>;
    expect(body.currency).toBe("USD");
    expect(body.multiCurrencyEnabled).toBe(true);
    expect(body.secondaryCurrencies).toEqual(expect.arrayContaining(["USD", "AED", "EUR", "KWD", "QAR", "JOD", "BHD"]));
    expect(body.secondaryCurrencies).not.toContain("SAR");
    expect(body.fxRateMissingPolicy).toBe("ALLOW_MISSING");
    expect(body.language).toBe("en");
    expect(body.timezone).toBe("Africa/Alexandria");
    expect(body.dateFormat).toBe("YYYY-MM-DD");
    expect(body.dateNumerals).toBe("arabic");
    expect(body.fiscalYearStartMonth).toBe(7);
    expect(body.weekStartDay).toBe(0);
    expect(body.weekendDays?.slice().sort()).toEqual([0, 5]);
  });

  it("closing a period has its own single-operator switch: turning it on PUTs that setting and leaves the contracting one as it was", async () => {
    let lastBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      "GET /settings": () => ({ body: baseSettings }),
      "PUT /settings": (init) => {
        lastBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { ...baseSettings, ...lastBody } };
      },
    });
    renderWithProviders(<SettingsGeneral />, { transport, initialSession: testAdminSession });
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "السياسات" }));

    const closeSwitch = screen.getByRole("switch", { name: "وضع المشغّل الواحد لإقفال الفترات" });
    expect(closeSwitch).toHaveAttribute("aria-checked", "false");
    fireEvent.click(closeSwitch);
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await waitFor(() => expect(lastBody).not.toBeNull());

    expect(lastBody).toMatchObject({ periodCloseSingleOperatorMode: true, contractingSingleOperatorMode: false });
  });

  it("drives every field on السياسات — every toggle, number and select — and PUTs the exact values, leaving the untouched tabs' fields as they were", async () => {
    let lastBody: Record<string, unknown> | null = null;
    const transport = stubTransport({
      "GET /settings": () => ({ body: baseSettings }),
      "PUT /settings": (init) => {
        lastBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { ...baseSettings, ...lastBody } };
      },
    });
    renderWithProviders(<SettingsGeneral />, { transport, initialSession: testAdminSession });
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "السياسات" }));

    fireEvent.click(screen.getByRole("switch", { name: "السماح بالبيع من مستودع آخر" }));
    fireEvent.click(screen.getByRole("switch", { name: "عرض المخزون في المستودعات الأخرى" }));
    fireEvent.click(screen.getByRole("switch", { name: "السماح بالطلبات المؤجلة" }));
    fireEvent.click(screen.getByRole("switch", { name: "السماح بالمخزون السالب" }));
    fireEvent.click(screen.getByRole("switch", { name: "توليد أرقام الدفعات تلقائيًا" }));

    fireEvent.click(screen.getByRole("switch", { name: "تفعيل مخصص المخزون الراكد" }));
    fireEvent.change(textboxByLabel("يُعدّ المخزون راكدًا بعد (شهر)"), { target: { value: "9" } });
    fireEvent.change(textboxByLabel("نسبة المخصص (%)"), { target: { value: "40" } });

    fireEvent.click(screen.getByRole("switch", { name: "يجب وجود أمر شراء قبل استلام البضاعة" }));
    fireEvent.click(screen.getByRole("switch", { name: "يجب وجود استلام بضاعة قبل فاتورة الشراء" }));
    fireEvent.click(screen.getByRole("switch", { name: "تتبع البضاعة المستهلكة من فواتير الشراء" }));

    fireEvent.click(screen.getByRole("switch", { name: "تفعيل قوائم الأسعار" }));
    fireEvent.click(screen.getByRole("switch", { name: "تفعيل الرقابة الائتمانية" }));
    selectOption("وضع الرقابة", "منع تام (BLOCK)");
    fireEvent.change(textboxByLabel("أقصى خصم للسطر بلا اعتماد (%)"), { target: { value: "20" } });

    fireEvent.click(screen.getByRole("switch", { name: "منع الرصيد السالب للحسابات النقدية" }));
    fireEvent.click(screen.getByRole("switch", { name: "السماح بالرصيد السالب للحسابات البنكية" }));

    selectOption("إهلاك شهر الاقتناء", "شهر كامل");

    // Allowed email domains: custom-entry chip, committed with Enter.
    const domainEntry = screen.getByPlaceholderText("أضف نطاقاً (مثال: mezan.com)");
    fireEvent.change(domainEntry, { target: { value: "mezan.com" } });
    fireEvent.keyDown(domainEntry, { key: "Enter" });

    fireEvent.change(textboxByLabel("فترة التنبيه على انتهاء العقد (يوم)"), { target: { value: "45" } });
    selectOption("أساس قسمة اليوم في الرواتب", "أيام الشهر الفعلية");
    fireEvent.change(textboxByLabel("ساعات العمل اليومية القياسية"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled());

    const body = lastBody as unknown as Partial<TenantSettingsDTO>;
    expect(body.allowCrossWarehouseSales).toBe(false);
    expect(body.showOtherWarehouseStock).toBe(false);
    expect(body.allowBackorder).toBe(true);
    expect(body.allowNegativeStock).toBe(true);
    expect(body.autoGenerateBatchNumbers).toBe(true);
    expect(body.agingWritedownEnabled).toBe(true);
    expect(body.agingWritedownMonths).toBe(9);
    expect(body.agingWritedownRatePercent).toBe(40);
    expect(body.requirePoForGrn).toBe(true);
    expect(body.requireGrnForInvoice).toBe(true);
    expect(body.trackSoldPurchaseItems).toBe(false);
    expect(body.priceListsEnabled).toBe(false);
    expect(body.creditControlEnabled).toBe(true);
    expect(body.creditControlMode).toBe("BLOCK");
    expect(body.maxLineDiscountPercent).toBe(20);
    expect(body.preventNegativeCashBalance).toBe(false);
    expect(body.allowNegativeTreasury).toBe(false);
    expect(body.depreciationProrate).toBe("FULL_MONTH");
    expect(body.allowedEmailDomains).toEqual(["mezan.com"]);
    expect(body.hrContractExpiryWarningDays).toBe(45);
    expect(body.payrollDayDivisorBasis).toBe("CALENDAR_DAYS");
    expect(body.standardDailyWorkHours).toBe(10);
    // Fields on the tabs never touched this run rode along unchanged, not blanked.
    expect(body.companyName).toBe(baseSettings.companyName);
    expect(body.currency).toBe(baseSettings.currency);
  });

  it("a toggle round-trips: after save, the switch stays on its saved value across a tab switch — it does not reset to the value the page first loaded with", async () => {
    let current: TenantSettingsDTO = { ...baseSettings };
    const transport = stubTransport({
      "GET /settings": () => ({ body: current }),
      "PUT /settings": (init) => {
        const patch = JSON.parse((init?.body as string) ?? "{}") as Partial<TenantSettingsDTO>;
        current = { ...current, ...patch };
        return { body: current };
      },
    });
    renderWithProviders(<SettingsGeneral />, { transport, initialSession: testAdminSession });
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "السياسات" }));

    const toggle = screen.getByRole("switch", { name: "السماح بالمخزون السالب" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled());

    // Leave the tab and come back — a bug that re-seeds the draft from the
    // ORIGINAL query data (rather than the server's saved response) would
    // silently flip this back off.
    fireEvent.click(screen.getByRole("tab", { name: "بيانات المنشأة" }));
    fireEvent.click(screen.getByRole("tab", { name: "السياسات" }));
    expect(screen.getByRole("switch", { name: "السماح بالمخزون السالب" })).toBeChecked();
  });

  it("a save failure keeps the user's edited values in the form — a multi-tab edit is not reverted by the rejection", async () => {
    renderScreen();
    await screen.findByRole("button", { name: "حفظ الإعدادات" });

    fireEvent.click(screen.getByRole("tab", { name: "بيانات المنشأة" }));
    fireEvent.change(textboxByLabel("اسم المنشأة"), { target: { value: "اسم لن يُحفظ" } });
    fireEvent.click(screen.getByRole("tab", { name: "الضريبة" }));
    fireEvent.change(textboxByLabel("نسبة الضريبة الافتراضية (%)"), { target: { value: "999" } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    expect(await screen.findByText(/^تعذر حفظ الإعدادات\. \(رمز \d{3}\)$/)).toBeInTheDocument();
    // The rejected out-of-range field AND the untouched-by-the-error field on
    // the other tab both still hold the user's edits — nothing was reverted.
    expect(textboxByLabel("نسبة الضريبة الافتراضية (%)")).toHaveValue(999);
    fireEvent.click(screen.getByRole("tab", { name: "بيانات المنشأة" }));
    expect(textboxByLabel("اسم المنشأة")).toHaveValue("اسم لن يُحفظ");
  });

  it.each([
    ["blank", "   ", "اسم المنشأة مطلوب."],
    ["carrying a direction override", "شركة \u202Eevil", "اسم المنشأة يحتوي على رموز غير مسموح بها."],
    ["longer than the limit", "ش".repeat(COMPANY_NAME_MAX_LENGTH + 1), `اسم المنشأة أطول من ${COMPANY_NAME_MAX_LENGTH} حرف.`],
  ])("refuses a %s company name in Arabic before anything is sent, and keeps what was typed", async (_what, name, message) => {
    let putCalls = 0;
    const transport = stubTransport({
      "GET /settings": () => ({ body: baseSettings }),
      "PUT /settings": () => {
        putCalls += 1;
        return { body: baseSettings };
      },
    });
    renderWithProviders(<SettingsGeneral />, { transport, initialSession: testAdminSession });
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "بيانات المنشأة" }));
    expect(textboxByLabel("اسم المنشأة")).toHaveAttribute("maxlength", String(COMPANY_NAME_MAX_LENGTH));
    fireEvent.change(textboxByLabel("اسم المنشأة"), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(putCalls).toBe(0);
    expect(textboxByLabel("اسم المنشأة")).toHaveValue(name);
  });

  it("takes the person to the company tab and marks the name field when a save from another tab meets a stored company name that is empty", async () => {
    let putCalls = 0;
    const transport = stubTransport({
      "GET /settings": () => ({ body: { ...baseSettings, companyName: "" } }),
      "PUT /settings": (init) => {
        putCalls += 1;
        return { body: JSON.parse(String(init?.body)) as unknown };
      },
    });
    renderWithProviders(<SettingsGeneral />, { transport, initialSession: testAdminSession });
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "الضريبة" }));
    fireEvent.change(textboxByLabel("نسبة الضريبة الافتراضية (%)"), { target: { value: "15" } });

    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));

    expect(screen.getByRole("tab", { name: "بيانات المنشأة" })).toHaveAttribute("aria-selected", "true");
    const name = textboxByLabel("اسم المنشأة");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription("اسم المنشأة مطلوب.");
    expect(putCalls).toBe(0);

    fireEvent.change(name, { target: { value: "شركة الاختبار" } });
    expect(textboxByLabel("اسم المنشأة")).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await waitFor(() => expect(putCalls).toBe(1));
    fireEvent.click(screen.getByRole("tab", { name: "الضريبة" }));
    expect(textboxByLabel("نسبة الضريبة الافتراضية (%)")).toHaveValue(15);
  });

  it("#129 previews the statement email from the template as it is typed, with placeholders filled and values printed literally", async () => {
    renderScreen();
    await screen.findByRole("heading", { name: "الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "البريد الإلكتروني" }));
    fireEvent.change(textboxByLabel("الموضوع"), { target: { value: "كشف {{customerName}} من {{companyName}}" } });
    fireEvent.change(textboxByLabel("نص الرسالة"), { target: { value: "الرصيد {{balanceDue}}" } });
    const preview = screen.getByRole("region", { name: "معاينة — بقيم توضيحية" });
    expect(preview).toHaveTextContent(`كشف اسم العميل من ${baseSettings.companyName}`);
    expect(preview).toHaveTextContent("الرصيد 0.00");
  });
});
