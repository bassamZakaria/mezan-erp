// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FirstRunWizard } from "./FirstRunWizard";

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

  it("starts on the activate-license step with تجريبي stub notes", () => {
    document.documentElement.setAttribute("data-theme", theme);
    render(<FirstRunWizard onFinish={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole("heading", { name: "معالج الإعداد الأولي" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "تفعيل الترخيص" })).toBeInTheDocument();
    expect(screen.getAllByText("تجريبي").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
  });

  it("enables التالي once activation is stubbed-completed", () => {
    render(<FirstRunWizard onFinish={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "تفعيل" }));
    expect(screen.getByText("مُفعّل")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled();
  });

  it("validates the admin step before advancing to seed", () => {
    render(<FirstRunWizard onFinish={() => {}} onCancel={() => {}} />);
    goToAdminStep();
    expect(screen.getByRole("heading", { name: "إنشاء حساب المسؤول" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getByRole("alert")).toHaveTextContent("الاسم الكامل والبريد الإلكتروني مطلوبان");

    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getByRole("heading", { name: "تهيئة البيانات الأساسية" })).toBeInTheDocument();
  });

  it("requires every seed task done before التالي, and تشغيل الكل completes them all", () => {
    render(<FirstRunWizard onFinish={() => {}} onCancel={() => {}} />);
    goToAdminStep();
    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    expect(screen.getByRole("button", { name: "التالي" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "تشغيل الكل" }));
    expect(screen.getAllByText("جاهز")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled();
  });

  it("reaches the optional import step and finishes into the app", () => {
    const onFinish = vi.fn();
    render(<FirstRunWizard onFinish={onFinish} onCancel={() => {}} />);
    goToAdminStep();
    fillAdminForm();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    fireEvent.click(screen.getByRole("button", { name: "تشغيل الكل" }));
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));

    expect(screen.getByRole("heading", { name: "استيراد البيانات (اختياري)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "استيراد الآن" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "إنهاء والانتقال إلى النظام" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel to return to login from any step", () => {
    const onCancel = vi.fn();
    render(<FirstRunWizard onFinish={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "إلغاء والعودة لتسجيل الدخول" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
