// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { AppI18nProvider } from "../i18n";
import { VerifyScreen } from "./VerifyScreen";

function open(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))),
  );
  render(
    <AppI18nProvider>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/signup/verify?token=an-old-token"]}>
          <VerifyScreen />
        </MemoryRouter>
      </QueryClientProvider>
    </AppI18nProvider>,
  );
}

describe("VerifyScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("points the holder of a long-used link to sign-in, with no PIN field, no company code and no error styling", async () => {
    open(410, { error: "SIGNUP_ALREADY_ACTIVATED", message: "تم تفعيل هذا الحساب مسبقًا. سجّل الدخول برمز منشأتك وبريدك." });

    expect(await screen.findByRole("heading", { name: "تم تفعيل هذا الحساب مسبقًا", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("تم تفعيل هذا الحساب مسبقًا. سجّل الدخول برمز منشأتك وبريدك.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "الذهاب لتسجيل الدخول" })).toBeInTheDocument();
    expect(screen.queryByText("رقم التعريف الشخصي (PIN)")).not.toBeInTheDocument();
    expect(screen.queryByText("رمز المنشأة")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells someone whose sign-up awaits approval that it was received, with no PIN and no error", async () => {
    open(409, { error: "SIGNUP_AWAITING_APPROVAL", message: "تم تأكيد بريدك الإلكتروني. طلبك قيد المراجعة، وسنتواصل معك عند تفعيل حسابك." });

    expect(await screen.findByRole("heading", { name: "تم استلام طلبك", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("طلبك قيد المراجعة");
    expect(screen.queryByText("رقم التعريف الشخصي (PIN)")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still reports a link that expired before it was ever used as an error, with the way back to signing up", async () => {
    open(410, { error: "SIGNUP_TOKEN_EXPIRED", message: "انتهت صلاحية رابط التفعيل، أنشئ حسابًا جديدًا" });

    expect(await screen.findByRole("alert")).toHaveTextContent("انتهت صلاحية رابط التفعيل، أنشئ حسابًا جديدًا");
    expect(screen.queryByRole("button", { name: "الذهاب لتسجيل الدخول" })).not.toBeInTheDocument();
  });
});
