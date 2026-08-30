// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { stubTransport, testAdminSession } from "./test-support";
import type { Transport } from "./transport";
import { useReport } from "./reports-hooks";

function makeWrapper(transport: Transport, session = testAdminSession) {
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppI18nProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider transport={transport} initialSession={session}>
            {children}
          </ApiProvider>
        </QueryClientProvider>
      </AppI18nProvider>
    );
  }
  return { Wrapper, queryClient };
}

describe("useReport", () => {
  it("hits /reports<apiPath> with non-blank params as a query string, keyed by ['reports', apiRoot, reportId, params]", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /reports/sales/by-item": (_init, path) => {
        seenPath = path;
        return { body: { rows: [{ itemId: "I1" }], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result } = renderHook(() => useReport("sales-by-item", "/sales/by-item", { dateFrom: "2026-01-01", dateTo: "" }), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/reports/sales/by-item?dateFrom=2026-01-01");
    expect(result.current.data?.rows).toEqual([{ itemId: "I1" }]);
    expect(queryClient.getQueryData(["reports", "/reports", "sales-by-item", { dateFrom: "2026-01-01", dateTo: "" }])).toBeDefined();
  });

  it("returns an empty rows array cleanly", async () => {
    const transport = stubTransport({
      "GET /reports/inventory/aging": () => ({ body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } }),
    });
    const { result } = renderHook(() => useReport("inventory-aging", "/inventory/aging", {}), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows).toEqual([]);
  });

  it("respects a custom apiRoot instead of the default /reports mount", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /custom-root/foo": (_init, path) => {
        seenPath = path;
        return { body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    const { result } = renderHook(() => useReport("foo", "/foo", {}, { apiRoot: "/custom-root" }), {
      wrapper: makeWrapper(transport).Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/custom-root/foo");
  });

  it("is disabled (no request) when options.enabled is false", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /reports/x": () => {
        called = true;
        return { body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    renderHook(() => useReport("x", "/x", {}, { enabled: false }), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
  });

  it("surfaces a failure as an ApiError with the response status", async () => {
    const transport = stubTransport({ "GET /reports/y": () => ({ status: 500, body: {} }) });
    const { result } = renderHook(() => useReport("y", "/y", {}), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(500);
  });
});
