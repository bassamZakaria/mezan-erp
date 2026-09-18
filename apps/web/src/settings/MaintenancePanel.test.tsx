// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MaintenancePanel } from "./MaintenancePanel";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function installBridge(overrides: Record<string, unknown> = {}) {
  const bridge = {
    backup: { create: vi.fn(async () => ({ ok: true })) },
    licence: {
      status: vi.fn(async () => ({ ok: true })),
      checkin: vi.fn(async () => ({
        reachedServer: true,
        revoked: false,
        daysSince: 0,
        messageAr: "تم التحقق من الترخيص بنجاح.",
      })),
    },
    update: vi.fn(async () => ({ phase: "not-available" })),
    onUpdateEvent: vi.fn(() => () => undefined),
    ...overrides,
  };
  (globalThis as { mezan?: unknown }).mezan = bridge;
  return bridge;
}

function render() {
  renderWithProviders(<MaintenancePanel />, { transport: stubTransport({}), initialSession: testAdminSession });
}

afterEach(() => {
  delete (globalThis as { mezan?: unknown }).mezan;
});

describe("MaintenancePanel", () => {
  it("renders nothing on the web edition, where none of these channels exist", () => {
    delete (globalThis as { mezan?: unknown }).mezan;
    render();
    expect(screen.queryByText("الصيانة والتحديثات")).not.toBeInTheDocument();
  });

  it("takes a backup on demand, passing the session token", async () => {
    const bridge = installBridge();
    render();
    await userEvent.click(screen.getByRole("button", { name: "أخذ نسخة الآن" }));
    expect(bridge.backup.create).toHaveBeenCalledWith(testAdminSession.token);
    expect(await screen.findByRole("status")).toHaveTextContent("تم أخذ النسخة الاحتياطية.");
  });

  it("shows the check-in handler's own Arabic verdict rather than re-wording it", async () => {
    const bridge = installBridge();
    render();
    await userEvent.click(screen.getByRole("button", { name: "تحقّق من الترخيص الآن" }));
    expect(bridge.licence.checkin).toHaveBeenCalledWith(testAdminSession.token);
    expect(await screen.findByRole("status")).toHaveTextContent("تم التحقق من الترخيص بنجاح.");
  });

  it("says the machine is up to date, because the banner only renders once there IS an update", async () => {
    installBridge();
    render();
    await userEvent.click(screen.getByRole("button", { name: "ابحث عن تحديثات" }));
    expect(await screen.findByRole("status")).toHaveTextContent("النسخة المثبّتة هي الأحدث.");
  });

  /**
   * GUARDS U-5. On a build with no feed and no vendor key — every install in
   * the field today — the answer used to be «تعذّر البحث عن تحديثات», which
   * sends the owner to support for something that is not broken.
   */
  it("says this build is updated by installing a new version, not that the check failed", async () => {
    installBridge({ update: vi.fn(async () => ({ phase: "unavailable" })) });
    render();
    await userEvent.click(screen.getByRole("button", { name: "ابحث عن تحديثات" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "لا تتوفر تحديثات تلقائية في هذه النسخة",
    );
  });

  /** GUARDS ticket #8 / N-7: an IPC rejection used to leave the button dead. */
  it("reports a rejected update channel instead of doing nothing at all", async () => {
    installBridge({
      update: vi.fn(() => Promise.reject(new Error("No handler registered"))),
    });
    render();
    await userEvent.click(screen.getByRole("button", { name: "ابحث عن تحديثات" }));
    expect(await screen.findByRole("status")).toHaveTextContent("تعذّر البحث عن تحديثات.");
  });
});

/**
 * guards N-7 and ticket #7 — «ضغطت نسخة احتياطية ولم يحدث شيء».
 *
 * On a client machine two of the three channels were never registered, and an
 * unregistered `ipcMain.handle` REJECTS rather than resolving: neither hook
 * caught it, so the operator's whole experience of pressing the button was
 * nothing happening, twice. The backup button refused correctly and then
 * discarded the Arabic reason it had been given.
 */
describe("MaintenancePanel — a refusal is a screen, not silence", () => {
  it("shows the refusal's OWN Arabic reason when the backup is refused", async () => {
    const user = userEvent.setup();
    installBridge({
      backup: {
        create: vi.fn(async () => ({
          ok: false,
          code: "UNAVAILABLE",
          message: "النسخ الاحتياطي يُدار من الجهاز الرئيسي (https://192.168.1.7:4173).",
        })),
      },
    });
    render();

    await user.click(await screen.findByRole("button", { name: "أخذ نسخة الآن" }));

    // The handler knows whether this is a till, an unauthorised caller or a
    // real failure; a generic "it failed" here would throw that away.
    expect(await screen.findByText(/يُدار من الجهاز الرئيسي/)).toBeInTheDocument();
  });

  it("says something when a channel rejects outright, rather than doing nothing", async () => {
    const user = userEvent.setup();
    installBridge({
      licence: {
        status: vi.fn(async () => ({ ok: true })),
        // Exactly what an unregistered ipcMain.handle produces.
        checkin: vi.fn(() =>
          Promise.reject(
            new Error("Error invoking remote method 'mezan:licence:checkin': No handler registered"),
          ),
        ),
      },
    });
    render();

    await user.click(await screen.findByRole("button", { name: "تحقّق من الترخيص الآن" }));

    const notice = await screen.findByRole("status");
    expect(notice).toBeInTheDocument();
    // And never the English rejection text.
    expect(notice.textContent).not.toMatch(/No handler registered/);
  });

  it("names the machine as a till and does not offer it actions it cannot perform", async () => {
    installBridge({
      pairing: vi.fn(async () => ({
        kind: "state",
        role: "client",
        hostUrl: "https://192.168.1.7:4173",
        pinnedFingerprint: "AA:BB",
        deviceLabel: "كاشير ١",
        mayPair: false,
      })),
    });
    render();

    expect(await screen.findByText(/هذا الجهاز محطة متصلة بالجهاز الرئيسي/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "أخذ نسخة الآن" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "تحقّق من الترخيص الآن" })).toBeDisabled();
  });
});
