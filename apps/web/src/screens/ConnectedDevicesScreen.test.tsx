// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { ConnectedDevicesScreen } from "./ConnectedDevicesScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

/**
 * The panel this wraps existed and was reachable from NOWHERE — `grep
 * ConnectedDevicesPanel` found only its own test — so freeing a stuck seat,
 * which blocks every other till until somebody does it, had no control surface
 * in the shipped product at all.
 */
describe("ConnectedDevicesScreen", () => {
  it("renders the seat panel under its own heading", async () => {
    const transport = stubTransport({
      "GET /lan/status": () => ({ body: { licensed: true, seats: 3, connected: 1 } }),
      "GET /lan/sessions": () => ({
        body: {
          seats: 3,
          connected: 1,
          sessions: [
            { sessionId: "s1", userId: "USER-ADMIN", deviceId: "till-1", deviceLabel: "Front till", connectedAt: 1000, lastSeenAt: 2000 },
          ],
        },
      }),
    });

    renderWithProviders(<ConnectedDevicesScreen />, { transport, initialSession: testAdminSession });

    expect(await screen.findByRole("heading", { name: "الأجهزة المتصلة" })).toBeInTheDocument();
    expect(await screen.findByText("Front till")).toBeInTheDocument();
  });
});
