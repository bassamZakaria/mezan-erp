// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectedDevicesPanel } from "./ConnectedDevicesPanel";
import { AppI18nProvider } from "../i18n";

const render = (ui: React.ReactElement) => rtlRender(<AppI18nProvider>{ui}</AppI18nProvider>);

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("ConnectedDevicesPanel", () => {
  it("shows an unlicensed message and no table when LAN mode is not licensed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ licensed: false, seats: 0, connected: 0 }));
    render(<ConnectedDevicesPanel fetchImpl={fetchImpl} pollIntervalMs={0} />);

    expect(await screen.findByText(/غير مفعّل/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("lists connected devices with seat usage when licensed", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/lan/status")) {
        return Promise.resolve(jsonResponse({ licensed: true, seats: 2, connected: 2 }));
      }
      if (url.endsWith("/lan/sessions")) {
        return Promise.resolve(
          jsonResponse({
            seats: 2,
            connected: 2,
            sessions: [
              { sessionId: "s1", deviceId: "till-1", deviceLabel: "Front till", connectedAt: 1000, lastSeenAt: 2000 },
              { sessionId: "s2", deviceId: "till-2", deviceLabel: "Back office", connectedAt: 1500, lastSeenAt: 2500 },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<ConnectedDevicesPanel fetchImpl={fetchImpl} pollIntervalMs={0} />);

    expect(await screen.findByText("Front till")).toBeInTheDocument();
    expect(screen.getByText("Back office")).toBeInTheDocument();
    expect(screen.getByText("اكتمل عدد المقاعد")).toBeInTheDocument();
  });

  it("disconnects only the clicked row and refreshes, without disabling the other row", async () => {
    const user = userEvent.setup();
    let connected = 2;
    const fetchImpl = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/lan/status")) {
        return Promise.resolve(jsonResponse({ licensed: true, seats: 2, connected }));
      }
      if (url.endsWith("/lan/sessions")) {
        const sessions =
          connected === 2
            ? [
                { sessionId: "s1", deviceId: "till-1", deviceLabel: "Front till", connectedAt: 1000, lastSeenAt: 2000 },
                { sessionId: "s2", deviceId: "till-2", deviceLabel: "Back office", connectedAt: 1500, lastSeenAt: 2500 },
              ]
            : [{ sessionId: "s2", deviceId: "till-2", deviceLabel: "Back office", connectedAt: 1500, lastSeenAt: 2500 }];
        return Promise.resolve(jsonResponse({ seats: 2, connected, sessions }));
      }
      if (init?.method === "DELETE") {
        connected -= 1;
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<ConnectedDevicesPanel fetchImpl={fetchImpl} pollIntervalMs={0} />);

    const frontRow = (await screen.findByText("Front till")).closest("tr")!;
    const backRow = screen.getByText("Back office").closest("tr")!;

    await user.click(within(frontRow).getByRole("button", { name: "فصل" }));

    // The row being disconnected shows pending state; the OTHER row's button
    // must stay enabled (per-item pending, not a mutation-wide disable).
    expect(within(backRow).getByRole("button", { name: "فصل" })).not.toBeDisabled();

    await waitFor(() => expect(screen.queryByText("Front till")).not.toBeInTheDocument());
    expect(screen.getByText("Back office")).toBeInTheDocument();
  });
});
