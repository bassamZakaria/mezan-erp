// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { TenantSettingsDTO } from "@mezan/contracts";
import { SettingsGeneral } from "./SettingsGeneral";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const SETTINGS: TenantSettingsDTO = {
  currency: "EGP",
  secondaryCurrencies: ["SAR", "USD"],
  language: "ar",
  timezone: "Africa/Cairo",
  direction: "RTL",
  dateFormat: "DD/MM/YYYY",
  dateNumerals: "western",
  weekendDays: [5, 6],
  fiscalYearStartMonth: 1,
  fxRateMissingPolicy: "STRICT",

  companyName: "Cyag — شركة سياج للصناعات",
  taxRegistrationNumber: "300123456700003",
  commercialRegistrationNumber: "",
  phone: "0223456789",
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

  allowCrossWarehouseSales: true,
  showOtherWarehouseStock: true,
  allowBackorder: false,
  allowNegativeStock: false,

  requirePoForGrn: false,
  requireGrnForInvoice: false,
  trackSoldPurchaseItems: true,

  preventNegativeCashBalance: true,
  allowNegativeTreasury: true,
};

function renderPage() {
  let current = SETTINGS;
  const transport = stubTransport({
    "GET /settings": () => ({ body: current }),
    "PUT /settings": (init) => {
      const patch = JSON.parse((init?.body as string) ?? "{}") as Partial<TenantSettingsDTO>;
      if ((patch.defaultTaxRate ?? 0) > 100) {
        return { status: 422, body: { message: "نسبة الضريبة يجب أن تكون بين 0 و100" } };
      }
      current = { ...current, ...patch };
      return { body: current };
    },
  });
  return renderWithProviders(<SettingsGeneral />, { transport, initialSession: testAdminSession });
}

describe("SettingsGeneral", () => {
  it("renders the general tab from the live settings bag", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "الإعدادات" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "عام" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("العملة الافتراضية")).toHaveValue("EGP");
  });

  it("keeps the save button disabled until a field is dirtied", async () => {
    renderPage();
    expect(await screen.findByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();

    fireEvent.click(screen.getByRole("tab", { name: "بيانات المنشأة" }));
    fireEvent.change(screen.getByLabelText("اسم المنشأة"), { target: { value: "Cyag" } });

    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
  });

  it("saves a valid patch and clears the dirty flag", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "الضريبة" }));
    fireEvent.change(screen.getByLabelText("نسبة الضريبة الافتراضية (%)"), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled());
  });

  it("surfaces the server's rejection instead of saving an out-of-range value", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "الضريبة" }));
    fireEvent.change(screen.getByLabelText("نسبة الضريبة الافتراضية (%)"), { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    expect(await screen.findByText("نسبة الضريبة يجب أن تكون بين 0 و100")).toBeInTheDocument();
    // Still dirty — the rejected patch was not silently kept as saved.
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
  });

  it("exposes the credit-control / inventory / purchase / treasury policy toggles", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "السياسات" }));
    expect(screen.getByRole("switch", { name: "تفعيل الرقابة الائتمانية" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "السماح بالمخزون السالب" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "يجب وجود أمر شراء قبل استلام البضاعة" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "منع الرصيد السالب للحسابات النقدية" })).toBeInTheDocument();
  });
});
