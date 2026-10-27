import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ALL_SCOPE, type AuditEvent, type AuditSink, type AuditStream } from "@mezan/domain";
import {
  canonicalOrigin,
  createSessionAuthContextResolver,
  createSessionRegistry,
  sessionOriginReporting,
} from "./session-auth.js";
import { createPermissionGate } from "./permission-gate.js";
import { requestBodyLimit } from "./body-limit.js";

const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const MAX_SESSION_MS = 16 * 60 * 60 * 1000;

const TILL = "192.168.1.50";
const OTHER_TILL = "192.168.1.77";

const clerkGrant = {
  userId: "USER-CLERK",
  permissions: ["accounting.coa.view"],
  roleCode: "CLERK",
  branchScope: ["BR-CAIRO"] as readonly string[],
  warehouseScope: ["WH-MAIN"] as readonly string[],
};

/**
 * The shape `@hono/node-server` puts on `c.env`, which is where
 * `requestOrigin` reads the peer address from. Nothing here is a header, and
 * that is the property under test: a client cannot write this.
 */
function fromAddress(address: string | null) {
  return address === null ? undefined : { incoming: { socket: { remoteAddress: address } } };
}

function guardedApp(sessions: ReturnType<typeof createSessionRegistry>) {
  const gate = createPermissionGate(createSessionAuthContextResolver(sessions));
  const app = new Hono();
  app.get("/secret", gate("accounting.coa.view"), (c) => c.json({ ok: true }));
  return app;
}

function get(app: Hono, token: string, address: string | null) {
  return app.fetch(
    new Request("http://local/secret", { headers: { authorization: `Bearer ${token}` } }),
    fromAddress(address),
  );
}

function collectingSink(): { sink: AuditSink; rows: AuditEvent[] } {
  const rows: AuditEvent[] = [];
  return {
    rows,
    sink: {
      append: async (event) => {
        rows.push(event);
      },
      query: async (stream: AuditStream) => rows.filter((e) => e.stream === stream),
    },
  };
}

describe("origin canonicalisation", () => {
  it("folds the spellings one machine presents itself in", () => {
    // A dual-stack listener reports the mapped form and an IPv4 listener the
    // bare one; a till that bound one and presented the other would be signed
    // out on its very next request.
    expect(canonicalOrigin("::ffff:192.168.1.5")).toBe("192.168.1.5");
    expect(canonicalOrigin("::FFFF:192.168.1.5")).toBe("192.168.1.5");
    expect(canonicalOrigin("::ffff:c0a8:105")).toBe("192.168.1.5");
    expect(canonicalOrigin("0:0:0:0:0:ffff:c0a8:105")).toBe("192.168.1.5");
    expect(canonicalOrigin("[::ffff:192.168.1.5]")).toBe("192.168.1.5");
    expect(canonicalOrigin("192.168.1.5")).toBe("192.168.1.5");
  });

  it("drops the zone the peer never chose, and collapses IPv6 spellings", () => {
    expect(canonicalOrigin("fe80::1%en0")).toBe(canonicalOrigin("fe80::1"));
    expect(canonicalOrigin("fe80:0:0:0:0:0:0:1")).toBe(canonicalOrigin("fe80::1"));
    expect(canonicalOrigin("[fe80::1%eth0]")).toBe(canonicalOrigin("FE80::1"));
  });

  it("never lets a non-null address collapse to the host", () => {
    // null is ONE origin — the in-process mount. Anything that reached a socket
    // must stay distinguishable from it, including junk.
    for (const raw of ["", "   ", "%", "[]", "not-an-address", "0.0.0.0", "::"]) {
      expect(canonicalOrigin(raw)).not.toBeNull();
    }
    expect(canonicalOrigin(null)).toBeNull();
  });

  it("compares an unparseable origin verbatim rather than normalising it away", () => {
    expect(canonicalOrigin("some-socket-path")).toBe("some-socket-path");
    expect(canonicalOrigin("some-socket-path")).not.toBe(canonicalOrigin("other-socket-path"));
  });
});

