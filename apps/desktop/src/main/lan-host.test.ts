import { describe, it, expect } from "vitest";
import { createEntitlements, SeatSessionRegistry } from "@mezan/domain";
import { createApp } from "@mezan/api";
import { createSqliteUnitOfWork } from "@mezan/persistence";
import { startLanHost } from "./lan-host.js";

function buildHonoApp(entitlements: ReturnType<typeof createEntitlements>) {
  const uow = createSqliteUnitOfWork(":memory:");
  const registry = new SeatSessionRegistry(entitlements.seats);
  const app = createApp(uow, { lan: { resolveEntitlements: () => entitlements, registry } });
  return { app, close: () => uow.close() };
}

describe("startLanHost", () => {
  it("does not open a socket when the license lacks lan.multi_till (safe default: closed)", async () => {
    const entitlements = createEntitlements({
      plan: "STANDARD",
      activeModules: ["sales"],
      features: {},
      seats: 3,
      expiresAt: null,
    });
    const { app, close } = buildHonoApp(entitlements);

    const handle = startLanHost({ app, entitlements, port: 0 });
    expect(handle.enabled).toBe(false);
    expect(handle.address()).toBeNull();

    await handle.close();
    close();
  });

  it("binds a real LAN-visible socket serving the SAME shared app when the flag is on", async () => {
    const entitlements = createEntitlements({
      plan: "ENTERPRISE",
      activeModules: ["sales"],
      features: { "lan.multi_till": true },
      seats: 2,
      expiresAt: null,
    });
    const { app, close } = buildHonoApp(entitlements);

    const handle = startLanHost({ app, entitlements, host: "127.0.0.1", port: 0 });
    expect(handle.enabled).toBe(true);

    const address = await handle.ready;
    expect(address).not.toBeNull();
    const port = address!.port;
    expect(port).toBeGreaterThan(0);
    expect(handle.address()).not.toBeNull();

    // Prove it's actually the shared app: /lan/status (mounted via createApp's
    // lan option) is reachable over the real socket, not just in-process.
    const res = await fetch(`http://127.0.0.1:${port}/lan/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ licensed: true, seats: 2, connected: 0 });

    await handle.close();
    close();
  });
});
