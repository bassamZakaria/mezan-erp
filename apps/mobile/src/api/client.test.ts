import { afterEach, describe, expect, it, vi } from "vitest";
import { IdempotencyRefusal } from "@mezan/contracts";
import { apiRequest, HttpMethod, ScopeAll, type ApiCredentials } from "./client";
import { ApiError } from "./errors";

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
