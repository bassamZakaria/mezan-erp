// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConnectedDevicesPanel } from "./ConnectedDevicesPanel";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

describe("ConnectedDevicesPanel", () => {
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
});
