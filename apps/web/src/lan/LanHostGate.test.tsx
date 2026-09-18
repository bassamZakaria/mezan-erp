// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { LanHostGate } from "./LanHostGate";
import { renderWithProviders } from "../data/test-support";
import type { PairingRequestMessage, PairingResponse } from "./pairing-bridge";

/**
 * guards N-3 and ticket #4.
 *
 * On a client machine "the host is not answering" was a login form that froze
 * for thirty seconds and then produced ONE bilingual sentence with a URL and a
 * millisecond count in it — the same sentence for a sleeping host, a closed
 * app, a changed IP, a firewall and a certificate mismatch. Five faults, five
 * different things to do, one message.
 */
type BridgeHost = {
  mezan?: {
    pairing?: (m: PairingRequestMessage) => Promise<PairingResponse>;
    fetch?: (input: string) => Promise<{ status: number; body: string }>;
  };
};

function installClient(healthResponse: { status: number; body: string }) {
  (globalThis as BridgeHost).mezan = {
    pairing: () =>
      Promise.resolve({
        kind: "state",
        role: "client",
        hostUrl: "https://192.168.1.7:4173",
        pinnedFingerprint: "AA:BB",
        deviceLabel: "كاشير ١",
        mayPair: false,
      }),
    fetch: () => Promise.resolve(healthResponse),
  };
}

afterEach(() => {
  delete (globalThis as BridgeHost).mezan;
});

describe("LanHostGate", () => {
  it("renders the app untouched on a host machine, where there is no bridge to ask", async () => {
    renderWithProviders(
      <LanHostGate>
        <div>لوحة التحكم</div>
      </LanHostGate>,
    );
    expect(await screen.findByText("لوحة التحكم")).toBeInTheDocument();
  });

  it("renders the app when the client CAN reach its host", async () => {
    installClient({ status: 200, body: JSON.stringify({ ok: true }) });
    renderWithProviders(
      <LanHostGate>
        <div>لوحة التحكم</div>
      </LanHostGate>,
    );
    expect(await screen.findByText("لوحة التحكم")).toBeInTheDocument();
    // And it never flashed a failure on the way.
    expect(screen.queryByText(/تعذّر الاتصال بالجهاز الرئيسي/)).not.toBeInTheDocument();
  });

  it("names the fault in Arabic, with the paired address, instead of the shell", async () => {
    installClient({
      status: 502,
      body: JSON.stringify({
        error: "HOST_UNREACHABLE",
        code: "TIMEOUT",
        host: "https://192.168.1.7:4173",
        // The English detail the transport produces. It must NOT be what the
        // shop reads.
        message: "No answer from https://192.168.1.7:4173 within 5000ms.",
      }),
    });

    renderWithProviders(
      <LanHostGate>
        <div>لوحة التحكم</div>
      </LanHostGate>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/لا يوجد رد من الجهاز الرئيسي/);
    expect(screen.queryByText("لوحة التحكم")).not.toBeInTheDocument();
    expect(screen.queryByText(/within 5000ms/)).not.toBeInTheDocument();
    // The paired address, and the two ways out.
    expect(screen.getAllByText(/192\.168\.1\.7:4173/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "أعد المحاولة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "افتح إعدادات الاقتران" })).toBeInTheDocument();
  });

  it("says something different for each fault — a mismatch is not a sleeping host", async () => {
    installClient({
      status: 502,
      body: JSON.stringify({
        error: "HOST_UNREACHABLE",
        code: "PIN_MISMATCH",
        host: "https://192.168.1.7:4173",
        message: "not the pinned host",
      }),
    });

    renderWithProviders(
      <LanHostGate>
        <div>لوحة التحكم</div>
      </LanHostGate>,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/ليس الجهاز الرئيسي المسجَّل/),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/لم يُرسَل أي شيء/);
  });
});
