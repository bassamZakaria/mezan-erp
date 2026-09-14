// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { PlatformLogin } from "./PlatformLogin";
import { usePlatformApi } from "./api";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";

function SessionProbe() {
  const { session } = usePlatformApi();
  return <span data-testid="session">{session?.user.email ?? "none"}</span>;
}

const okTransport = () =>
  stubPlatformTransport({ "POST /auth/login": () => ({ body: testPlatformSession }) });

const denyTransport = () =>
  stubPlatformTransport({
    "POST /auth/login": () => ({ status: 401, body: { error: "INVALID_CREDENTIALS", message: "بيانات الدخول غير صحيحة" } }),
  });

describe("PlatformLogin", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the email and password fields and a disabled submit until both are filled", () => {
    renderWithPlatformProviders(<PlatformLogin />, { transport: okTransport() });
    expect(screen.getByRole("heading", { name: "تسجيل دخول المنصة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "دخول" })).toBeDisabled();
  });

  it("posts to /auth/login and stores the session under mezan.platform.session on success", async () => {
    renderWithPlatformProviders(
      <>
        <PlatformLogin />
        <SessionProbe />
      </>,
      { transport: okTransport() },
    );
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "owner@mezan.example" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "super-secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("owner@mezan.example"));
    expect(JSON.parse(localStorage.getItem("mezan.platform.session") ?? "null")).toEqual(testPlatformSession);
  });

  it("shows «بيانات الدخول غير صحيحة» when the backend rejects the credentials", async () => {
    renderWithPlatformProviders(<PlatformLogin />, { transport: denyTransport() });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "owner@mezan.example" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "wrong-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("بيانات الدخول غير صحيحة");
  });
});
