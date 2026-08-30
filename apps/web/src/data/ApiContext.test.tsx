// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiProvider, useApi } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { testAdminSession } from "./test-support";
import type { Session } from "./session";

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
