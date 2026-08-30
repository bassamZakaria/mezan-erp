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
