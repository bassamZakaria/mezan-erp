// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EnvSettingKey, EnvSettingSource, type EnvSettingsDTO } from "@mezan/contracts";
import { PlatformShell } from "./PlatformShell";
import { renderWithPlatformProviders, stubPlatformTransport, testPlatformSession } from "./test-support";

const supportSession = { ...testPlatformSession, user: { ...testPlatformSession.user, role: "support" as const } };

function settings(overrides: Partial<EnvSettingsDTO> = {}): EnvSettingsDTO {
  return {
    settings: Object.values(EnvSettingKey).map((key) =>
      key === EnvSettingKey.SupportEmail
        ? { key, value: "help@env.example", source: EnvSettingSource.EnvFile }
        : key === EnvSettingKey.PublicLanding
          ? { key, value: "1", source: EnvSettingSource.Override }
          : { key, value: null, source: EnvSettingSource.Unset },
    ),
    restartPending: false,
    loadError: null,
    ...overrides,
  };
}

function renderPage(handlers: Parameters<typeof stubPlatformTransport>[0], session = testPlatformSession) {
  renderWithPlatformProviders(<PlatformShell />, { route: "/platform/settings", initialSession: session, transport: stubPlatformTransport(handlers) });
}

async function confirmWithPassword(button: string) {
  const dialog = await screen.findByRole("dialog");
  const confirm = within(dialog).getByRole("button", { name: button });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("كلمة مرورك للتأكيد"), { target: { value: "owner-pass" } });
  fireEvent.click(confirm);
}

describe("SettingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("offers only contact details and the landing switch, and saves them after the owner re-enters their password", async () => {
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
    expect(screen.queryByLabelText(/كلمة مرور البريد|خادم البريد|المفتاح السري/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();

    fireEvent.change(email, { target: { value: "help@console.example" } });
    fireEvent.change(screen.getByLabelText("رقم واتساب (دولي، أرقام فقط)"), { target: { value: "201001234567" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await confirmWithPassword("حفظ الإعدادات");

    await waitFor(() =>
      expect(put).toEqual({ password: "owner-pass", changes: { [EnvSettingKey.SupportEmail]: "help@console.example", [EnvSettingKey.WhatsappNumber]: "201001234567" } }),
    );
    expect(await screen.findByText("إعدادات محفوظة لم تُطبَّق بعد: أعد تشغيل الخادم لتطبيقها.")).toBeInTheDocument();
  });

  it("does not count a field changed back to its saved value", async () => {
    renderPage({ "GET /settings/env": () => ({ body: settings() }) });

    const email = await screen.findByLabelText("بريد الدعم");
    fireEvent.change(email, { target: { value: "other@example.com" } });
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeEnabled();
    fireEvent.change(email, { target: { value: "help@env.example" } });
    expect(screen.getByRole("button", { name: "حفظ الإعدادات" })).toBeDisabled();
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
    await confirmWithPassword("إعادة تشغيل الخادم");

    await waitFor(() => expect(restarted).toEqual({ password: "owner-pass" }));
    expect(await screen.findByText(/يُعاد تشغيل الخادم الآن/)).toBeInTheDocument();
  });

  it("blocks restarting while there are unsaved edits, so nothing typed is silently dropped", async () => {
    renderPage({ "GET /settings/env": () => ({ body: settings({ restartPending: true }) }) });

    const restart = await screen.findByRole("button", { name: "إعادة تشغيل الخادم" });
    expect(restart).toBeEnabled();
    fireEvent.change(screen.getByLabelText("هاتف الدعم"), { target: { value: "0100" } });
    expect(restart).toBeDisabled();
    expect(screen.getByText("احفظ تغييراتك أو ألغِها قبل إعادة التشغيل.")).toBeInTheDocument();
  });

  it("shows the server's refusal and keeps the edit", async () => {
    renderPage({
      "GET /settings/env": () => ({ body: settings() }),
      "PUT /settings/env": () => ({ status: 422, body: { error: "ENV_SETTINGS_INVALID", message: "لم تُحفظ الإعدادات: الخادم لن يعمل بها." } }),
    });

    fireEvent.change(await screen.findByLabelText("هاتف الدعم"), { target: { value: "0100" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ الإعدادات" }));
    await confirmWithPassword("حفظ الإعدادات");

    expect(await screen.findByText("لم تُحفظ الإعدادات: الخادم لن يعمل بها.")).toBeInTheDocument();
    expect(screen.getByLabelText("هاتف الدعم")).toHaveValue("0100");
  });

  it("warns when the saved settings could not be read at start-up", async () => {
    renderPage({ "GET /settings/env": () => ({ body: settings({ loadError: "Unexpected token" }) }) });

    expect(await screen.findByText(/تعذّرت قراءة الإعدادات المحفوظة/)).toBeInTheDocument();
  });

  it("is read-only for support", async () => {
    renderPage({ "GET /settings/env": () => ({ body: settings({ restartPending: true }) }) }, supportSession);

    expect(await screen.findByLabelText("بريد الدعم")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "حفظ الإعدادات" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إعادة تشغيل الخادم" })).not.toBeInTheDocument();
  });
});
