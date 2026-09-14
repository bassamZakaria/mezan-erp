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

// Deliberately NOT the catalog's own wording — the login screen must show its
// own «بيانات الدخول غير صحيحة» on a 401 regardless of what the server said,
// so a stub that echoed the catalog string back would let that requirement
// pass by coincidence rather than prove it.
const denyTransport = () =>
  stubPlatformTransport({
    "POST /auth/login": () => ({ status: 401, body: { error: "INVALID_CREDENTIALS", message: "server says something else entirely" } }),
  });

describe("PlatformLogin", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the platform sign-in heading with the submit button disabled at rest", () => {
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

  it("shows the console's own «بيانات الدخول غير صحيحة» on a 401, not the server's message, and clears the password", async () => {
    renderWithPlatformProviders(<PlatformLogin />, { transport: denyTransport() });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), { target: { value: "owner@mezan.example" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "wrong-pass" } });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("بيانات الدخول غير صحيحة");
    expect(screen.getByLabelText("كلمة المرور")).toHaveValue("");
  });
});
