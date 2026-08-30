// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiProvider, useApi } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { stubTransport, testAdminSession } from "./test-support";
import { sessionExpiredPending, type Session } from "./session";

const STORAGE_KEY = "mezan.session";

function Probe() {
  const { session, setSession } = useApi();
  return (
    <div>
      <span data-testid="session-id">{session?.userId ?? "none"}</span>
      <button onClick={() => setSession(testAdminSession)}>login</button>
      <button onClick={() => setSession(null)}>logout</button>
    </div>
  );
}

/**
 * `ApiProvider` reads `useQueryClient()` (to invalidate on scope changes and
 * to publish the loader bridge), so it must be rendered inside a
 * `QueryClientProvider` even in these unit tests that talk to `ApiProvider`
 * directly rather than through `AppProviders`.
 */
function renderWithQueryClient(children: ReactNode, initialSession?: Session | null) {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider initialSession={initialSession}>{children}</ApiProvider>
    </QueryClientProvider>,
  );
}

describe("ApiProvider session persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("restores a persisted session on mount when no initialSession is given (survives a page refresh)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(testAdminSession));

    renderWithQueryClient(<Probe />);

    expect(screen.getByTestId("session-id")).toHaveTextContent("USER-ADMIN");
  });

  it("ignores persisted storage when initialSession is explicitly null (test isolation)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(testAdminSession));

    renderWithQueryClient(<Probe />, null);

    expect(screen.getByTestId("session-id")).toHaveTextContent("none");
  });

  it("ignores a corrupt/invalid stored value and starts signed out", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");

    renderWithQueryClient(<Probe />);

    expect(screen.getByTestId("session-id")).toHaveTextContent("none");
  });

  it("persists the session on setSession, and a remount (simulated reload) restores it", () => {
    const { unmount } = renderWithQueryClient(<Probe />, null);

    fireEvent.click(screen.getByText("login"));
    expect(screen.getByTestId("session-id")).toHaveTextContent("USER-ADMIN");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toMatchObject({ userId: "USER-ADMIN" });

    unmount();

    renderWithQueryClient(<Probe />);
    expect(screen.getByTestId("session-id")).toHaveTextContent("USER-ADMIN");
  });

  it("clears the persisted session on logout (setSession(null))", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(testAdminSession));

    renderWithQueryClient(<Probe />);
    expect(screen.getByTestId("session-id")).toHaveTextContent("USER-ADMIN");

    fireEvent.click(screen.getByText("logout"));

    expect(screen.getByTestId("session-id")).toHaveTextContent("none");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

/** Fires `request(path)` on click and records the status it resolved with, so `request`'s 401-handling side effects can be observed. */
function RequestProbe({ path }: { path: string }) {
  const { session, request } = useApi();
  return (
    <div>
      <span data-testid="session-id">{session?.userId ?? "none"}</span>
      <button onClick={() => void request(path)}>call</button>
    </div>
  );
}

function renderRequestProbe(path: string, transport: ReturnType<typeof stubTransport>, initialSession: Session | null = testAdminSession) {
  const queryClient = createQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider transport={transport} initialSession={initialSession}>
        <RequestProbe path={path} />
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("ApiProvider request() — 401 session expiry", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("a 401 on a normal endpoint, while signed in, marks the session expired, signs the user out and clears every cached answer", async () => {
    const transport = stubTransport({ "GET /items": () => ({ status: 401, body: { message: "غير مصرح" } }) });
    const { queryClient } = renderRequestProbe("/items", transport);
    const clearSpy = vi.spyOn(queryClient, "clear");

    expect(sessionExpiredPending()).toBe(false);
    fireEvent.click(screen.getByText("call"));

    await screen.findByText("none");
    expect(sessionExpiredPending()).toBe(true);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("a 403 (a real permission refusal) does NOT sign the user out or touch the cache — only 401 means the session itself is gone", async () => {
    const transport = stubTransport({ "GET /items": () => ({ status: 403, body: { message: "لا تملك صلاحية" } }) });
    const { queryClient } = renderRequestProbe("/items", transport);
    const clearSpy = vi.spyOn(queryClient, "clear");

    fireEvent.click(screen.getByText("call"));
    await new Promise((r) => setTimeout(r, 10));

    expect(screen.getByTestId("session-id")).toHaveTextContent("USER-ADMIN");
    expect(sessionExpiredPending()).toBe(false);
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("a 401 from the login endpoint itself does not sign anyone out — it is the login screen's own wrong-PIN refusal, not an expired session", async () => {
    const transport = stubTransport({ "GET /auth/login": () => ({ status: 401, body: { message: "رمز خاطئ" } }) });
    const { queryClient } = renderRequestProbe("/auth/login", transport);
    const clearSpy = vi.spyOn(queryClient, "clear");

    fireEvent.click(screen.getByText("call"));
    await new Promise((r) => setTimeout(r, 10));

    expect(screen.getByTestId("session-id")).toHaveTextContent("USER-ADMIN");
    expect(sessionExpiredPending()).toBe(false);
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("a 401 while already signed out does nothing — there is no session to expire", async () => {
    const transport = stubTransport({ "GET /items": () => ({ status: 401, body: {} }) });
    const { queryClient } = renderRequestProbe("/items", transport, null);
    const clearSpy = vi.spyOn(queryClient, "clear");

    fireEvent.click(screen.getByText("call"));
    await new Promise((r) => setTimeout(r, 10));

    expect(sessionExpiredPending()).toBe(false);
    expect(clearSpy).not.toHaveBeenCalled();
  });
});
