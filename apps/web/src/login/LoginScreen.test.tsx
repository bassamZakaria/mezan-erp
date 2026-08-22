// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen";

function fillPin(pin: string) {
  pin.split("").forEach((digit, index) => {
    fireEvent.change(screen.getByLabelText(`رمز PIN رقم ${index + 1}`), { target: { value: digit } });
  });
}

describe.each(["light", "dark"] as const)("LoginScreen (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the Cyag tenant chip, username and licensed-modules summary", () => {
    document.documentElement.setAttribute("data-theme", theme);
    render(<LoginScreen onLogin={() => {}} onStartWizard={() => {}} />);
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
    expect(screen.getAllByText("Cyag").length).toBeGreaterThan(0);
    expect(screen.getByText("Enterprise")).toBeInTheDocument();
    expect(screen.getByLabelText("اسم المستخدم")).toHaveValue("محمد الشهابي");
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
    expect(screen.getByText("المحاسبة")).toBeInTheDocument();
  });

  it("keeps دخول disabled until username and all 4 PIN digits are filled", () => {
    render(<LoginScreen onLogin={() => {}} onStartWizard={() => {}} />);
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
    fillPin("123");
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
    fillPin("1234");
    expect(screen.getByRole("button", { name: "دخول" })).toBeEnabled();
  });

  it("rejects an incorrect PIN with an inline error", () => {
    render(<LoginScreen onLogin={() => {}} onStartWizard={() => {}} />);
    fillPin("0000");
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    expect(screen.getByRole("alert")).toHaveTextContent("رمز PIN غير صحيح");
  });

  it("calls onLogin when the demo PIN 1234 is submitted", () => {
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} onStartWizard={() => {}} />);
    fillPin("1234");
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it("calls onStartWizard from the first-run link", () => {
    const onStartWizard = vi.fn();
    render(<LoginScreen onLogin={() => {}} onStartWizard={onStartWizard} />);
    fireEvent.click(screen.getByRole("button", { name: "أول مرة على ميزان؟ ابدأ معالج الإعداد الأولي" }));
    expect(onStartWizard).toHaveBeenCalledTimes(1);
  });
});
