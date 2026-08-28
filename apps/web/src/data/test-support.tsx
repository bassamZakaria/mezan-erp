import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { AppProviders } from "./AppProviders";
import type { Session } from "./session";
import type { Transport, TransportResponse } from "./transport";

export interface StubResult {
  status?: number;
  body: unknown;
}

/** A handler key segment of `*` matches any single path segment, e.g. a generated document id. */
function matchHandler(
  handlers: Record<string, (init: RequestInit | undefined, path: string) => StubResult>,
  key: string,
): ((init: RequestInit | undefined, path: string) => StubResult) | undefined {
  const exact = handlers[key];
  if (exact) return exact;
  const parts = key.split("/");
  for (const [pattern, handler] of Object.entries(handlers)) {
    if (!pattern.includes("*")) continue;
    const patternParts = pattern.split("/");
    if (patternParts.length !== parts.length) continue;
    if (patternParts.every((p, i) => p === "*" || p === parts[i])) return handler;
  }
  return undefined;
}

/**
 * A fake {@link Transport} for tests — maps `"METHOD /path"` (query string
 * stripped) to a canned response, so component tests exercise the real data
 * hooks without a live backend. A `*` path segment in a key matches any single
 * segment, for routes addressed by a generated id. Unmatched routes 404.
 */
export function stubTransport(
  handlers: Record<string, (init: RequestInit | undefined, path: string) => StubResult>,
): Transport {
  return (path, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${path.split("?")[0]}`;
    const handler = matchHandler(handlers, key);
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
  username: "tester",
  fullName: "محمد الشهابي",
  email: "admin@cyag.example",
  isCompanyAdmin: true,
  permissions: ["*"],
  roleCode: null,
  branchScope: "*",
  warehouseScope: "*",
  tenantName: "Cyag",
  token: "TEST-SESSION-TOKEN",
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
