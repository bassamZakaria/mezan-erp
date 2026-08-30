// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectedDevicesPanel, LicenceStatusNotice } from "./ConnectedDevicesPanel";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { DesktopLicenceResultDTO } from "../data/hooks";

/**
 * The desktop bridge, which is the only source of the licence diagnosis and
 * the LAN address — neither is reachable over the API. Installing it here is
 * how a test says "this is running on the host machine".
 */
type BridgeHost = { mezan?: { licence?: { status(token: string): Promise<DesktopLicenceResultDTO> } } };

function withDesktopBridge(result: DesktopLicenceResultDTO): void {
  (globalThis as BridgeHost).mezan = { licence: { status: () => Promise.resolve(result) } };
}

/** A real 32-byte SHA-256, in the `AB:CD:…` spelling a TLS client computes. */
const FINGERPRINT =
  "3D:9A:1F:04:B7:22:CE:65:80:11:AA:5E:F3:47:9C:D2:16:8B:70:E4:53:C1:0F:6A:29:BD:84:37:52:EE:C8:91";

const LICENSED: DesktopLicenceResultDTO = {
  ok: true,
  code: "LIC-OK",
  messageAr: "الترخيص سارٍ.",
  plan: "ENTERPRISE",
  seats: 2,
  expiresAt: null,
  lan: {
    listening: true,
    url: "https://192.168.1.7:4173",
    fingerprintSha256: FINGERPRINT,
  },
};

const LICENSED_STATUS = { licensed: true, seats: 2, connected: 0 };
const NO_SESSIONS = { seats: 2, connected: 0, sessions: [] };

describe("ConnectedDevicesPanel", () => {
  afterEach(() => {
    delete (globalThis as BridgeHost).mezan;
  });

  it("shows an unlicensed message and no table when LAN mode is not licensed", async () => {
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: { licensed: false, seats: 0, connected: 0 } }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText(/غير مفعّل/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("lists connected devices with seat usage when licensed", async () => {
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: { licensed: true, seats: 2, connected: 2 } }),
      "GET /lan/sessions": () => ({
        body: {
          seats: 2,
          connected: 2,
          sessions: [
            { sessionId: "s1", userId: "USER-ADMIN", deviceId: "till-1", deviceLabel: "Front till", connectedAt: 1000, lastSeenAt: 2000 },
            { sessionId: "s2", userId: "USER-ADMIN", deviceId: "till-2", deviceLabel: "Back office", connectedAt: 1500, lastSeenAt: 2500 },
          ],
        },
      }),
    });

    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("Front till")).toBeInTheDocument();
    expect(screen.getByText("Back office")).toBeInTheDocument();
    expect(screen.getByText("اكتمل عدد المقاعد")).toBeInTheDocument();
  });

  it("disconnects only the clicked row and refreshes, without disabling the other row", async () => {
    const user = userEvent.setup();
    let connected = 2;
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: { licensed: true, seats: 2, connected } }),
      "GET /lan/sessions": () => ({
        body: {
          seats: 2,
          connected,
          sessions:
            connected === 2
              ? [
                  { sessionId: "s1", userId: "USER-ADMIN", deviceId: "till-1", deviceLabel: "Front till", connectedAt: 1000, lastSeenAt: 2000 },
                  { sessionId: "s2", userId: "USER-ADMIN", deviceId: "till-2", deviceLabel: "Back office", connectedAt: 1500, lastSeenAt: 2500 },
                ]
              : [{ sessionId: "s2", userId: "USER-ADMIN", deviceId: "till-2", deviceLabel: "Back office", connectedAt: 1500, lastSeenAt: 2500 }],
        },
      }),
      "DELETE /lan/sessions/s1": () => {
        connected -= 1;
        return { status: 204, body: null };
      },
    });

    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    const frontRow = (await screen.findByText("Front till")).closest("tr")!;
    const backRow = screen.getByText("Back office").closest("tr")!;

    await user.click(within(frontRow).getByRole("button", { name: "فصل" }));

    // The row being disconnected shows pending state; the OTHER row's button
    // must stay enabled (per-item pending, not a mutation-wide disable).
    expect(within(backRow).getByRole("button", { name: "فصل" })).not.toBeDisabled();

    await waitFor(() => expect(screen.queryByText("Front till")).not.toBeInTheDocument());
    expect(screen.getByText("Back office")).toBeInTheDocument();
  });

  it("reports a failure as a failure — not as 'not licensed', and not as an empty list", async () => {
    // Found by opening the screen. With no `/lan` routes mounted the status
    // call fails, and the panel used to parse the ERROR BODY as a status DTO,
    // read `licensed` as undefined, and render the unlicensed card — telling a
    // licensed shop its licence was missing. After that was fixed it still
    // printed "Loading…" under the error forever and rendered an empty table
    // whose "no devices are connected" line states a fact it does not have,
    // which is the same mistake one step quieter.
    const transport = stubTransport({
      "GET /lan/status": () => ({ status: 404, body: { error: "NOT_FOUND" } }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/غير مفعّل/)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("جارٍ التحميل…")).not.toBeInTheDocument();
    expect(screen.getByText("تعذّر قراءة عدد المقاعد.")).toBeInTheDocument();
  });
});

