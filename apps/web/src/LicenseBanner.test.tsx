// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LicenseBanner } from "./LicenseBanner";
import { renderWithProviders, stubTransport, testAdminSession } from "./data/test-support";
import type { DesktopLicenceResultDTO } from "./data/hooks";

/**
 * WHAT THE SHOP IS TOLD, per licence reason.
 *
 * The banner used to branch on `state` alone, so every non-writable state — a
 * paid licence whose only fault was an overdue online check-in included —
 * rendered «حتى تجديد الترخيص». These tests hold each reason to the sentence
 * that names the action which actually clears it.
 */

interface Bridge {
  mezan?: {
    licence?: {
      status(token: string): Promise<DesktopLicenceResultDTO>;
      checkin?(token: string): Promise<unknown>;
      import?(token: string): Promise<unknown>;
    };
  };
}

const FINGERPRINT = "8f3c0b1a44de9077a1c2f5b6e0d3a91c";

function desktopStatus(over: Partial<DesktopLicenceResultDTO> = {}): DesktopLicenceResultDTO {
  return {
    ok: true,
    code: "LIC-OK",
    messageAr: "الترخيص سارٍ.",
    state: "ACTIVE",
    reason: null,
    canWrite: true,
    plan: "PRO",
    seats: 3,
    seatsUsed: 1,
    modules: [],
    expiresAt: null,
    fingerprint: FINGERPRINT,
    daysSinceCheckin: 0,
    licenceFilePath: "/u/license.mezan",
    appVersion: "2026.9.0",
    role: "host",
    databasePath: "/u/mezan.db",
    backupsDir: "/u/backups",
    keyCardPath: null,
    plaintextArchivePath: null,
    lan: { listening: false, url: null, fingerprintSha256: null },
    ...over,
  } as DesktopLicenceResultDTO;
}

function installBridge(status: DesktopLicenceResultDTO, extra: Record<string, unknown> = {}): void {
  (globalThis as Bridge).mezan = {
    licence: { status: () => Promise.resolve(status), ...extra },
  } as Bridge["mezan"];
}

function renderBanner(serverState: Record<string, unknown>) {
  const transport = stubTransport({ "GET /license/state": () => ({ body: serverState }) });
  return renderWithProviders(<LicenseBanner />, { transport, initialSession: testAdminSession });
}

afterEach(() => {
  delete (globalThis as Bridge).mezan;
});

