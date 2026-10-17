// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CurrentSecretRefusal } from "@mezan/contracts";
import type { TransportResponse } from "../data/transport";
import { PlatformApiProvider, usePlatformApi } from "./api";
import { stubPlatformTransport, testPlatformSession } from "./test-support";

function SessionAndRequestProbe({ path }: { path: string }) {
  const { session, request } = usePlatformApi();
  return (
    <div>
      <span data-testid="session">{session?.user.email ?? "none"}</span>
      <button type="button" onClick={() => void request(path)}>
        fire
      </button>
    </div>
  );
}

describe("PlatformApiProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sends the bearer token to the injected transport", async () => {
    const seen: { path: string; auth: string | null }[] = [];
    const transport = (path: string, init?: RequestInit): Promise<TransportResponse> => {
      seen.push({ path, auth: new Headers(init?.headers).get("authorization") });
      return Promise.resolve({ status: 200, ok: true, json: <T,>() => Promise.resolve({} as T), text: () => Promise.resolve("{}") });
    };
    render(
      <PlatformApiProvider transport={transport} initialSession={testPlatformSession}>
        <SessionAndRequestProbe path="/tenants" />
      </PlatformApiProvider>,
    );
    screen.getByRole("button", { name: "fire" }).click();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ path: "/tenants", auth: "Bearer TEST-PLATFORM-TOKEN" });
  });

  it("sends a cookie session's CSRF token instead of a bearer, and asks the server for cookies at sign-in", async () => {
    document.cookie = "mezan_platform_csrf=CSRF-1; path=/";
    const seen: { path: string; headers: Headers }[] = [];
    const transport = (path: string, init?: RequestInit): Promise<TransportResponse> => {
      seen.push({ path, headers: new Headers(init?.headers) });
      return Promise.resolve({ status: 200, ok: true, json: <T,>() => Promise.resolve({} as T), text: () => Promise.resolve("{}") });
    };
    render(
      <PlatformApiProvider transport={transport} initialSession={{ user: testPlatformSession.user }}>
        <SessionAndRequestProbe path="/tenants" />
      </PlatformApiProvider>,
    );
    screen.getByRole("button", { name: "fire" }).click();
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]?.headers.get("authorization")).toBeNull();
    expect(seen[0]?.headers.get("x-mezan-csrf")).toBe("CSRF-1");
    document.cookie = "mezan_platform_csrf=; path=/; max-age=0";
  });

  it("ends the session on the server when the operator signs out", async () => {
    const seen: string[] = [];
    const transport = (path: string, init?: RequestInit): Promise<TransportResponse> => {
      seen.push(`${init?.method ?? "GET"} ${path}`);
      return Promise.resolve({ status: 200, ok: true, json: <T,>() => Promise.resolve({} as T), text: () => Promise.resolve("{}") });
    };
    function SignOut() {
      const { session, endSession } = usePlatformApi();
      return (
        <button type="button" onClick={endSession}>
          {session ? "out" : "gone"}
        </button>
      );
    }
    render(
      <PlatformApiProvider transport={transport} initialSession={testPlatformSession}>
        <SignOut />
      </PlatformApiProvider>,
    );
    screen.getByRole("button", { name: "out" }).click();
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "gone" })).toBeInTheDocument());
    expect(seen).toEqual(["POST /auth/logout"]);
  });

  it("asks for the password again when the server wants a step-up, and resends the action once it is confirmed", async () => {
    const seen: string[] = [];
    let confirmed = false;
    const transport = (path: string, init?: RequestInit): Promise<TransportResponse> => {
      seen.push(`${init?.method ?? "GET"} ${path}`);
      const answer = (status: number, body: unknown): Promise<TransportResponse> =>
        Promise.resolve({ status, ok: status < 300, json: <T,>() => Promise.resolve(body as T), text: () => Promise.resolve(JSON.stringify(body)) });
      if (path === "/auth/step-up") {
        confirmed = JSON.parse(String(init?.body)).password === "correct horse";
        return confirmed ? answer(200, { ok: true }) : answer(403, { error: CurrentSecretRefusal.IncorrectPassword, message: "كلمة المرور غير صحيحة" });
      }
      return confirmed ? answer(200, {}) : answer(403, { error: "STEP_UP_REQUIRED", message: "أعد إدخال كلمة المرور" });
    };
    function Write() {
      const { request } = usePlatformApi();
      const [status, setStatus] = useState<number | null>(null);
      return (
        <button type="button" onClick={() => void request("/plans", { method: "POST", body: "{}" }).then((res) => setStatus(res.status))}>
          {status === null ? "write" : `done ${status}`}
        </button>
      );
    }
    render(
      <PlatformApiProvider transport={transport} initialSession={testPlatformSession}>
        <Write />
      </PlatformApiProvider>,
    );
    screen.getByRole("button", { name: "write" }).click();
    const dialog = await screen.findByRole("dialog");
    const password = dialog.querySelector("input[type=password]");
    expect(password).not.toBeNull();
    fireEvent.change(password!, { target: { value: "correct horse" } });
    fireEvent.submit(dialog);
    expect(await screen.findByRole("button", { name: "done 200" })).toBeInTheDocument();
    expect(seen).toEqual(["POST /plans", "POST /auth/step-up", "POST /plans"]);
  });

  it("hands a 403 that is not a step-up back whole — status, headers and body — and opens no dialog", async () => {
    let received: TransportResponse | null = null;
    const transport = (): Promise<TransportResponse> =>
      Promise.resolve({
        status: 403,
        ok: false,
        retryAfterSeconds: 7,
        json: <T,>() => Promise.resolve({ error: "FORBIDDEN" } as T),
        text: () => Promise.resolve(JSON.stringify({ error: "FORBIDDEN", message: "ممنوع" })),
        header: (name: string) => (name === "x-request-id" ? "r-1" : null),
      });
    function Probe() {
      const { request } = usePlatformApi();
      const [done, setDone] = useState(false);
      return (
        <button type="button" onClick={() => void request("/plans", { method: "POST", body: "{}" }).then((res) => { received = res; setDone(true); })}>
          {done ? "done" : "write"}
        </button>
      );
    }
    render(
      <PlatformApiProvider transport={transport} initialSession={testPlatformSession}>
        <Probe />
      </PlatformApiProvider>,
    );
    screen.getByRole("button", { name: "write" }).click();
    await screen.findByRole("button", { name: "done" });
    expect(screen.queryByRole("dialog")).toBeNull();
    const refusal = received as TransportResponse | null;
    expect(refusal?.status).toBe(403);
    expect(refusal?.retryAfterSeconds).toBe(7);
    expect(refusal?.header?.("x-request-id")).toBe("r-1");
    expect(await refusal?.json()).toEqual({ error: "FORBIDDEN", message: "ممنوع" });
  });

  it("keeps the session when the step-up password is wrong, and shows the refusal in the dialog", async () => {
    const answer = (status: number, body: unknown): Promise<TransportResponse> =>
      Promise.resolve({ status, ok: status < 300, json: <T,>() => Promise.resolve(body as T), text: () => Promise.resolve(JSON.stringify(body)) });
    const transport = (path: string): Promise<TransportResponse> =>
      path === "/auth/step-up"
        ? answer(403, { error: CurrentSecretRefusal.IncorrectPassword, message: "كلمة المرور غير صحيحة" })
        : answer(403, { error: "STEP_UP_REQUIRED", message: "أعد إدخال كلمة المرور" });
    render(
      <PlatformApiProvider transport={transport} initialSession={testPlatformSession}>
        <SessionAndRequestProbe path="/plans" />
      </PlatformApiProvider>,
    );
    screen.getByRole("button", { name: "fire" }).click();
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("input[type=password]")!, { target: { value: "wrong" } });
    fireEvent.submit(dialog);
    expect(await screen.findByText("كلمة المرور غير صحيحة")).toBeInTheDocument();
    expect(screen.getByTestId("session")).toHaveTextContent("owner@mezan.example");
  });

  it("clears the session when any request comes back 401", async () => {
    const transport = stubPlatformTransport({ "GET /tenants": () => ({ status: 401, body: { error: "UNAUTHENTICATED" } }) });
    render(
      <PlatformApiProvider transport={transport} initialSession={testPlatformSession}>
        <SessionAndRequestProbe path="/tenants" />
      </PlatformApiProvider>,
    );
    expect(screen.getByTestId("session")).toHaveTextContent("owner@mezan.example");
    screen.getByRole("button", { name: "fire" }).click();
    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("none"));
    expect(localStorage.getItem("mezan.platform.session")).toBeNull();
  });

  it("empties the query cache when the session expires, exactly as signing out does, so a PIN shown once does not stay in memory", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["platform", "ownerPinReset", "PU-1", "tenant-1"], { adminEmail: "owner@acme.test", adminPin: "305917" });
    queryClient.setQueryDefaults(["platform", "ownerPinReset"], { gcTime: Infinity });
    const transport = stubPlatformTransport({ "GET /tenants": () => ({ status: 401, body: { error: "UNAUTHENTICATED" } }) });
    render(
      <QueryClientProvider client={queryClient}>
        <PlatformApiProvider transport={transport} initialSession={testPlatformSession}>
          <SessionAndRequestProbe path="/tenants" />
        </PlatformApiProvider>
      </QueryClientProvider>,
    );
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);

    screen.getByRole("button", { name: "fire" }).click();

    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("none"));
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
  });

  it("keeps the query cache on a 401 from the login path itself", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["platform", "plans"], []);
    const transport = stubPlatformTransport({ "GET /auth/login": () => ({ status: 401, body: { error: "INVALID_CREDENTIALS" } }) });
    render(
      <QueryClientProvider client={queryClient}>
        <PlatformApiProvider transport={transport} initialSession={testPlatformSession}>
          <SessionAndRequestProbe path="/auth/login" />
        </PlatformApiProvider>
      </QueryClientProvider>,
    );

    screen.getByRole("button", { name: "fire" }).click();

    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("owner@mezan.example"));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("does not clear the session on a 401 from the login path itself", async () => {
    const transport = stubPlatformTransport({
      "GET /auth/login": () => ({ status: 401, body: { error: "INVALID_CREDENTIALS" } }),
    });
    render(
      <PlatformApiProvider transport={transport} initialSession={testPlatformSession}>
        <SessionAndRequestProbe path="/auth/login" />
      </PlatformApiProvider>,
    );
    screen.getByRole("button", { name: "fire" }).click();
    await vi.waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("owner@mezan.example"));
  });

  it("without an injected transport, reaches /api/platform/* over fetch with the bearer header", async () => {
    const fetchSpy = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      render(
        <PlatformApiProvider initialSession={testPlatformSession}>
          <SessionAndRequestProbe path="/tenants" />
        </PlatformApiProvider>,
      );
      screen.getByRole("button", { name: "fire" }).click();
      await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      const call = fetchSpy.mock.calls[0];
      if (!call) throw new Error("fetch was not called");
      const [url, init] = call;
      expect(url).toMatch(/^\/api\/platform\//);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer TEST-PLATFORM-TOKEN");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
