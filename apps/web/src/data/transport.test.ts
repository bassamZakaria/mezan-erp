import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElectronTransport, createHttpTransport, resolveDefaultTransport } from "./transport";

describe("createHttpTransport", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("prefixes the path with the base URL and forwards init", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(input).toBe("/api/items?status=active");
      expect(init).toEqual({ method: "POST", credentials: "same-origin" });
      return new Response(JSON.stringify({ ok: true }), { status: 201 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const transport = createHttpTransport();
    const res = await transport("/items?status=active", { method: "POST" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(201);
    expect(res.ok).toBe(true);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("honours a custom base URL", async () => {
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      expect(input).toBe("http://example.test/items");
      return new Response("plain text", { status: 200 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const transport = createHttpTransport("http://example.test");
    const res = await transport("/items");
    await expect(res.text()).resolves.toBe("plain text");
  });

  it("reports ok:false for a non-2xx/3xx status", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404 })) as unknown as typeof fetch;
    const transport = createHttpTransport();
    const res = await transport("/missing");
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
  });
});

describe("the wait a refusal names in its Retry-After header", () => {
  it("is read by the HTTP transport as whole seconds, and is absent when the header is missing or is not a count", async () => {
    const answer = (header?: string) => new Response("{}", { status: 429, headers: header === undefined ? {} : { "retry-after": header } });
    const wait = async (header?: string) => {
      globalThis.fetch = vi.fn(async () => answer(header)) as unknown as typeof fetch;
      return (await createHttpTransport()("/auth/login")).retryAfterSeconds;
    };

    expect(await wait("60")).toBe(60);
    expect(await wait("2.2")).toBe(3);
    expect(await wait()).toBeNull();
    expect(await wait("Wed, 21 Oct 2026 07:28:00 GMT")).toBeNull();
    expect(await wait("0")).toBeNull();
    expect(await wait("-5")).toBeNull();
  });

  it("is read by the desktop bridge transport whatever case the header arrived in", async () => {
    const through = async (headers: Record<string, string>) =>
      (await createElectronTransport({ fetch: vi.fn(async () => ({ status: 503, headers, body: "{}" })) })("/auth/login")).retryAfterSeconds;

    expect(await through({ "retry-after": "5" })).toBe(5);
    expect(await through({ "Retry-After": "7" })).toBe(7);
    expect(await through({})).toBeNull();
  });
});

describe("createElectronTransport", () => {
  it("prepends a host so the bridge's Request() constructor accepts the path", async () => {
    const bridgeFetch = vi.fn(async (input: string) => {
      expect(input).toBe("http://mezan.local/items/ITEM-1");
      return { status: 200, headers: {}, body: JSON.stringify({ id: "ITEM-1" }) };
    });
    const transport = createElectronTransport({ fetch: bridgeFetch });

    const res = await transport("/items/ITEM-1", { method: "GET" });
    expect(bridgeFetch).toHaveBeenCalledWith("http://mezan.local/items/ITEM-1", { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    await expect(res.json()).resolves.toEqual({ id: "ITEM-1" });
  });

  /**
   * THE ONE THAT COST A NIGHT. `ApiContext.request` builds a real `Headers`
   * instance, and `contextBridge` structured-clones every argument into the
   * isolated world — where a `Headers` object, which has no own enumerable
   * properties, arrives as `{}`. `Authorization` was dropped on every desktop
   * request: sign in, get a 200 and a valid token, then watch every call come
   * back 401, which the renderer reads as an expired session and bounces you
   * back to the login screen. The browser build was fine throughout, because
   * `fetch` takes a `Headers` natively — so nothing short of running the
   * packaged app could see it.
   */
  it("flattens a Headers instance to a plain object, or the bridge drops every header", async () => {
    const bridgeFetch = vi.fn(async () => ({ status: 200, headers: {}, body: "{}" }));
    const transport = createElectronTransport({ fetch: bridgeFetch });

    const headers = new Headers();
    headers.set("authorization", "Bearer TOKEN-1");
    headers.set("x-branch-scope", "*");
    await transport("/items", { method: "GET", headers });

    expect(bridgeFetch).toHaveBeenCalledWith("http://mezan.local/items", {
      method: "GET",
      headers: { authorization: "Bearer TOKEN-1", "x-branch-scope": "*" },
    });
    // A plain object, not a Headers — that distinction IS the bug.
    const sent = bridgeFetch.mock.calls[0] as unknown as [string, { headers: unknown }];
    expect(sent[1].headers).not.toBeInstanceOf(Headers);
    expect(Object.keys(sent[1].headers as object)).toHaveLength(2);
  });

  it("passes a plain-object headers init through unchanged", async () => {
    const bridgeFetch = vi.fn(async () => ({ status: 200, headers: {}, body: "{}" }));
    const transport = createElectronTransport({ fetch: bridgeFetch });

    await transport("/items", { headers: { authorization: "Bearer TOKEN-2" } });

    expect(bridgeFetch).toHaveBeenCalledWith("http://mezan.local/items", {
      headers: { authorization: "Bearer TOKEN-2" },
    });
  });

  it("computes ok as false outside the 200-399 range", async () => {
    const bridgeFetch = vi.fn(async () => ({ status: 500, headers: {}, body: JSON.stringify({ error: "SERVER_ERROR" }) }));
    const transport = createElectronTransport({ fetch: bridgeFetch });

    const res = await transport("/boom");
    expect(res.status).toBe(500);
    expect(res.ok).toBe(false);
  });

  it("parses the IPC response body as JSON and echoes it as text", async () => {
    const bridgeFetch = vi.fn(async () => ({ status: 200, headers: {}, body: '{"a":1}' }));
    const transport = createElectronTransport({ fetch: bridgeFetch });

    const res = await transport("/x");
    await expect(res.json<{ a: number }>()).resolves.toEqual({ a: 1 });
    await expect(res.text()).resolves.toBe('{"a":1}');
  });
});

describe("resolveDefaultTransport", () => {
  const globalWithBridge = globalThis as { mezan?: { fetch: (input: string, init?: RequestInit) => Promise<{ status: number; headers: Record<string, string>; body: string }> } };
  const originalMezan = globalWithBridge.mezan;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete globalWithBridge.mezan;
  });

  afterEach(() => {
    globalWithBridge.mezan = originalMezan;
    globalThis.fetch = originalFetch;
  });

  it("picks the Electron bridge transport when window.mezan is present", async () => {
    const bridgeFetch = vi.fn(async () => ({ status: 200, headers: {}, body: "{}" }));
    globalWithBridge.mezan = { fetch: bridgeFetch };
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const transport = resolveDefaultTransport();
    await transport("/ping");

    expect(bridgeFetch).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the HTTP transport when no bridge is present", async () => {
    const fetchSpy = vi.fn(async (_input?: unknown, _init?: unknown) => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const transport = resolveDefaultTransport();
    await transport("/ping");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/ping");
  });
});
