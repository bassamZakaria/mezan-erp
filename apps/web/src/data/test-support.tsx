import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { AppProviders } from "./AppProviders";
import type { Session } from "./session";
import type { Transport, TransportResponse } from "./transport";

export interface StubResult {
  status?: number;
  body: unknown;
}

/**
 * A fake {@link Transport} for tests — maps `"METHOD /path"` (query string
 * stripped) to a canned response, so component tests exercise the real data
 * hooks without a live backend. Unmatched routes 404.
 */
export function stubTransport(
  handlers: Record<string, (init: RequestInit | undefined, path: string) => StubResult>,
): Transport {
  return (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${path.split("?")[0]}`;
    const handler = handlers[key];
    const result: StubResult = handler ? handler(init, path) : { status: 404, body: { error: "NOT_FOUND" } };
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

/** A ready-made admin session for tests that render behind the login gate. */
export const testAdminSession: Session = {
  userId: "USER-ADMIN",
  fullName: "محمد الشهابي",
  email: "admin@cyag.example",
  isCompanyAdmin: true,
  permissions: ["*"],
  branchScope: "*",
  warehouseScope: "*",
  tenantName: "Cyag",
};

export function renderWithProviders(
  ui: ReactElement,
  options: { transport?: Transport; initialSession?: Session | null } = {},
): RenderResult {
  return render(
    <AppProviders transport={options.transport} initialSession={options.initialSession ?? null}>
      {ui}
    </AppProviders>,
  );
}