describe("a session is bound to where it was issued", () => {
  it("keeps the desktop's own IPC session working on the host", async () => {
    const sessions = createSessionRegistry();
    const token = await sessions.issue(clerkGrant); // no origin: the in-process mount
    const app = guardedApp(sessions);

    expect((await get(app, token, null)).status).toBe(200);
    expect((await get(app, token, null)).status).toBe(200);
  });

  it("refuses a host-issued token the moment it appears on the wire", async () => {
    // The trap this whole change exists to avoid: treating "no origin" as
    // "any origin" would make the check bypassable by anything that can reach
    // the in-process mount.
    const sessions = createSessionRegistry();
    const token = await sessions.issue(clerkGrant);
    const app = guardedApp(sessions);

    expect((await get(app, token, TILL)).status).toBe(401);
  });

  it("lets a till use its own token from the address it logged in from", async () => {
    const sessions = createSessionRegistry();
    const token = await sessions.issue(clerkGrant, TILL);
    const app = guardedApp(sessions);

    expect((await get(app, token, TILL)).status).toBe(200);
    expect((await get(app, token, TILL)).status).toBe(200);
    // The same machine, seen through a dual-stack listener.
    expect((await get(app, token, `::ffff:${TILL}`)).status).toBe(200);
  });

  it("refuses a till token lifted to another device, and does not let it work back home", async () => {
    // The measured hole: a token read out of a till's storage worked from
    // anywhere on the shop wifi, as that user, for at least twelve hours. A
    // mismatch REVOKES — it does not merely refuse the one request, and it
    // never re-binds.
    const sessions = createSessionRegistry();
    const token = await sessions.issue(clerkGrant, TILL);
    const app = guardedApp(sessions);

    expect((await get(app, token, OTHER_TILL)).status).toBe(401);
    expect((await get(app, token, TILL)).status).toBe(401);
    expect(await sessions.find(token, TILL)).toBeNull();
  });

  it("refuses a till token presented over the in-process mount", async () => {
    const sessions = createSessionRegistry();
    const token = await sessions.issue(clerkGrant, TILL);
    const app = guardedApp(sessions);

    expect((await get(app, token, null)).status).toBe(401);
  });

  it("reports a moved token as moved, and a home-address expiry as expiry", async () => {
    let clock = 1_000_000;
    const sessions = createSessionRegistry(() => clock);

    const moved = await sessions.issue(clerkGrant, TILL);
    expect((await sessions.inspect(moved, OTHER_TILL)).refusal).toEqual({
      reason: "moved",
      userId: "USER-CLERK",
      issuedFrom: TILL,
      presentedFrom: OTHER_TILL,
      sessionEnded: true,
    });

    const idled = await sessions.issue(clerkGrant, TILL);
    clock += IDLE_TIMEOUT_MS + 1;
    expect((await sessions.inspect(idled, TILL)).refusal?.reason).toBe("idle");
  });

  it("names the host as an origin rather than as a missing value", async () => {
    const sessions = createSessionRegistry();
    const token = await sessions.issue(clerkGrant);
    expect((await sessions.inspect(token, TILL)).refusal).toMatchObject({
      reason: "moved",
      issuedFrom: "host",
      presentedFrom: TILL,
    });
  });

  it("still ends every session of a deactivated user, whatever they were bound to", async () => {
    const sessions = createSessionRegistry();
    const host = await sessions.issue(clerkGrant);
    const till = await sessions.issue(clerkGrant, TILL);
    const other = await sessions.issue({ ...clerkGrant, userId: "USER-OTHER" }, OTHER_TILL);

    await sessions.revokeUser("USER-CLERK");
    expect(await sessions.find(host)).toBeNull();
    expect(await sessions.find(till, TILL)).toBeNull();
    expect(await sessions.find(other, OTHER_TILL)).not.toBeNull();
  });

  it("keeps the branch/warehouse narrowing rules the binding sits on top of", async () => {
    const sessions = createSessionRegistry();
    const token = await sessions.issue({ ...clerkGrant, branchScope: ALL_SCOPE }, TILL);
    const resolve = createSessionAuthContextResolver(sessions);
    const app = new Hono();
    app.get("/scope", async (c) => {
      const ctx = await resolve(c);
      return c.json({
        branchScope: ctx.branchScope === ALL_SCOPE ? "*" : [...ctx.branchScope],
        warehouseScope: ctx.warehouseScope === ALL_SCOPE ? "*" : [...ctx.warehouseScope],
      });
    });

    const res = await app.fetch(
      new Request("http://local/scope", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-branch-scope": "BR-ALEX",
          "x-warehouse-scope": "WH-VAN",
        },
      }),
      fromAddress(TILL),
    );
    // Narrowed on the granted dimension, NOT widened on the scoped one.
    expect(await res.json()).toEqual({ branchScope: ["BR-ALEX"], warehouseScope: ["WH-MAIN"] });
  });
});

