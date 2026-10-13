import { afterEach, describe, expect, it, vi } from "vitest";
import { IdempotencyRefusal } from "@mezan/contracts";
import { apiRequest, HttpMethod, ScopeAll, type ApiCredentials } from "./client";
import { ApiError, ApiFailure } from "./errors";

const base: ApiCredentials = { baseUrl: "https://shop.example/api", tenantCode: "acme", token: null, branchScope: ScopeAll.Every, warehouseScope: ScopeAll.Every };

function answering(status: number, body: unknown) {
  const seen: Headers[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    seen.push(new Headers(init.headers));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe("what the phone sends with a request", () => {
  it("asks for a device-bound session on sign-in only", async () => {
    const seen = answering(200, {});
    await apiRequest({ ...base, bindDevice: true }, "/auth/login", { method: HttpMethod.Post, body: {} });
    await apiRequest({ ...base, token: "tok", deviceSecret: "secret" }, "/profile");

    expect(seen[0]!.get("x-mezan-device-binding")).toBe("1");
    expect(seen[0]!.get("x-mezan-device")).toBeNull();
    expect(seen[1]!.get("x-mezan-device-binding")).toBeNull();
  });

  it("sends its device secret beside the token, and never without one", async () => {
    const seen = answering(200, {});
    await apiRequest({ ...base, token: "tok", deviceSecret: "secret" }, "/profile");
    await apiRequest({ ...base, deviceSecret: "secret" }, "/tenant");

    expect(seen[0]!.get("authorization")).toBe("Bearer tok");
    expect(seen[0]!.get("x-mezan-device")).toBe("secret");
    expect(seen[1]!.get("x-mezan-device")).toBeNull();
  });

  it("keeps the server's refusal code on the error it throws", async () => {
    answering(409, { error: IdempotencyRefusal.KeyReused, message: "سبق تسجيل مستند" });
    const failure: unknown = await apiRequest(base, "/sales-invoices", { method: HttpMethod.Post, body: {} }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe(IdempotencyRefusal.KeyReused);
  });
});

describe("how the phone reads a refusal to sign in", () => {
  function refusing(status: number, body: unknown, headers: Record<string, string> = {}) {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }));
    return apiRequest(base, "/auth/login", { method: HttpMethod.Post, body: {} }).catch((err: unknown) => err as ApiError);
  }

  it("names a locked account as locked and keeps whether a code was mailed", async () => {
    const mailed = (await refusing(423, { error: "ACCOUNT_LOCKED", unlockByCode: true, message: "تم قفل هذا الحساب" })) as ApiError;
    const notMailed = (await refusing(423, { error: "ACCOUNT_LOCKED", unlockByCode: false, message: "تم قفل هذا الحساب" })) as ApiError;

    expect(mailed).toMatchObject({ failure: ApiFailure.Locked, status: 423, code: "ACCOUNT_LOCKED", unlockByCode: true, serverMessage: "تم قفل هذا الحساب" });
    expect(notMailed.unlockByCode).toBe(false);
  });

  it("names too many attempts as a wait, taking the seconds from the body and otherwise from Retry-After", async () => {
    const fromBody = (await refusing(429, { error: "TOO_MANY_ATTEMPTS", retryAfterSeconds: 900, message: "محاولات دخول كثيرة" }, { "retry-after": "5" })) as ApiError;
    const fromHeader = (await refusing(429, { error: "TOO_MANY_REQUESTS", message: "طلبات كثيرة" }, { "retry-after": "60" })) as ApiError;
    const unnamed = (await refusing(429, { error: "TOO_MANY_REQUESTS" })) as ApiError;
    const aDate = (await refusing(429, {}, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })) as ApiError;

    expect(fromBody).toMatchObject({ failure: ApiFailure.Throttled, retryAfterSeconds: 900 });
    expect(fromHeader).toMatchObject({ failure: ApiFailure.Throttled, retryAfterSeconds: 60 });
    expect(unnamed).toMatchObject({ failure: ApiFailure.Throttled, retryAfterSeconds: null });
    expect(aDate.retryAfterSeconds).toBeNull();
  });

  it("names a 503 as the service being unavailable, with its code and its wait", async () => {
    const audit = (await refusing(503, { error: "AUDIT_UNAVAILABLE", message: "تعذّر تسجيل العملية في سجل التدقيق" })) as ApiError;
    const busy = (await refusing(503, { error: "SIGN_IN_BUSY", retryAfterSeconds: 2, message: "الخادم مشغول الآن" })) as ApiError;
    const broken = (await refusing(500, { error: "INTERNAL" })) as ApiError;

    expect(audit).toMatchObject({ failure: ApiFailure.Unavailable, code: "AUDIT_UNAVAILABLE", retryAfterSeconds: null });
    expect(busy).toMatchObject({ failure: ApiFailure.Unavailable, code: "SIGN_IN_BUSY", retryAfterSeconds: 2 });
    expect(broken.failure).toBe(ApiFailure.Server);
  });
});
