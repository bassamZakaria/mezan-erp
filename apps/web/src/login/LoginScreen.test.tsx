// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { LoginScreen } from "./LoginScreen";
import { useApi } from "../data/ApiContext";
import { rememberDeviceUser } from "./device-users";
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
  beforeEach(() => {
    // The face row reads `mezan.deviceUsers` from localStorage on mount, so a
    // user remembered by one test (e.g. a successful sign-in below) would
    // otherwise leak into the next test's render.
    localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("renders the plain sign-in heading and email field when the device remembers nobody", () => {
    document.documentElement.setAttribute("data-theme", theme);
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeInTheDocument();
    expect(screen.getByLabelText("البريد الإلكتروني")).toHaveValue("admin@cyag.example");
  });

  it("prefills the remembered device user's identity and preselects their face", () => {
    rememberDeviceUser(testAdminSession);
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("heading", { name: "مَن يعمل الآن؟" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "اختر محمد الشهابي" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("الرمز السرّي لـ محمد الشهابي")).toBeInTheDocument();
  });

  it("keeps دخول disabled until all 6 PIN digits are filled, then submits automatically", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: okTransport() });
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
    fillPin("123");
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
    fillPin("123456");
    // The 6th digit auto-submits (see LoginScreen's `submitRef` effect), so the
    // button goes straight from disabled-while-incomplete to disabled-while-pending
    // before re-enabling once the sign-in call resolves.
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "دخول" })).toBeEnabled());
  });

  it("shows an inline error when the backend rejects the credentials", async () => {
    renderWithProviders(<LoginScreen onStartWizard={() => {}} />, { transport: denyTransport() });
    fillPin("000000");
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
    fireEvent.click(screen.getByRole("button", { name: "الإعداد الأولي" }));
    expect(onStartWizard).toHaveBeenCalledTimes(1);
  });
});