describe("a session has a maximum lifetime, however busy it is", () => {
  it("ends a continuously used session at the absolute cap", async () => {
    let clock = 1_000_000;
    const sessions = createSessionRegistry(() => clock);
    const token = await sessions.issue(clerkGrant, TILL);

    // Polled once an hour: `lastSeenAt` never goes stale, so the idle timeout
    // alone would have kept this alive forever.
    for (let hour = 1; hour <= 15; hour += 1) {
      clock += 60 * 60 * 1000;
      expect(await sessions.find(token, TILL)).not.toBeNull();
    }
    clock += 60 * 60 * 1000 + 1;
    expect(await sessions.find(token, TILL)).toBeNull();
  });

  it("reports the cap as its own reason, distinct from going idle", async () => {
    let clock = 1_000_000;
    const sessions = createSessionRegistry(() => clock);
    const token = await sessions.issue(clerkGrant, TILL);

    clock += 6 * 60 * 60 * 1000;
    expect(await sessions.find(token, TILL)).not.toBeNull();
    clock += MAX_SESSION_MS - 6 * 60 * 60 * 1000 + 1;
    expect((await sessions.inspect(token, TILL)).refusal?.reason).toBe("aged");
  });

  it("still expires an untouched session on the shorter idle timeout", async () => {
    let clock = 1_000_000;
    const sessions = createSessionRegistry(() => clock);
    const token = await sessions.issue(clerkGrant, TILL);

    clock += IDLE_TIMEOUT_MS + 1;
    expect((await sessions.inspect(token, TILL)).refusal?.reason).toBe("idle");
  });

  it("sweeps aged sessions out on the next issue rather than holding them forever", async () => {
    let clock = 1_000_000;
    const sessions = createSessionRegistry(() => clock);
    const aged = await sessions.issue(clerkGrant, TILL);
    clock += 60 * 60 * 1000;
    // Used, so it is not idle — only the absolute cap can reap it.
    expect(await sessions.find(aged, TILL)).not.toBeNull();
    clock += MAX_SESSION_MS;
    await sessions.issue(clerkGrant, OTHER_TILL);
    expect(await sessions.find(aged, TILL)).toBeNull();
  });
});

