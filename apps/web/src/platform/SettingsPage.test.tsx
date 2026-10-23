// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EnvReadOnlyKey, EnvSettingKey, EnvSettingSource, type EnvSettingsDTO } from "@mezan/contracts";
import { PlatformShell } from "./PlatformShell";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";

const supportSession = { ...testPlatformSession, user: { ...testPlatformSession.user, role: "support" as const } };

function settings(overrides: Partial<EnvSettingsDTO> = {}): EnvSettingsDTO {
  return {
    settings: Object.values(EnvSettingKey).map((key) => ({ key, value: null, hasValue: false, source: EnvSettingSource.Unset })).map((s) =>
      s.key === EnvSettingKey.SupportEmail
        ? { ...s, value: "help@env.example", hasValue: true, source: EnvSettingSource.EnvFile }
        : s.key === EnvSettingKey.SmtpPassword
          ? { ...s, hasValue: true, source: EnvSettingSource.Override }
          : s,
    ),
    readOnly: [{ key: EnvReadOnlyKey.SecretsKey, hasValue: true }],
    restartPending: false,
    ...overrides,
  };
}

function renderPage(handlers: Parameters<typeof stubPlatformTransport>[0], session = testPlatformSession) {
  renderWithPlatformProviders(<PlatformShell />, { route: "/platform/settings", initialSession: session, transport: stubPlatformTransport(handlers) });
}

describe("SettingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("saves edited settings only after the owner re-enters their password, and never shows a secret's value", async () => {
    let put: unknown = null;
    renderPage({
      "GET /settings/env": () => ({ body: settings() }),
      "PUT /settings/env": (init) => {
        put = JSON.parse(String(init?.body));
        return { body: settings({ restartPending: true }) };
      },
    });

    const email = await screen.findByLabelText("بريد الدعم");
    expect(email).toHaveValue("help@env.example");
    expect(screen.getByLabelText("كلمة مرور البريد")).toHaveValue("");
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();

    fireEvent.change(email, { target: { value: "help@console.example" } });
    fireEvent.change(screen.getByLabelText("رقم واتساب (دولي، أرقام فقط)"), { target: { value: "201001234567" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "حفظ الإعدادات" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("كلمة مرورك للتأكيد"), { target: { value: "owner-pass" } });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(put).toEqual({ password: "owner-pass", changes: { [EnvSettingKey.SupportEmail]: "help@console.example", [EnvSettingKey.WhatsappNumber]: "201001234567" } }),
    );
    expect(await screen.findByText("إعدادات محفوظة لم تُطبَّق بعد: أعد تشغيل الخادم لتطبيقها.")).toBeInTheDocument();
  });

  it("restarts the server from the pending banner after the password is confirmed", async () => {
    let restarted: unknown = null;
    renderPage({
      "GET /settings/env": () => ({ body: settings({ restartPending: true }) }),
      "POST /settings/restart": (init) => {
        restarted = JSON.parse(String(init?.body));
        return { status: 202, body: { restarting: true } };
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: "إعادة تشغيل الخادم" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("كلمة مرورك للتأكيد"), { target: { value: "owner-pass" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "إعادة تشغيل الخادم" }));

    await waitFor(() => expect(restarted).toEqual({ password: "owner-pass" }));
    expect(await screen.findByText(/يُعاد تشغيل الخادم الآن/)).toBeInTheDocument();
  });

  it("shows the server's refusal and keeps the edit", async () => {
    renderPage({
      "GET /settings/env": () => ({ body: settings() }),
      "PUT /settings/env": () => ({ status: 422, body: { error: "ENV_SETTINGS_INVALID", message: "لم تُحفظ الإعدادات: الخادم لن يعمل بها." } }),
    });

    fireEvent.change(await screen.findByLabelText("خادم البريد"), { target: { value: "smtp.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("كلمة مرورك للتأكيد"), { target: { value: "owner-pass" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ الإعدادات" }));

    expect(await screen.findByText("لم تُحفظ الإعدادات: الخادم لن يعمل بها.")).toBeInTheDocument();
    expect(screen.getByLabelText("خادم البريد")).toHaveValue("smtp.example.com");
  });

  it("is read-only for support", async () => {
    renderPage({ "GET /settings/env": () => ({ body: settings({ restartPending: true }) }) }, supportSession);

    expect(await screen.findByLabelText("بريد الدعم")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "حفظ الإعدادات" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إعادة تشغيل الخادم" })).not.toBeInTheDocument();
  });
});
