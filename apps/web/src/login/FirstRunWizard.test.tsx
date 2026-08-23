// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { FirstRunWizard } from "./FirstRunWizard";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

const EMPTY_COUNTS = { accounts: 0, taxRates: 0, branches: 0, warehouses: 0, fiscalPeriods: 0, users: 0 };
const SEEDED_COUNTS = { accounts: 30, taxRates: 1, branches: 1, warehouses: 1, fiscalPeriods: 12, users: 1 };

function wizardTransport() {
  let counts = EMPTY_COUNTS;
  return stubTransport({
    "GET /tenant": () => ({ body: { name: "Cyag" } }),
    "GET /bootstrap/status": () => ({ body: counts }),
    "POST /bootstrap/seed": () => {
      counts = SEEDED_COUNTS;
      return { body: counts };
    },
    "POST /bootstrap/admin": () => ({ status: 201, body: testAdminSession }),
  });
}

function renderWizard(onFinish = () => {}, onCancel = () => {}) {
  return renderWithProviders(<FirstRunWizard onFinish={onFinish} onCancel={onCancel} />, {
    transport: wizardTransport(),
  });
}

function goToAdminStep() {
  fireEvent.click(screen.getByRole("button", { name: "تفعيل" }));
  fireEvent.click(screen.getByRole("button", { name: "التالي" }));
}

function fillAdminForm() {
  fireEvent.change(screen.getByLabelText("الاسم الكامل"), { target: { value: "سارة حسن" } });
  fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "sara@cyag.example" } });
  fireEvent.change(screen.getByLabelText("رمز PIN (4 أرقام)"), { target: { value: "4321" } });
  fireEvent.change(screen.getByLabelText("تأكيد رمز PIN"), { target: { value: "4321" } });
}

describe.each(["light", "dark"] as const)("FirstRunWizard (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("starts on the activate-license step", () => {
    document.documentElement.setAttribute("data-theme", theme);
    renderWizard();
    expect(screen.getByRole("heading", { name: "معالج الإعداد الأولي" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "تفعيل الترخيص" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
  });

  it("enables التالي once activation is stubbed-completed", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "تفعيل" }));
    expect(screen.getByText("مُفعّل")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled();
  });

  it("validates the admin step, then persists the admin and advances to seed", async () => {
    renderWizard();
    goToAdminStep();
    expect(screen.getByRole("heading", { name: "إنشاء حساب المسؤول" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getByRole("alert")).toHaveTextContent("الاسم الكامل والبريد الإلكتروني مطلوبان");

    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(await screen.findByRole("heading", { name: "تهيئة البيانات الأساسية" })).toBeInTheDocument();
  });

  it("requires the base data to exist before التالي, and تشغيل التهيئة seeds it for real", async () => {
    renderWizard();
    goToAdminStep();
    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    await screen.findByRole("heading", { name: "تهيئة البيانات الأساسية" });

    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "تشغيل التهيئة" }));
    expect(await screen.findAllByText("جاهز")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled();
  });

  it("reaches the optional import step and finishes into the app", async () => {
    const onFinish = vi.fn();
    renderWizard(onFinish);
    goToAdminStep();
    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    await screen.findByRole("heading", { name: "تهيئة البيانات الأساسية" });
    fireEvent.click(screen.getByRole("button", { name: "تشغيل التهيئة" }));
    await screen.findAllByText("جاهز");
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    expect(screen.getByRole("heading", { name: "استيراد البيانات (اختياري)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إنهاء والانتقال إلى النظام" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel to return to login from any step", () => {
    const onCancel = vi.fn();
    renderWizard(() => {}, onCancel);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
