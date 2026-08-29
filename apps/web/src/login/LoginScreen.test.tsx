// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen";
import { useApi } from "../data/ApiContext";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function SessionProbe() {
  const { session } = useApi();
  return <span data-testid="session">{session?.nameAr ?? "none"}</span>;
}

function fillPin(pin: string) {
  pin.split("").forEach((digit, index) => {
    fireEvent.change(screen.getByLabelText(`رمز PIN رقم ${index + 1}`), { target: { value: digit } });
  });
}

const ENTITLEMENTS = {
  plan: "ENTERPRISE",
  activeModules: ["sales", "purchases", "inventory", "accounting"],
  features: {},
  seats: 10,
  expiresAt: null,
};

const preAuth = {
  "GET /tenant": () => ({ body: { name: "Cyag" } }),
  "GET /entitlements": () => ({ body: ENTITLEMENTS }),
};

const okTransport = () => stubTransport({ ...preAuth, "POST /auth/login": () => ({ body: testAdminSession }) });
const denyTransport = () =>
  stubTransport({
    ...preAuth,
    "POST /auth/login": () => ({ status: 401, body: { error: "INVALID_CREDENTIALS", message: "اسم المستخدم أو رمز PIN غير صحيح." } }),
  });

describe.each(["light", "dark"] as const)("LoginScreen (%s theme)", (theme) => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the login heading and prefilled username", () => {
    document.documentElement.setAttribute("data-theme", theme);
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
    expect(screen.getByLabelText("اسم المستخدم")).toHaveValue("محمد الشهابي");
  });

  it("keeps دخول disabled until username and all 4 PIN digits are filled", () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
    fillPin("123");
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
    fillPin("123456");
    expect(screen.getByRole("button", { name: "دخول" })).toBeEnabled();
  });

  it("shows an inline error when the backend rejects the credentials", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: denyTransport() });
    fillPin("0000");
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("اسم المستخدم أو رمز PIN غير صحيح.");
  });

  it("establishes the ApiContext session after a successful real sign-in", async () => {
    renderWithProviders(
      <>
        <LoginScreen onStartWizard={() => {}} />
        <SessionProbe />
      </>,
      { transport: okTransport() },
    );
    expect(screen.getByTestId("session")).toHaveTextContent("none");

    fillPin("123456");
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent(testAdminSession.nameAr));
  });

  it("calls onStartWizard from the first-run link", () => {
    const onStartWizard = vi.fn();
    renderWithProviders(<LoginScreen onStartWizard={onStartWizard} />, { transport: okTransport() });
    fireEvent.click(screen.getByRole("button", { name: "أول مرة على ميزان؟ ابدأ معالج الإعداد الأولي" }));
    expect(onStartWizard).toHaveBeenCalledTimes(1);
  });
});
