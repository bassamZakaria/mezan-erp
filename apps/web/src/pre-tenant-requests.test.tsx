// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppLayout } from "./AppLayout";
import { AppProviders } from "./data/AppProviders";
import { clearTenantCode, persistSession, persistTenantCode } from "./data/session";
import type { Transport } from "./data/transport";

const TENANT_SCOPED = ["/bootstrap/status", "/entitlements"];

function signedOutShell(resolve: { status: number; body: unknown }) {
  const asked: string[] = [];
  const transport: Transport = (path) => {
    const bare = path.split("?")[0] ?? path;
    asked.push(bare);
    const reply =
      bare === "/platform/resolve"
        ? resolve
        : bare === "/bootstrap/status"
          ? { status: 200, body: { adminExists: true } }
          : bare === "/entitlements"
            ? { status: 200, body: { plan: "pro", activeModules: [], features: {}, seats: 5, expiresAt: null } }
            : { status: 200, body: [] };
    return Promise.resolve({ status: reply.status, ok: reply.status < 400, json: <T,>() => Promise.resolve(reply.body as T), text: () => Promise.resolve(JSON.stringify(reply.body)), headers: new Headers() } as Awaited<ReturnType<Transport>>);
  };
  const router = createMemoryRouter([{ path: "/", Component: AppLayout, children: [{ path: "*", element: <div /> }] }], { initialEntries: ["/dashboard"] });
  render(
    <AppProviders transport={transport} initialSession={null}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return asked;
}

describe("the sign-in screen asks nothing of a company before it knows which company it is", () => {
  afterEach(() => {
    persistSession(null);
    clearTenantCode();
  });

  it("on a shared address with no company code typed it sends neither tenant-scoped request, and sends both once the code is confirmed", async () => {
    const asked = signedOutShell({ status: 200, body: { mode: "code", exists: false } });
    await waitFor(() => expect(asked).toContain("/platform/resolve"));
    await new Promise((settled) => setTimeout(settled, 50));
    expect(asked.filter((path) => TENANT_SCOPED.includes(path))).toEqual([]);

    act(() => persistTenantCode("demo"));

    await waitFor(() => expect(TENANT_SCOPED.filter((path) => !asked.includes(path))).toEqual([]));
  });

  it("on a company's own address it sends both as soon as the address is known to be a company", async () => {
    const asked = signedOutShell({ status: 200, body: { mode: "subdomain", exists: true } });
    await waitFor(() => expect(TENANT_SCOPED.filter((path) => !asked.includes(path))).toEqual([]));
    expect(asked.indexOf("/platform/resolve")).toBeLessThan(asked.indexOf("/bootstrap/status"));
  });

  it("on a LAN or desktop install, where no platform stands in front and there is no company code at all, it sends both", async () => {
    const asked = signedOutShell({ status: 404, body: { error: "NOT_FOUND" } });
    await waitFor(() => expect(TENANT_SCOPED.filter((path) => !asked.includes(path))).toEqual([]));
  });
});
