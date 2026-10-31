// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { ResetPasswordScreen } from "./ResetPasswordScreen";
import { clearTenantCode, loadTenantCode, persistTenantCode } from "../data/session";
import { renderWithProviders, stubTransport } from "../data/test-support";

const TOKEN = "r".repeat(43);

interface Sent {
  readonly body: unknown;
  readonly tenant: string | null;
}

function mount(route: string, answer: () => { status?: number; body: unknown }) {
  const sent: Sent[] = [];
  const transport = stubTransport({
    "POST /auth/reset-password": (init) => {
      sent.push({ body: JSON.parse(String(init?.body)), tenant: new Headers(init?.headers).get("x-mezan-tenant") });
      return answer();
    },
  });
  renderWithProviders(
    <Routes>
      <Route path="/reset-password" element={<ResetPasswordScreen />} />
    </Routes>,
    { transport, route },
  );
  return sent;
}

function choose(password: string, confirm = password) {
  fireEvent.change(screen.getByLabelText("كلمة المرور الجديدة"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("تأكيد كلمة المرور الجديدة"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "حفظ كلمة المرور" }));
}

afterEach(() => {
  clearTenantCode();
  vi.restoreAllMocks();
});

describe("the page a mailed password-reset link opens", () => {
  it("sets the new password under the link's company, and never saves that company for later sign-ins", async () => {
    let tenantWhenSent: string | null = "unset";
    const sent: Sent[] = [];
    const transport = stubTransport({
      "POST /auth/reset-password": (init) => {
        tenantWhenSent = loadTenantCode();
        sent.push({ body: JSON.parse(String(init?.body)), tenant: new Headers(init?.headers).get("x-mezan-tenant") });
        return { body: { ok: true } };
      },
    });
    renderWithProviders(
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordScreen />} />
      </Routes>,
      { transport, route: `/reset-password#tenant=acme&token=${TOKEN}` },
    );

    choose("Cyag@2026");

    expect(await screen.findByRole("status")).toHaveTextContent("تم تعيين كلمة المرور الجديدة. سجّل الدخول بها الآن.");
    expect(sent).toEqual([{ body: { token: TOKEN, password: "Cyag@2026" }, tenant: "acme" }]);
    expect(tenantWhenSent).toBeNull();
    expect(loadTenantCode()).toBeNull();
  });

  it("sends the link's own company even when another company is left in storage", async () => {
    persistTenantCode("rival");
    const sent = mount(`/reset-password#tenant=acme&token=${TOKEN}`, () => ({ body: { ok: true } }));
    choose("Cyag@2026");
    await screen.findByRole("status");
    expect(sent[0]?.tenant).toBe("acme");
    expect(loadTenantCode()).toBe("rival");
  });

  it("shows the server's Arabic refusal for a used or expired link", async () => {
    mount(`/reset-password#tenant=acme&token=${TOKEN}`, () => ({ status: 400, body: { error: "INVALID_RESET_LINK", message: "رابط تعيين كلمة المرور غير صالح أو انتهت صلاحيته." } }));
    choose("Cyag@2026");
    expect(await screen.findByRole("alert")).toHaveTextContent("رابط تعيين كلمة المرور غير صالح أو انتهت صلاحيته.");
    expect(loadTenantCode()).toBeNull();
  });

  it("refuses a short password and a mismatched confirmation without calling the server", () => {
    const sent = mount(`/reset-password#token=${TOKEN}`, () => ({ body: { ok: true } }));
    choose("short1");
    expect(screen.getByRole("alert")).toHaveTextContent("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
    choose("Cyag@2026", "Cyag@2027");
    expect(screen.getByRole("alert")).toHaveTextContent("كلمة المرور الجديدة وتأكيدها غير متطابقين.");
    expect(sent).toEqual([]);
  });

  it("takes the token out of the address bar as soon as it has read it", async () => {
    const replaced = vi.spyOn(window.history, "replaceState");
    mount(`/reset-password#token=${TOKEN}`, () => ({ body: { ok: true } }));
    await vi.waitFor(() => expect(replaced).toHaveBeenCalled());
    expect(String(replaced.mock.calls.at(-1)?.[2])).toBe("/reset-password");
  });

  it("says the link is incomplete when it carries no token, and offers no form", () => {
    mount("/reset-password", () => ({ body: { ok: true } }));
    expect(screen.getByRole("alert")).toHaveTextContent("رابط تعيين كلمة المرور غير مكتمل.");
    expect(screen.queryByRole("button", { name: "حفظ كلمة المرور" })).not.toBeInTheDocument();
  });
});
