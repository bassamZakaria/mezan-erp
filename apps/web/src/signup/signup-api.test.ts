import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmOwnerHandOver } from "./signup-api";

function stubFetch(status: number, body: unknown) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    }),
  );
  return calls;
}

describe("signup-api", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the hand-over token to /api/signup/owner-handover", async () => {
    const calls = stubFetch(200, { confirmed: true });
    await confirmOwnerHandOver("token");
    expect(calls).toEqual([{ url: "/api/signup/owner-handover", method: "POST" }]);
  });

  it("surfaces the server's Arabic message when a hand-over link is refused", async () => {
    stubFetch(400, { error: "OWNER_HANDOVER_LINK_INVALID", message: "رابط التأكيد غير صالح أو سبق استخدامه." });
    await expect(confirmOwnerHandOver("token")).rejects.toMatchObject({ status: 400, message: "رابط التأكيد غير صالح أو سبق استخدامه." });
  });
});
