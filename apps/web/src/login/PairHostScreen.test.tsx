// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PairHostScreen } from "./PairHostScreen";
import { renderWithProviders } from "../data/test-support";
import type { PairingRequestMessage, PairingResponse } from "../lan/pairing-bridge";

/**
 * guards N-1 and N-4.
 *
 * Pairing a till was a command-line flag, so a shop could never add its own
 * fourth till; and a certificate mismatch — the state that means either "the
 * host was reinstalled" or "somebody else is answering on that address" — had
 * two 64-hex strings inside an English sentence and no button anywhere.
 *
 * The assertion that matters most is the third one: the confirmation is a
 * SEPARATE, DELIBERATE press. The comparison a human makes between the value
 * on this screen and the value on the host's own screen is the entire defence
 * against a laptop answering first on `192.168.1.7:4173`, so a flow that paired
 * as soon as it had read a fingerprint would have no defence at all.
 */
const FINGERPRINT =
  "3D:9A:1F:04:B7:22:CE:65:80:11:AA:5E:F3:47:9C:D2:16:8B:70:E4:53:C1:0F:6A:29:BD:84:37:52:EE:C8:91";
const OTHER =
  "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";

type BridgeHost = { mezan?: { pairing?: (m: PairingRequestMessage) => Promise<PairingResponse> } };

function installBridge(handler: (m: PairingRequestMessage) => PairingResponse) {
  const calls: PairingRequestMessage[] = [];
  (globalThis as BridgeHost).mezan = {
    pairing: (message) => {
      calls.push(message);
      return Promise.resolve(handler(message));
    },
  };
  return calls;
}

afterEach(() => {
  delete (globalThis as BridgeHost).mezan;
  vi.restoreAllMocks();
});

describe("PairHostScreen — pairing a till without a command line", () => {
  it("lists what the network advertised and pairs only after an explicit compare-and-confirm", async () => {
    const user = userEvent.setup();
    const calls = installBridge((message) => {
      switch (message.kind) {
        case "state":
          return {
            kind: "state",
            role: "host",
            hostUrl: null,
            pinnedFingerprint: null,
            deviceLabel: "SHOP-PC-2",
            mayPair: true,
          };
        case "discover":
          return {
            kind: "discover",
            discoveryAvailable: true,
            hosts: [
              { name: "Mezan — SHOP-PC", hostUrl: "https://192.168.1.7:4173", advertisedFingerprint: FINGERPRINT },
            ],
          };
        case "probe":
          return {
            kind: "probe",
            ok: true,
            hostUrl: "https://192.168.1.7:4173",
            presentedFingerprint: FINGERPRINT,
            subject: "Mezan LAN host",
          };
        case "confirm":
          return {
            kind: "confirm",
            ok: true,
            hostUrl: "https://192.168.1.7:4173",
            fingerprintSha256: FINGERPRINT,
            deviceLabel: "SHOP-PC-2",
          };
        default:
          return { kind: "relocate", ok: false, message: "unused" };
      }
    });

    renderWithProviders(<PairHostScreen />, { route: "/pair-host" });

    const discovered = await screen.findByText("Mezan — SHOP-PC");
    await user.click(discovered);

    // The fingerprint is on screen, and NOTHING has been written yet.
    expect(await screen.findByText(/قارن بصمة الشهادة/)).toBeInTheDocument();
    expect(calls.some((c) => c.kind === "confirm")).toBe(false);

    await user.click(screen.getByRole("button", { name: /الشهادتان متطابقتان/ }));

    await waitFor(() => expect(calls.some((c) => c.kind === "confirm")).toBe(true));
    const confirmed = calls.find((c) => c.kind === "confirm");
    expect(confirmed).toMatchObject({ hostUrl: "https://192.168.1.7:4173", fingerprintSha256: FINGERPRINT });
  });

  it("lets an operator type an address when nothing was discovered — mDNS is blocked on plenty of shop networks", async () => {
    const user = userEvent.setup();
    const calls = installBridge((message) => {
      if (message.kind === "state") {
        return { kind: "state", role: "host", hostUrl: null, pinnedFingerprint: null, deviceLabel: "PC", mayPair: true };
      }
      if (message.kind === "discover") return { kind: "discover", discoveryAvailable: false, hosts: [] };
      return {
        kind: "probe",
        ok: true,
        hostUrl: "https://10.0.0.4:4173",
        presentedFingerprint: FINGERPRINT,
        subject: "Mezan LAN host",
      };
    });

    renderWithProviders(<PairHostScreen />, { route: "/pair-host" });

    // An empty list must not read as "there is no host here".
    expect(await screen.findByText(/لم يُعثر على أي جهاز رئيسي تلقائياً/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/اكتب عنوان الجهاز الرئيسي/), "https://10.0.0.4:4173");
    await user.click(screen.getByRole("button", { name: "اتصل" }));

    await waitFor(() =>
      expect(calls).toContainEqual({ kind: "probe", hostUrl: "https://10.0.0.4:4173" }),
    );
    expect(await screen.findByText(/قارن بصمة الشهادة/)).toBeInTheDocument();
  });

  /**
   * guards N-6: a refusal and a timeout have DIFFERENT fixes, and reporting
   * both as "unreachable" is what made a firewall undiagnosable from either
   * side. The message the main process produced must survive to the screen.
   */
  it("shows the probe's own reason rather than a generic failure", async () => {
    const user = userEvent.setup();
    installBridge((message) => {
      if (message.kind === "state") {
        return { kind: "state", role: "host", hostUrl: null, pinnedFingerprint: null, deviceLabel: "PC", mayPair: true };
      }
      if (message.kind === "discover") return { kind: "discover", discoveryAvailable: false, hosts: [] };
      return {
        kind: "probe",
        ok: false,
        hostUrl: "https://10.0.0.4:4173",
        code: "TIMEOUT",
        message: "لا يوجد رد من هذا العنوان. غالباً جدار الحماية يحجب الاتصال.",
      };
    });

    renderWithProviders(<PairHostScreen />, { route: "/pair-host" });
    await user.type(await screen.findByLabelText(/اكتب عنوان الجهاز الرئيسي/), "https://10.0.0.4:4173");
    await user.click(screen.getByRole("button", { name: "اتصل" }));

    expect(await screen.findByText(/جدار الحماية يحجب الاتصال/)).toBeInTheDocument();
  });
});

