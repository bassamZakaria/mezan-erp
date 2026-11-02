import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { DEVICE_BINDING_HEADER, DeviceBinding } from "@mezan/contracts";
import { SessionCookie, createCookieSessions } from "./cookie-session.js";

function app(): Hono {
  const sessions = createCookieSessions({
    trustProxy: false,
    tenantResolver: {},
    platformMaxAgeMs: 60_000,
    audit: { record: async () => undefined } as never,
    csrfKey: Buffer.alloc(32, 1),
  });
  const root = new Hono();
  root.use("/api/*", sessions.tenant);
  root.post("/api/auth/firebase", (c) => c.json({ userId: "u1", tenantCode: "cyag", token: "issued-token" }));
  return root;
}

describe("cookie sessions — a Firebase sign-in", () => {
  it("lands in the tenant session cookie and never reaches the page as a token", async () => {
    const res = await app().fetch(
      new Request("http://cloud.internal/api/auth/firebase", {
        method: "POST",
        headers: { "content-type": "application/json", [DEVICE_BINDING_HEADER]: DeviceBinding.Cookie },
        body: JSON.stringify({ idToken: "x" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("token");
    const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SessionCookie.Tenant}=`));
    expect(session).toMatch(new RegExp(`^${SessionCookie.Tenant}=cyag\\.issued-token;.*HttpOnly`));
  });
});
