// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
