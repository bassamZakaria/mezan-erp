// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { TenantSettingsDTO } from "@mezan/contracts";
import { SettingsGeneral } from "./SettingsGeneral";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

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
  overtimeMultiplier: 1.5,
  standardDailyWorkHours: 8,
  taxEnabled: true,
  defaultTaxRate: 14,
  taxCalculation: "EXCLUSIVE",
  depreciationProrate: "DAILY",
  priceListsEnabled: true,
  creditControlEnabled: false,
  creditControlMode: "WARNING",
  maxLineDiscountPercent: 100,
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
    expect(screen.getByLabelText("اسم المنشأة")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "الإقليمية والعملة" }));
    expect(screen.getByLabelText("العملة الافتراضية")).toBeInTheDocument();
  });

  it("renders each field exactly once across the whole screen", async () => {
    renderScreen();
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    // Guards the defect this shape was built to remove: الرقم الضريبي used to
    // render on «بيانات المنشأة» AND «الضريبة», and أيام العطلة الأسبوعية on
    // «عام» AND «بيانات المنشأة» — two controls writing one field behind one
    // save button, so whichever tab was touched last silently won.
    for (const tab of ["الضريبة", "السياسات", "الإقليمية والعملة", "بيانات المنشأة"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
    }
    expect(screen.getAllByLabelText("الرقم الضريبي")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "الإقليمية والعملة" }));
    expect(screen.getAllByLabelText("أيام العطلة الأسبوعية")).toHaveLength(1);
  });

  it("keeps the save button disabled until a field is dirtied", async () => {
    renderScreen();
    expect(await screen.findByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: "بيانات المنشأة" }));
    fireEvent.change(screen.getByLabelText("اسم المنشأة"), { target: { value: "Cyag" } });

    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
  });

  it("saves a valid patch and clears the dirty flag", async () => {
    renderScreen();
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "الضريبة" }));
    fireEvent.change(screen.getByLabelText("نسبة الضريبة الافتراضية (%)"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled());
  });

  it("surfaces the server error instead of saving an out-of-range value", async () => {
    renderScreen();
    await screen.findByRole("button", { name: "حفظ الإعدادات" });
    fireEvent.click(screen.getByRole("tab", { name: "الضريبة" }));
    fireEvent.change(screen.getByLabelText("نسبة الضريبة الافتراضية (%)"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    // Still dirty — the invalid patch was rejected by the server, not silently saved.
    expect(await screen.findByText("تعذر حفظ الإعدادات.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
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
});