describe("PairHostScreen — the certificate does not match", () => {
  it("names it, says nothing was sent, shows both fingerprints and offers a re-pair", async () => {
    const user = userEvent.setup();
    installBridge((message) => {
      if (message.kind === "state") {
        return {
          kind: "state",
          role: "client",
          hostUrl: "https://192.168.1.7:4173",
          pinnedFingerprint: FINGERPRINT,
          deviceLabel: "كاشير ١",
          mayPair: false,
        };
      }
      if (message.kind === "discover") return { kind: "discover", discoveryAvailable: false, hosts: [] };
      return { kind: "relocate", ok: false, message: "unused" };
    });

    renderWithProviders(<PairHostScreen />, {
      route: `/pair-host?fault=PIN_MISMATCH&host=${encodeURIComponent("https://192.168.1.7:4173")}&presented=${encodeURIComponent(OTHER)}`,
    });

    expect(await screen.findByText(/هذا ليس الجهاز الرئيسي المسجَّل/)).toBeInTheDocument();
    // The one fact that turns a scary screen into an actionable one.
    expect(screen.getByText(/لم يُرسَل أي شيء إليه/)).toBeInTheDocument();
    // Both values, so the human comparison the flow depends on is performable.
    await waitFor(() => expect(screen.getByText(/3D:9A:1F:04/)).toBeInTheDocument());
    expect(screen.getByText(/AA:BB:CC:DD/)).toBeInTheDocument();
    // And a stop warning, not a "trust it anyway" button.
    expect(screen.getByText(/قد يكون جهاز آخر ينتحل شخصيته/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "إعادة الاقتران" }));
    // Re-pairing re-runs the compare-and-confirm flow, it does not just accept.
    expect(await screen.findByText(/الاتصال بجهاز رئيسي/)).toBeInTheDocument();
  });
});

describe("PairHostScreen — the host moved", () => {
  /**
   * guards N-2: a router reboot took three tills out on Thursday morning and
   * the recovery was a consultant editing `client.json` on each of them. The
   * pinned certificate survives a move, so only the address is stale.
   */
  it("offers the new address it found by the PINNED certificate, and applies it on request", async () => {
    const user = userEvent.setup();
    const calls = installBridge((message) => {
      if (message.kind === "state") {
        return {
          kind: "state",
          role: "client",
          hostUrl: "https://192.168.1.7:4173",
          pinnedFingerprint: FINGERPRINT,
          deviceLabel: "كاشير ١",
          mayPair: false,
        };
      }
      if (message.kind === "relocate") {
        return { kind: "relocate", ok: true, found: "https://192.168.1.9:4173", applied: message.accept != null };
      }
      return { kind: "discover", discoveryAvailable: false, hosts: [] };
    });

    renderWithProviders(<PairHostScreen />, {
      route: `/pair-host?fault=UNREACHABLE&host=${encodeURIComponent("https://192.168.1.7:4173")}`,
    });

    expect(await screen.findByText(/تعذّر الاتصال بالجهاز الرئيسي/)).toBeInTheDocument();
    expect(await screen.findByText(/انتقل الجهاز الرئيسي إلى https:\/\/192\.168\.1\.9:4173/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /استخدم العنوان الجديد/ }));

    await waitFor(() =>
      expect(calls).toContainEqual({ kind: "relocate", accept: "https://192.168.1.9:4173" }),
    );
  });
});
