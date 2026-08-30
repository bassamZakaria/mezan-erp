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
import { useFinancialReport } from "./financial-reports-hooks";

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

describe("useFinancialReport", () => {
  it("hits /financial-reports<apiPath> with non-blank params as a query string", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /financial-reports/trial-balance": (_init, path) => {
        seenPath = path;
        return { body: { rows: [{ accountId: "A1" }], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    const { result } = renderHook(
      () => useFinancialReport("trial-balance", "/trial-balance", { periodFrom: "2026-01-01", periodTo: "2026-01-31" }),
      { wrapper: makeWrapper(transport).Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/financial-reports/trial-balance?periodFrom=2026-01-01&periodTo=2026-01-31");
    expect(result.current.data?.rows).toEqual([{ accountId: "A1" }]);
  });

  it("drops blank param values from the query string", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /financial-reports/vat-return": (_init, path) => {
        seenPath = path;
        return { body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    const { result } = renderHook(
      () => useFinancialReport("vat-return", "/vat-return", { periodFrom: "2026-01-01", periodTo: "" }),
      { wrapper: makeWrapper(transport).Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/financial-reports/vat-return?periodFrom=2026-01-01");
  });

  it("returns an empty result cleanly", async () => {
    const transport = stubTransport({
      "GET /financial-reports/income-statement": () => ({
        body: { rows: [], groups: [], grandTotals: {}, reconciliation: null },
      }),
    });
    const { result } = renderHook(() => useFinancialReport("income-statement", "/income-statement", {}), {
      wrapper: makeWrapper(transport).Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rows).toEqual([]);
  });

  it("is disabled (no request fires) when options.enabled is false", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /financial-reports/balance-sheet": () => {
        called = true;
        return { body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    renderHook(() => useFinancialReport("balance-sheet", "/balance-sheet", {}, { enabled: false }), {
      wrapper: makeWrapper(transport).Wrapper,
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
  });

  it("surfaces a failure as an ApiError with the response status", async () => {
    const transport = stubTransport({
      "GET /financial-reports/balance-sheet": () => ({ status: 500, body: { error: "SERVER_ERROR" } }),
    });
    const { result } = renderHook(() => useFinancialReport("balance-sheet", "/balance-sheet", {}), {
      wrapper: makeWrapper(transport).Wrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.status).toBe(500);
  });

  it("keys the query by ['financial-reports', reportId, params] so two different reportIds never collide", async () => {
    const transport = stubTransport({
      "GET /financial-reports/a": () => ({ body: { rows: [1], groups: [], grandTotals: {}, reconciliation: null } }),
      "GET /financial-reports/b": () => ({ body: { rows: [2], groups: [], grandTotals: {}, reconciliation: null } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: a } = renderHook(() => useFinancialReport("report-a", "/a", {}), { wrapper: Wrapper });
    const { result: b } = renderHook(() => useFinancialReport("report-b", "/b", {}), { wrapper: Wrapper });
    await waitFor(() => expect(a.current.isSuccess && b.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["financial-reports", "report-a", {}])).toEqual({
      rows: [1],
      groups: [],
      grandTotals: {},
      reconciliation: null,
    });
    expect(queryClient.getQueryData(["financial-reports", "report-b", {}])).toEqual({
      rows: [2],
      groups: [],
      grandTotals: {},
      reconciliation: null,
    });
  });
});