describe("a moved token is recorded", () => {
  function reportingApp(sessions: ReturnType<typeof createSessionRegistry>, sink: AuditSink) {
    const app = new Hono();
    app.use("*", sessionOriginReporting(sessions, sink));
    app.get("/anything", (c) => c.json({ ok: true }));
    return app;
  }

  it("writes one CRITICAL security row naming both addresses", async () => {
    const sessions = createSessionRegistry();
    const { sink, rows } = collectingSink();
    const token = await sessions.issue(clerkGrant, TILL);
    const app = reportingApp(sessions, sink);

    await app.fetch(
      new Request("http://local/anything", { headers: { authorization: `Bearer ${token}` } }),
      fromAddress(OTHER_TILL),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      stream: "security",
      module: "auth",
      action: "SESSION_ORIGIN_REJECTED",
      actor: "USER-CLERK",
      entityId: "USER-CLERK",
      severity: "CRITICAL",
    });
    expect(rows[0]?.details).toMatchObject({
      issuedFrom: TILL,
      presentedFrom: OTHER_TILL,
      method: "GET",
      path: "/anything",
    });
  });

  it("writes nothing for a token used where it belongs, or for one that never existed", async () => {
    const sessions = createSessionRegistry();
    const { sink, rows } = collectingSink();
    const token = await sessions.issue(clerkGrant, TILL);
    const app = reportingApp(sessions, sink);

    await app.fetch(
      new Request("http://local/anything", { headers: { authorization: `Bearer ${token}` } }),
      fromAddress(TILL),
    );
    await app.fetch(
      new Request("http://local/anything", { headers: { authorization: "Bearer never-issued" } }),
      fromAddress(OTHER_TILL),
    );
    await app.fetch(new Request("http://local/anything"), fromAddress(OTHER_TILL));

    expect(rows).toHaveLength(0);
  });

  it("fires once per token, because the mismatch revoked it", async () => {
    const sessions = createSessionRegistry();
    const { sink, rows } = collectingSink();
    const token = await sessions.issue(clerkGrant, TILL);
    const app = reportingApp(sessions, sink);

    for (let i = 0; i < 5; i += 1) {
      await app.fetch(
        new Request("http://local/anything", { headers: { authorization: `Bearer ${token}` } }),
        fromAddress(OTHER_TILL),
      );
    }
    expect(rows).toHaveLength(1);
  });

  it("records a stolen token on a write as it does on a read, though the body limit asked who the caller was first", async () => {
    for (const method of ["GET", "POST"]) {
      const sessions = createSessionRegistry();
      const { sink, rows } = collectingSink();
      const token = await sessions.issue(clerkGrant, TILL);
      const resolve = createSessionAuthContextResolver(sessions);
      const app = new Hono();
      app.use("*", requestBodyLimit(resolve));
      app.use("*", sessionOriginReporting(sessions, sink));
      app.all("/secret", createPermissionGate(resolve)("accounting.coa.view"), (c) => c.json({ ok: true }));

      const res = await app.fetch(
        new Request("http://local/secret", {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: method === "POST" ? "{}" : undefined,
        }),
        fromAddress(OTHER_TILL),
      );

      expect(res.status, method).toBe(401);
      expect(rows.map((row) => row.action), method).toEqual(["SESSION_ORIGIN_REJECTED"]);
      expect(rows[0]?.details, method).toMatchObject({ method, issuedFrom: TILL, presentedFrom: OTHER_TILL });
      expect(await sessions.find(token, TILL), method).toBeNull();
    }
  });

  it("looks a token up once per request, however many middlewares ask who the caller is", async () => {
    const sessions = createSessionRegistry();
    let lookups = 0;
    const counting = {
      ...sessions,
      inspect: async (token: string, origin?: string | null) => ((lookups += 1), await sessions.inspect(token, origin)),
      find: async (token: string, origin?: string | null) => ((lookups += 1), await sessions.find(token, origin)),
    };
    const token = await sessions.issue(clerkGrant, TILL);
    const resolve = createSessionAuthContextResolver(counting);
    const { sink } = collectingSink();
    const app = new Hono();
    app.use("*", requestBodyLimit(resolve));
    app.use("*", sessionOriginReporting(counting, sink));
    app.post("/secret", createPermissionGate(resolve)("accounting.coa.view"), (c) => c.json({ ok: true }));

    const res = await app.fetch(
      new Request("http://local/secret", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" }),
      fromAddress(TILL),
    );

    expect(res.status).toBe(200);
    expect(lookups).toBe(1);
  });

  it("never turns a failing audit write into a 500 on the request", async () => {
    const sessions = createSessionRegistry();
    const token = await sessions.issue(clerkGrant, TILL);
    const exploding: AuditSink = {
      append: async () => {
        throw new Error("sink closed");
      },
      query: async () => [],
    };
    const app = reportingApp(sessions, exploding);

    const res = await app.fetch(
      new Request("http://local/anything", { headers: { authorization: `Bearer ${token}` } }),
      fromAddress(OTHER_TILL),
    );
    expect(res.status).toBe(200);
    // AND THE REVOCATION STANDS (D298). The forensic row is best-effort, so
    // this pair is deliberately NOT atomic — in memory and in the database
    // store alike, the revocation commits on its own before the audit write:
    // an audit failure that rolled it back would hand the moved token straight
    // back to whoever presented it.
    expect(await sessions.find(token, TILL)).toBeNull();
  });

  it("lets a re-login through on the same request path a stale token arrives on", async () => {
    // A till whose address changed still holds the old token in storage and
    // will send it — including to `/auth/login`. The reporter must record and
    // step aside, never answer, or the till is locked out of the one screen it
    // recovers through.
    const sessions = createSessionRegistry();
    const { sink, rows } = collectingSink();
    const token = await sessions.issue(clerkGrant, TILL);
    const app = new Hono();
    app.use("*", sessionOriginReporting(sessions, sink));
    app.post("/auth/login", (c) => c.json({ token: "fresh" }));

    const res = await app.fetch(
      new Request("http://local/auth/login", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
      fromAddress(OTHER_TILL),
    );
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(1);
  });
});
