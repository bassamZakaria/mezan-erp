// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function fillPin(pin: string) {
  pin.split("").forEach((digit, index) => {
    fireEvent.change(screen.getByLabelText(`رمز PIN رقم ${index + 1}`), { target: { value: digit } });
  });
}

const okTransport = () => stubTransport({ "POST /auth/login": () => ({ body: testAdminSession }) });
const denyTransport = () =>
  stubTransport({
    "POST /auth/login": () => ({ status: 401, body: { error: "INVALID_CREDENTIALS", message: "اسم المستخدم أو رمز PIN غير صحيح." } }),
  });

describe.each(["light", "dark"] as const)("LoginScreen (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the tenant chip, prefilled username and licensed-modules summary", () => {
    document.documentElement.setAttribute("data-theme", theme);
    renderWithProviders(<LoginScreen onLogin={() => {}} onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
    expect(screen.getAllByText("Cyag").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("اسم المستخدم")).toHaveValue("محمد الشهابي");
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
  });

  it("keeps دخول disabled until username and all 4 PIN digits are filled", () => {
    renderWithProviders(<LoginScreen onLogin={() => {}} onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
    fillPin("123");
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
    fillPin("1234");
    expect(screen.getByRole("button", { name: "دخول" })).toBeEnabled();
  });

  it("shows an inline error when the backend rejects the credentials", async () => {
    renderWithProviders(<LoginScreen onLogin={() => {}} onStartWizard={() => {}} />, { transport: denyTransport() });
    fillPin("0000");
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("اسم المستخدم أو رمز PIN غير صحيح.");
  });

  it("calls onLogin after a successful real sign-in", async () => {
    const onLogin = vi.fn();
    renderWithProviders(<LoginScreen onLogin={onLogin} onStartWizard={() => {}} />, { transport: okTransport() });
    fillPin("1234");
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    await vi.waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
  });

  it("calls onStartWizard from the first-run link", () => {
    const onStartWizard = vi.fn();
    renderWithProviders(<LoginScreen onLogin={() => {}} onStartWizard={onStartWizard} />, { transport: okTransport() });
    fireEvent.click(screen.getByRole("button", { name: "أول مرة على ميزان؟ ابدأ معالج الإعداد الأولي" }));
    expect(onStartWizard).toHaveBeenCalledTimes(1);
  });
});
