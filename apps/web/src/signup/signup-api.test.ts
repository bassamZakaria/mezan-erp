import { afterEach, describe, expect, it, vi } from "vitest";
import { startSignup, verifySignup } from "./signup-api";

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

  it("posts a signup to /api/signup with no trailing slash — the server mounts the route strictly, and /api/signup/ falls through to the tenant router's TENANT_REQUIRED", async () => {
    const calls = stubFetch(201, { devVerifyUrl: null });
    await startSignup({
      code: "acme",
      nameAr: "أكمي",
      nameEn: null,
      ownerEmail: "owner@acme.example",
      ownerNameAr: "مالك",
      planId: "PLAN-CORE",
      billingCycle: "monthly",
      website: "",
    });
    expect(calls).toEqual([{ url: "/api/signup", method: "POST" }]);
  });

  it("posts the verification token to /api/signup/verify", async () => {
    const calls = stubFetch(200, { tenant: { code: "acme" }, adminEmail: "owner@acme.example", adminPin: "123456", alreadyVerified: false });
    await verifySignup("token");
    expect(calls).toEqual([{ url: "/api/signup/verify", method: "POST" }]);
  });

  it("surfaces the server's Arabic message when a signup is refused", async () => {
    stubFetch(409, { error: "TENANT_CODE_TAKEN", message: "هذا الرمز مستخدم بالفعل" });
    await expect(
      startSignup({ code: "acme", nameAr: "أكمي", nameEn: null, ownerEmail: "o@acme.example", ownerNameAr: "مالك", planId: "PLAN-CORE", billingCycle: "monthly", website: "" }),
    ).rejects.toMatchObject({ status: 409, message: "هذا الرمز مستخدم بالفعل" });
  });
});
