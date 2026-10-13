import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppI18nProvider } from "../i18n";
import type { Transport, TransportResponse } from "../data/transport";
import { PlatformApiProvider } from "./api";
import type { PlatformSession } from "./session";

export interface PlatformStubResult {
  status?: number;
  body: unknown;
}

/** A fake {@link Transport} for platform tests — maps `"METHOD /path"` to a canned response. */
export function stubPlatformTransport(
  handlers: Record<string, (init: RequestInit | undefined, path: string) => PlatformStubResult>,
): Transport {
  return (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${path.split("?")[0]}`;
    const handler = handlers[key];
    const result: PlatformStubResult = handler ? handler(init, path) : { status: 404, body: { error: "NOT_FOUND" } };
    const status = result.status ?? 200;
    const response: TransportResponse = {
      status,
      ok: status >= 200 && status < 400,
      json: <T,>() => Promise.resolve(result.body as T),
      text: () => Promise.resolve(JSON.stringify(result.body)),
    };
    return Promise.resolve(response);
  };
}

export const testPlatformSession: PlatformSession = {
  token: "TEST-PLATFORM-TOKEN",
  user: { id: "PU-1", email: "owner@mezan.example", role: "owner" },
};

export function renderWithPlatformProviders(
  ui: ReactElement,
  options: {
    transport?: Transport;
    initialSession?: PlatformSession | null;
    route?: string;
  } = {},
): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "/platform/*", element: ui }], { initialEntries: [options.route ?? "/platform"] });
  return render(
    <AppI18nProvider>
      <QueryClientProvider client={queryClient}>
        <PlatformApiProvider transport={options.transport} initialSession={options.initialSession ?? null}>
          {/* Mirrors the real mount (`router/routes.tsx`'s `/platform/*`), so a
              component that renders its own nested `<Routes>` (e.g.
              `PlatformShell`) resolves relative paths against `/platform`
              instead of the router's actual root. */}
          <RouterProvider router={router} />
        </PlatformApiProvider>
      </QueryClientProvider>
    </AppI18nProvider>,
  );
}
