import { describe, it, expect, afterEach } from "vitest";
import { createBackend, type BackendHandle } from "@mezan/backend";
import { createEntitlements, ALL_SCOPE } from "@mezan/domain";

/**
 * Regression guard for the composition `main/index.ts` builds around line 426:
 * `createBackend({ ..., resolveEntitlements: () => entitlements, lan: {
 * resolveEntitlements: () => entitlements, ... } })`, both pointing at the
 * SAME verified-licence entitlements. `index.ts` itself has real Electron
 * side effects on import (`app.whenReady()`, window creation) and cannot be
 * driven directly by a test, so this reproduces the composition and asserts
 * its externally observable effect: the TOP-LEVEL app — not only `/lan/*` —
 * reports the licence's plan, rather than the permissive ENTERPRISE default
 * `createBackend` falls back to when no `resolveEntitlements` is supplied.
 * Before this fix, the desktop passed `resolveEntitlements` to `lan` only,
 * so every non-LAN route (the machine's own IPC-driven UI included) ran on
 * that permissive default.
 */

const handles: BackendHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

describe("desktop's top-level backend runs on the verified licence's entitlements", () => {
  it("GET /entitlements reports the licence plan, not the permissive default", async () => {
    const licenceEntitlements = createEntitlements({
      plan: "PRO",
      activeModules: ["sales"],
      features: {},
      seats: 3,
      expiresAt: null,
    });

    const handle = await createBackend({
      dbPath: ":memory:",
      resolveEntitlements: () => licenceEntitlements,
      lan: { resolveEntitlements: () => licenceEntitlements },
    });
    handles.push(handle);

    const token = await handle.sessions.issue({
      userId: "admin",
      permissions: ["*"],
      roleCode: null,
      branchScope: ALL_SCOPE,
      warehouseScope: ALL_SCOPE,
    });

    const res = await handle.app.fetch(
      new Request("http://local/entitlements", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: string; seats: number };
    expect(body.plan).toBe("PRO");
    expect(body.plan).not.toBe("ENTERPRISE");
    expect(body.seats).toBe(3);
  });
});
