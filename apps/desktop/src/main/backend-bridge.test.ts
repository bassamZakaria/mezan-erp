import { describe, expect, it } from "vitest";
import { createEntitlements } from "@mezan/domain";
import {
  bridgeEnv,
  decodeBridgeRequest,
  decodeBridgeResponse,
  encodeBridgeRequest,
  toCloneableLicence,
  toRawEntitlements,
} from "./backend-bridge.js";
import type { DesktopLicense } from "./license.js";

/**
 * guards Q-1 — the protocol that carries every request into the process that
 * owns SQLite. Three things have to survive the crossing, and each of them was
 * a way to break the product silently:
 *
 *  - the STATUS, HEADERS AND BODY of a response, byte for byte;
 *  - the PEER ADDRESS, because `requestOrigin` treats its presence as the proof
 *    that a request came over the network rather than from the renderer, and
 *    every origin-bound session check hangs off that;
 *  - the ENTITLEMENTS AS DATA, because `createEntitlements` returns an object
 *    with methods and structured clone throws on a function.
 */

const ENTITLEMENTS = {
  plan: "pro",
  activeModules: ["sales", "gl"],
  features: { "lan.multi_till": true },
  seats: 3,
  expiresAt: "2027-01-01T00:00:00.000Z",
};

describe("a request crossing into the backend process", () => {
  it("carries method, url, headers and body unchanged", async () => {
    const encoded = await encodeBridgeRequest(
      new Request("http://mezan.local/sales-invoices", {
        method: "POST",
        headers: { authorization: "Bearer abc", "content-type": "application/json" },
        body: JSON.stringify({ total: "100.00" }),
      }),
      null,
    );

    expect(encoded.method).toBe("POST");
    expect(encoded.url).toBe("http://mezan.local/sales-invoices");
    expect(encoded.headers["authorization"]).toBe("Bearer abc");

    const rebuilt = decodeBridgeRequest(encoded);
    expect(rebuilt.method).toBe("POST");
    expect(rebuilt.headers.get("authorization")).toBe("Bearer abc");
    await expect(rebuilt.json()).resolves.toEqual({ total: "100.00" });
  });

  it("sends no body for a GET, which `new Request` refuses to carry", async () => {
    const encoded = await encodeBridgeRequest(new Request("http://mezan.local/health"), null);
    expect(encoded.body).toBeNull();
    expect(() => decodeBridgeRequest(encoded)).not.toThrow();
  });

  it("keeps a LAN request distinguishable from an in-process one", async () => {
    const overLan = await encodeBridgeRequest(
      new Request("http://mezan.local/customers"),
      "192.168.1.40",
    );
    expect(overLan.remoteAddress).toBe("192.168.1.40");
    expect(bridgeEnv(overLan.remoteAddress)).toEqual({
      incoming: { socket: { remoteAddress: "192.168.1.40" } },
    });
  });

  /**
   * guards Q-1 — an env carrying an EMPTY address would read as "this came over
   * the network" to `requestOrigin`, which would bind the host's own in-process
   * session to a string instead of to null and refuse it on the next request.
   */
  it("produces NO env at all for a request from the renderer", async () => {
    const inProcess = await encodeBridgeRequest(new Request("http://mezan.local/customers"), null);
    expect(inProcess.remoteAddress).toBeNull();
    expect(bridgeEnv(null)).toBeUndefined();
  });
});

describe("a response crossing back", () => {
  it("rebuilds status, headers and body", async () => {
    const response = decodeBridgeResponse({
      status: 413,
      headers: { "content-type": "application/json; charset=UTF-8" },
      body: new TextEncoder().encode(JSON.stringify({ error: "RESPONSE_TOO_LARGE" })),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get("content-type")).toBe("application/json; charset=UTF-8");
    await expect(response.json()).resolves.toEqual({ error: "RESPONSE_TOO_LARGE" });
  });
});

describe("what may be put on the wire", () => {
  /**
   * guards Q-1 — `postMessage` uses structured clone, and structured clone
   * THROWS `DataCloneError` on a function. Sending the entitlements view as-is
   * would take the whole launch down at the point the backend starts.
   */
  it("strips the entitlement view's methods back to plain data", () => {
    const view = createEntitlements(ENTITLEMENTS);
    expect(typeof view.hasFeature).toBe("function");

    const raw = toRawEntitlements(view);
    expect(Object.values(raw).some((value) => typeof value === "function")).toBe(false);
    expect(raw).toEqual(ENTITLEMENTS);
    expect(structuredClone(raw)).toEqual(ENTITLEMENTS);
  });

  it("strips them from the licence too, and rebuilding restores the gate", () => {
    const licence = {
      entitlements: createEntitlements(ENTITLEMENTS),
      state: { state: "ACTIVE", canWrite: true, usable: true, reason: null },
      verified: true,
      identity: { licenseId: "L-1", fingerprint: "f", expiresAt: null, notBefore: null },
    } as unknown as DesktopLicense;

    expect(() => structuredClone(licence)).toThrow();

    const cloneable = toCloneableLicence(licence);
    expect(() => structuredClone(cloneable)).not.toThrow();
    expect(createEntitlements(cloneable.entitlements).hasFeature("lan.multi_till")).toBe(true);
    expect(createEntitlements(cloneable.entitlements).has("sales")).toBe(true);
    expect(createEntitlements(cloneable.entitlements).has("payroll")).toBe(false);
  });
});