/**
 * FINDING #11 — the LAN address existed only in a console the shop never
 * opens, so a consultant provisioning a till had to find the host's IP by
 * hand. Every branch here is about saying only what the screen was told.
 */
describe("ConnectedDevicesPanel — the LAN address", () => {
  afterEach(() => {
    delete (globalThis as BridgeHost).mezan;
  });

  it("shows the address a till is pointed at, in Latin digits and selectable", async () => {
    withDesktopBridge(LICENSED);
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    const address = await screen.findByText("https://192.168.1.7:4173");
    expect(address).toBeInTheDocument();
    expect(address).toHaveAttribute("dir", "ltr");
  });

  it("says the address is only knowable on the host, rather than guessing one, on the web build", async () => {
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText(/لا يُعرف هذا العنوان إلا على الجهاز المستضيف/)).toBeInTheDocument();
    expect(screen.queryByText(/https?:\/\//)).not.toBeInTheDocument();
  });

  it("says the address is unknown when the host has none to give — never a plausible one", async () => {
    withDesktopBridge({
      ...LICENSED,
      lan: { listening: true, url: null, fingerprintSha256: FINGERPRINT },
    });
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText(/تعذّر تحديد عنوان هذا الجهاز/)).toBeInTheDocument();
    expect(screen.queryByText(/https?:\/\//)).not.toBeInTheDocument();
  });

  it("says the LAN service is not running rather than printing an address for a dead socket", async () => {
    withDesktopBridge({
      ...LICENSED,
      lan: { listening: false, url: null, fingerprintSha256: FINGERPRINT },
    });
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText(/خدمة الشبكة المحلية غير مشغّلة/)).toBeInTheDocument();
  });

  it("renders a refused licence read as an error, not as an address", async () => {
    withDesktopBridge({ ok: false, code: "UNAUTHORIZED", message: "سجّل الدخول لعرض حالة الترخيص." });
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText("سجّل الدخول لعرض حالة الترخيص.")).toBeInTheDocument();
    expect(screen.queryByText(/https?:\/\//)).not.toBeInTheDocument();
  });
});

/**
 * THE FINGERPRINT A TILL PINS.
 *
 * The LAN socket now serves TLS, but with a self-signed certificate that no
 * chain validates — there is no CA a shop LAN can reach. Encryption alone
 * therefore still lets a laptop that answers first on the host's address
 * present its own key and collect the PIN. What closes that is the till
 * pinning this exact SHA-256, and the ONLY place a human can read it is the
 * host's own screen.
 */
describe("ConnectedDevicesPanel — the certificate fingerprint", () => {
  afterEach(() => {
    delete (globalThis as BridgeHost).mezan;
  });

  it("shows the fingerprint, in LTR hex pairs a human can compare against the till", async () => {
    withDesktopBridge(LICENSED);
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    const shown = await screen.findByText(FINGERPRINT);
    // Hex inside an RTL page reorders without this, and the consultant would
    // then be comparing two strings that differ only in how they were laid out.
    expect(shown).toHaveAttribute("dir", "ltr");
    expect(screen.getByText(/بصمة شهادة التأمين/)).toBeInTheDocument();
  });

  it("names it even while the address is unknown — it is the identity, not the address", async () => {
    withDesktopBridge({
      ...LICENSED,
      lan: { listening: false, url: null, fingerprintSha256: FINGERPRINT },
    });
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText(FINGERPRINT)).toBeInTheDocument();
  });

  it("says the fingerprint is unknown rather than printing a placeholder", async () => {
    withDesktopBridge({
      ...LICENSED,
      lan: { listening: true, url: "https://192.168.1.7:4173", fingerprintSha256: null },
    });
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    // A fingerprint that matches nothing on the wire would teach the shop to
    // click past the one warning that protects it.
    expect(await screen.findByText(/تعذّرت قراءة بصمة الشهادة/)).toBeInTheDocument();
    expect(screen.queryByText(/^([0-9A-F]{2}:){4}/)).not.toBeInTheDocument();
  });

  it("says it is only knowable on the host, on the web build", async () => {
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    expect(await screen.findByText(/لا تُعرف بصمة الشهادة إلا على الجهاز المستضيف/)).toBeInTheDocument();
    expect(screen.queryByText(/^([0-9A-F]{2}:){4}/)).not.toBeInTheDocument();
  });

  it("shows no fingerprint block at all when the licence read failed", async () => {
    withDesktopBridge({ ok: false, code: "UNAUTHORIZED", message: "سجّل الدخول لعرض حالة الترخيص." });
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(<ConnectedDevicesPanel />, { transport, initialSession: testAdminSession });

    await screen.findByText("سجّل الدخول لعرض حالة الترخيص.");
    // One failure, one message: a second "could not read the fingerprint"
    // underneath would read as a separate fault the operator has to diagnose.
    expect(screen.queryByText(/بصمة شهادة التأمين/)).not.toBeInTheDocument();
    expect(screen.queryByText(/تعذّرت قراءة بصمة الشهادة/)).not.toBeInTheDocument();
  });
});

/**
 * FINDING #8 — a missing, malformed, invalid or expired licence produced a
 * `console.warn` and an app that quietly did less. There was no message, no
 * date, and no code to read down the phone to support.
 */
describe("LicenceStatusNotice", () => {
  afterEach(() => {
    delete (globalThis as BridgeHost).mezan;
  });

  it("says nothing on the browser build, which holds no licence file", async () => {
    renderWithProviders(<LicenceStatusNotice />, {
      transport: stubTransport({}),
      initialSession: testAdminSession,
    });
    await waitFor(() => expect(screen.queryByText("مشكلة في الترخيص")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says nothing when the licence is current — a healthy install gets no banner", async () => {
    withDesktopBridge(LICENSED);
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: LICENSED_STATUS }),
      "GET /lan/sessions": () => ({ body: NO_SESSIONS }),
    });
    renderWithProviders(
      <>
        <LicenceStatusNotice />
        <ConnectedDevicesPanel />
      </>,
      { transport, initialSession: testAdminSession },
    );

    // The address proves the bridge answered, so the absent banner below is a
    // decision the component made rather than a reading that never arrived.
    await screen.findByText("https://192.168.1.7:4173");
    expect(screen.queryByText("مشكلة في الترخيص")).not.toBeInTheDocument();
    expect(screen.queryByText("LIC-OK")).not.toBeInTheDocument();
  });

  it("names an expired licence in Arabic, with its date and the LIC-EXPIRED support code", async () => {
    withDesktopBridge({
      ok: true,
      code: "LIC-EXPIRED",
      messageAr: "انتهت صلاحية الترخيص. جدّد الاشتراك لدى الدعم.",
      plan: "ENTERPRISE",
      seats: 2,
      expiresAt: "2026-01-31T00:00:00.000Z",
      lan: { listening: false, url: null, fingerprintSha256: null },
    });
    renderWithProviders(<LicenceStatusNotice />, {
      transport: stubTransport({}),
      initialSession: testAdminSession,
    });

    expect(await screen.findByText("انتهت صلاحية الترخيص. جدّد الاشتراك لدى الدعم.")).toBeInTheDocument();
    expect(screen.getByText("LIC-EXPIRED")).toBeInTheDocument();
    expect(screen.getByText("31/01/2026")).toBeInTheDocument();
  });

  it("names a missing licence with the LIC-MISSING code, and no expiry it does not have", async () => {
    withDesktopBridge({
      ok: true,
      code: "LIC-MISSING",
      messageAr: "لا يوجد ترخيص على هذا الجهاز.",
      plan: "UNLICENSED",
      seats: 0,
      expiresAt: null,
      lan: { listening: false, url: null, fingerprintSha256: null },
    });
    renderWithProviders(<LicenceStatusNotice />, {
      transport: stubTransport({}),
      initialSession: testAdminSession,
    });

    expect(await screen.findByText("لا يوجد ترخيص على هذا الجهاز.")).toBeInTheDocument();
    expect(screen.getByText("LIC-MISSING")).toBeInTheDocument();
    expect(screen.queryByText(/تاريخ انتهاء الصلاحية/)).not.toBeInTheDocument();
  });
});
