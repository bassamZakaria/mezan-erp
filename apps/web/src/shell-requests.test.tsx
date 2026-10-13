// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { SHELL_REQUESTS, ShellRequest } from "@mezan/domain";
import { AppLayout } from "./AppLayout";
import { AppProviders } from "./data/AppProviders";
import { useSettings } from "./data/hooks";
import { persistSession, sessionHolds, type Session } from "./data/session";
import { testAdminSession } from "./data/test-support";
import type { Transport } from "./data/transport";

const ALL_SHELL_PERMISSIONS = [...new Set(Object.values(SHELL_REQUESTS).map((request) => request.permission))];

const BODIES: Record<string, unknown> = {
  "/entitlements": { plan: "pro", activeModules: ["dashboard", "sales", "admin", "hr", "workflow", "notifications"], features: {}, seats: 10, expiresAt: null },
  "/workflow/requests/pending-count": { count: 0 },
  "/notifications/unread-count": { count: 0 },
  "/settings": { language: "ar", dateNumerals: "western" },
  "/settings/display": { language: "ar", dateNumerals: "western" },
  "/billing/subscription": null,
};

function recordingTransport(session: Session): { transport: Transport; asked: string[] } {
  const asked: string[] = [];
  const refusedFor = new Set(Object.values(SHELL_REQUESTS).filter((request) => !sessionHolds(session, request.permission)).map((request) => request.path));
  const transport: Transport = (path) => {
    const bare = path.split("?")[0] ?? path;
    asked.push(bare);
    const status = refusedFor.has(bare) ? 403 : 200;
    const body = status === 403 ? { error: "FORBIDDEN" } : bare in BODIES ? BODIES[bare] : [];
    return Promise.resolve({ status, ok: status === 200, json: <T,>() => Promise.resolve(body as T), text: () => Promise.resolve(JSON.stringify(body)), headers: new Headers() } as Awaited<ReturnType<Transport>>);
  };
  return { transport, asked };
}

function ScreenReadingSettings() {
  useSettings();
  return <div data-testid="screen" />;
}

function renderShell(session: Session) {
  const recorded = recordingTransport(session);
  const router = createMemoryRouter([{ path: "/", Component: AppLayout, children: [{ path: "*", element: <ScreenReadingSettings /> }] }], { initialEntries: ["/dashboard"] });
  render(
    <AppProviders transport={recorded.transport} initialSession={session}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return recorded;
}

const restricted = (permissions: string[]): Session => ({ ...testAdminSession, userId: "USER-RESTRICTED", isCompanyAdmin: false, permissions, roleCode: "RESTRICTED" });

describe("the shell asks only for what the session may read", () => {
  afterEach(() => persistSession(null));

  it.each(Object.values(ShellRequest))("a session without the permission behind «%s» never sends it, and still sends the rest", async (request) => {
    const { path, permission } = SHELL_REQUESTS[request];
    const session = restricted(ALL_SHELL_PERMISSIONS.filter((held) => held !== permission));
    const { asked } = renderShell(session);
    const stillAllowed = Object.values(SHELL_REQUESTS).filter((other) => other.permission !== permission).map((other) => other.path);

    await waitFor(() => expect(stillAllowed.filter((allowed) => !asked.includes(allowed))).toEqual([]));

    expect(asked).not.toContain(path);
  });

  it("a session with no shell permission at all is refused nothing, because it asks for none of them", async () => {
    const session = restricted(["sales.invoice.view_own"]);
    const { asked } = renderShell(session);

    await waitFor(() => expect(asked).toContain("/profile"));
    await waitFor(() => expect(asked).toContain("/notifications/unread-count"));

    const shellPaths = Object.values(SHELL_REQUESTS).map((request) => request.path);
    expect(asked.filter((path) => shellPaths.includes(path))).toEqual([]);
  });

  it("the administrator still gets every one of them", async () => {
    const { asked } = renderShell(testAdminSession);
    const shellPaths = Object.values(SHELL_REQUESTS).map((request) => request.path);

    await waitFor(() => expect(shellPaths.filter((path) => !asked.includes(path))).toEqual([]));
  });

  it("a role that may read roles but not settings asks for the roles and for neither the settings nor the subscription", async () => {
    const { asked } = renderShell(restricted(["admin.roles.view"]));

    await waitFor(() => expect(asked).toContain("/roles"));
    await waitFor(() => expect(asked).toContain("/notifications/unread-count"));

    expect(asked).not.toContain("/settings");
    expect(asked).not.toContain("/billing/subscription");
  });

  it("a role that may read settings but not roles asks for the settings and the subscription, and not for the roles", async () => {
    const { asked } = renderShell(restricted(["admin.settings.view"]));

    await waitFor(() => expect(asked).toContain("/settings"));
    await waitFor(() => expect(asked).toContain("/billing/subscription"));

    expect(asked).not.toContain("/roles");
  });
});