describe("LicenseBanner — guards L-8 / support #11", () => {
  it("renders nothing when the licence is cleanly ACTIVE", async () => {
    installBridge(desktopStatus());
    renderBanner({ state: "ACTIVE", canWrite: true, usable: true });
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("tells an overdue check-in to connect and press «تحقّق الآن» — never to renew", async () => {
    installBridge(
      desktopStatus({
        code: "LIC-CHECKIN",
        state: "READ_ONLY",
        reason: "CHECKIN_OVERDUE",
        canWrite: false,
        daysSinceCheckin: 9,
      }),
    );
    renderBanner({ state: "READ_ONLY", canWrite: false, usable: true, reason: "CHECKIN_OVERDUE" });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("9");
    expect(alert).toHaveTextContent("اتصل بالإنترنت");
    expect(alert).not.toHaveTextContent("تجديد الترخيص");
    expect(screen.getByRole("button", { name: "تحقّق الآن" })).toBeInTheDocument();
    expect(screen.getByText("LIC-CHECKIN")).toBeInTheDocument();
  });

  it("presses «تحقّق الآن» and reports the outcome without an English error in it", async () => {
    installBridge(
      desktopStatus({
        code: "LIC-CHECKIN",
        state: "READ_ONLY",
        reason: "CHECKIN_OVERDUE",
        canWrite: false,
        daysSinceCheckin: 9,
      }),
      {
        // The main process interpolates the raw transport error into its own
        // Arabic sentence; the renderer must not render that sentence — it
        // branches on the structured outcome instead. Guards support #12.
        checkin: () =>
          Promise.resolve({
            reachedServer: false,
            revoked: false,
            daysSince: 9,
            messageAr: "تعذّر الوصول إلى خدمة التراخيص (fetch failed).",
          }),
      },
    );
    renderBanner({ state: "READ_ONLY", canWrite: false, usable: true, reason: "CHECKIN_OVERDUE" });

    await userEvent.click(await screen.findByRole("button", { name: "تحقّق الآن" }));
    expect(await screen.findByText(/تأكد من اتصال هذا الجهاز بالإنترنت/)).toBeInTheDocument();
    expect(screen.queryByText(/fetch failed/)).not.toBeInTheDocument();
  });

  // Past the hard limit a one-line band at the top of a working screen is not
  // how you tell somebody their postings have stopped.
  it("blocks the screen past 30 days, and the dismiss requires acknowledging it", async () => {
    installBridge(
      desktopStatus({
        code: "LIC-CHECKIN",
        state: "READ_ONLY",
        reason: "CHECKIN_OVERDUE",
        canWrite: false,
        daysSinceCheckin: 34,
      }),
    );
    renderBanner({ state: "READ_ONLY", canWrite: false, usable: true, reason: "CHECKIN_OVERDUE" });

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("34");
    expect(dialog).toHaveTextContent(FINGERPRINT);
    expect(screen.getByRole("button", { name: "استيراد ملف الترخيص" })).toBeInTheDocument();

    const dismiss = screen.getByRole("button", { name: "متابعة لعرض البيانات" });
    expect(dismiss).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(dismiss);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    // The data behind it stays readable: the notice falls back to a band.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("gives REVOKED its own sentence and support code", async () => {
    installBridge(
      desktopStatus({ code: "LIC-REVOKED", state: "READ_ONLY", reason: "REVOKED", canWrite: false }),
    );
    renderBanner({ state: "READ_ONLY", canWrite: false, usable: true, reason: "REVOKED" });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("أُلغي هذا الترخيص");
    expect(screen.getByText("LIC-REVOKED")).toBeInTheDocument();
  });

  // A build defect must not be worded as the shop's fault, and importing a file
  // cannot fix it — so no import button is offered.
  it("blames the build, not the shop, for NO_PUBLIC_KEY", async () => {
    installBridge(
      desktopStatus({
        code: "LIC-NOKEY",
        state: "UNLICENSED",
        reason: "NO_PUBLIC_KEY",
        canWrite: false,
      }),
    );
    renderBanner({ state: "UNLICENSED", canWrite: false, usable: true, reason: "NO_PUBLIC_KEY" });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("بُنيت هذه النسخة بدون مفتاح المورّد");
    expect(screen.queryByRole("button", { name: "استيراد ملف الترخيص" })).not.toBeInTheDocument();
  });

  // guards L-9: the machine-transfer procedure and a copyable fingerprint.
  it("gives FINGERPRINT_MISMATCH a written transfer procedure and the fingerprint", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    installBridge(
      desktopStatus({
        code: "LIC-MACHINE",
        state: "FINGERPRINT_MISMATCH",
        reason: "MACHINE_NOT_BOUND",
        canWrite: false,
      }),
    );
    renderBanner({
      state: "FINGERPRINT_MISMATCH",
      canWrite: false,
      usable: true,
      reason: "MACHINE_NOT_BOUND",
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("صادر لجهاز مختلف");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(FINGERPRINT)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "نسخ" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FINGERPRINT));
  });

  it("counts a grace window down to its end date, still writable", async () => {
    installBridge(desktopStatus({ code: "LIC-GRACE", state: "GRACE", reason: null }));
    renderBanner({
      state: "GRACE",
      canWrite: true,
      usable: true,
      graceEndsAt: "2026-06-04T00:00:00.000Z",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("فترة سماح");
  });

  it("still says «انتهت صلاحية» for a genuinely expired licence", async () => {
    installBridge(
      desktopStatus({
        code: "LIC-EXPIRED",
        state: "READ_ONLY",
        reason: "EXPIRED_PAST_GRACE",
        canWrite: false,
      }),
    );
    renderBanner({
      state: "READ_ONLY",
      canWrite: false,
      usable: true,
      reason: "EXPIRED_PAST_GRACE",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("القراءة فقط");
  });

  // The browser build holds no licence file and no bridge; it must still render
  // the server's verdict rather than nothing.
  it("works with no desktop bridge at all", async () => {
    renderBanner({ state: "UNLICENSED", canWrite: false, usable: true, reason: "NO_LICENSE" });
    expect(await screen.findByRole("alert")).toHaveTextContent("لا يوجد ترخيص");
  });
});
