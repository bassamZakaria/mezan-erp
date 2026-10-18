// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiProvider, useApi } from "./ApiContext";
import { AppI18nProvider } from "../i18n";
import { createQueryClient } from "./queryClient";
import { stubTransport, testAdminSession } from "./test-support";
import { SessionRefusal } from "@mezan/contracts";
import { SignInNotice, pendingSignInNotice, sessionExpiredPending, type Session } from "./session";

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
    <AppI18nProvider>
      <QueryClientProvider client={queryClient}>
        <ApiProvider transport={transport} initialSession={initialSession}>
          <RequestProbe path={path} />
        </ApiProvider>
      </QueryClientProvider>
    </AppI18nProvider>,
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

  it("a 401 that says another user signed in on this device signs the user out with that reason, not as an expired session", async () => {
    const transport = stubTransport({
      "GET /items": () => ({ status: 401, sessionEnded: "displaced", body: { error: "SESSION_DISPLACED", message: "سجّل مستخدم آخر الدخول على هذا الجهاز" } }),
    });
    renderRequestProbe("/items", transport);

    fireEvent.click(screen.getByText("call"));

    await screen.findByText("none");
    expect(pendingSignInNotice()).toBe(SignInNotice.SignedInElsewhere);
    expect(sessionExpiredPending()).toBe(false);
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

  it("a 403 saying the session belongs to another company keeps the user signed in and their cache", async () => {
    const transport = stubTransport({
      "GET /items": () => ({ status: 403, body: { error: SessionRefusal.TenantMismatch, message: "جلستك الحالية تخص شركة أخرى." } }),
    });
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

/**
 * The topbar's working-branch/warehouse picker narrows what the user is
 * LOOKING AT. It is not a narrowing of what they may DO — and once the stock
 * write paths enforce warehouse scope as authority (D103), sending it on a
 * write refuses moves the user is entitled to make: a transfer names two
 * warehouses and the picker can only name one.
 */
describe("ApiProvider request() — the topbar narrowing rides on reads only", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  function ScopeProbe({ path }: { path: string }) {
    const { request, setScopeSelection } = useApi();
    return (
      <div>
        <button onClick={() => setScopeSelection({ branchId: "BR-CAIRO", warehouseId: "W1" })}>narrow</button>
        <button onClick={() => void request(path)}>read</button>
        <button onClick={() => void request(path, { method: "POST", body: "{}" })}>write</button>
      </div>
    );
  }

  function renderScopeProbe() {
    const seen: { method: string; warehouse: string | null; branch: string | null }[] = [];
    const transport = (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({
        method: (init?.method ?? "GET").toUpperCase(),
        warehouse: headers.get("x-warehouse-scope"),
        branch: headers.get("x-branch-scope"),
      });
      void path;
      return Promise.resolve({ status: 200, ok: true, json: <T,>() => Promise.resolve({} as T), text: () => Promise.resolve("{}") });
    };
    const queryClient = createQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ApiProvider transport={transport} initialSession={testAdminSession}>
          <ScopeProbe path="/inventory/transfers" />
        </ApiProvider>
      </QueryClientProvider>,
    );
    return seen;
  }

  it("a GET carries the picked warehouse, and a POST carries the session's full grant instead", async () => {
    const seen = renderScopeProbe();
    fireEvent.click(screen.getByText("narrow"));

    fireEvent.click(screen.getByText("read"));
    await new Promise((r) => setTimeout(r, 10));
    fireEvent.click(screen.getByText("write"));
    await new Promise((r) => setTimeout(r, 10));

    const read = seen.find((r) => r.method === "GET");
    const write = seen.find((r) => r.method === "POST");
    expect(read?.warehouse).toBe("W1");
    expect(read?.branch).toBe("BR-CAIRO");
    // testAdminSession holds the all-scope sentinel, so the write is unnarrowed.
    expect(write?.warehouse).toBe("*");
    expect(write?.branch).toBe("*");
  });
});

describe("ApiProvider request() — the PIN asked for again after the session's address moved", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  const STEP_UP = { status: 403, body: { error: "STEP_UP_REQUIRED", message: "تغيّر عنوان اتصالك منذ تسجيل الدخول. أعد إدخال رمز PIN لتأكيد هذا الإجراء." } };

  it("asks for the PIN in a dialog, confirms it with the server, and sends the original request once more", async () => {
    let calls = 0;
    let confirmedPin: unknown = null;
    const transport = stubTransport({
      "GET /items": () => {
        calls += 1;
        return calls === 1 ? STEP_UP : { body: [] };
      },
      "POST /auth/step-up": (init) => {
        confirmedPin = JSON.parse((init?.body as string) ?? "{}");
        return { body: { ok: true } };
      },
    });
    renderRequestProbe("/items", transport);
    fireEvent.click(screen.getByText("call"));

    const dialog = await screen.findByRole("dialog", { name: "تأكيد رمز PIN" });
    expect(dialog).toHaveTextContent("تغيّر عنوان اتصالك");
    fireEvent.change(screen.getByLabelText("رمز PIN"), { target: { value: "135790" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد" }));

    await waitFor(() => expect(calls).toBe(2));
    expect(confirmedPin).toEqual({ pin: "135790" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("session-id")).toHaveTextContent("USER-ADMIN");
  });

  it("shows the server's refusal for a wrong PIN and keeps the dialog open; cancelling hands the 403 back to the screen", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /items": () => {
        calls += 1;
        return STEP_UP;
      },
      "POST /auth/step-up": () => ({ status: 401, body: { error: "INVALID_CREDENTIALS", message: "رمز PIN غير صحيح." } }),
    });
    renderRequestProbe("/items", transport);
    fireEvent.click(screen.getByText("call"));

    await screen.findByRole("dialog", { name: "تأكيد رمز PIN" });
    fireEvent.change(screen.getByLabelText("رمز PIN"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "تأكيد" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("رمز PIN غير صحيح.");

    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls).toBe(1);
    expect(screen.getByTestId("session-id")).toHaveTextContent("USER-ADMIN");
  });

  it("asks the server for a cookie-kept device secret when signing in", async () => {
    let binding: string | null = null;
    const transport = stubTransport({
      "GET /auth/login": (init) => {
        binding = new Headers(init?.headers).get("x-mezan-device-binding");
        return { status: 401, body: { message: "x" } };
      },
    });
    renderRequestProbe("/auth/login", transport, null);
    fireEvent.click(screen.getByText("call"));
    await waitFor(() => expect(binding).toBe("cookie"));
  });
});
