import { describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import { createSessionRegistry, MAX_SESSION_MS } from "@mezan/api";
import { secretIntoCookie } from "./device-cookie.js";

const HOUR = 60 * 60_000;
const grant = { userId: "u-1", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE };

interface StoredCookie {
  readonly value: string;
  readonly expiresAt: number;
}

async function cookieSetAt(now: number, deviceSecret: string): Promise<StoredCookie> {
  const answer = await secretIntoCookie(new Response(JSON.stringify({ token: "t", deviceSecret }), { status: 200 }), true);
  const header = answer.headers.get("set-cookie") ?? "";
  const maxAge = Number(/Max-Age=(\d+)/.exec(header)?.[1]);
  return { value: /^mezan_device=([^;]+)/.exec(header)?.[1] ?? "", expiresAt: now + maxAge * 1000 };
}

describe("the cookie that carries a browser's device secret", () => {
  it("lives exactly as long as a session may, not the shorter idle window", async () => {
    const stored = await cookieSetAt(0, "secret");
    expect(stored.expiresAt).toBe(MAX_SESSION_MS);
  });

  it("is still in the browser at every hour a session in steady use is still served, so an active user is never refused as a stolen token", async () => {
    let now = 1_700_000_000_000;
    const sessions = createSessionRegistry(() => now);
    const session = sessions.issueDeviceBound(grant, "41.33.10.10");
    const cookie = await cookieSetAt(now, session.deviceSecret);

    for (let hour = 1; hour <= 15; hour += 1) {
      now += HOUR;
      const presented = now < cookie.expiresAt ? cookie.value : null;
      const lookup = sessions.inspect(session.token, "41.33.10.10", presented);
      expect(lookup.refusal, `hour ${hour}`).toBeNull();
      expect(lookup.grant?.userId).toBe("u-1");
    }
  });
});
