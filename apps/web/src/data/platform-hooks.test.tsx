// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { stubTransport, testAdminSession } from "./test-support";
import type { Transport } from "./transport";
import { useAuditLog, useResetSequenceCounter, useSequences, useUpdateSequence } from "./platform-hooks";
import { ApiError } from "./hooks";

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

describe("useSequences", () => {
  it("requests /sequences and returns the effective definitions", async () => {
    const transport = stubTransport({ "GET /sequences": () => ({ body: [{ code: "SI", nextNumber: 1042 }] }) });
    const { result } = renderHook(() => useSequences(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ code: "SI", nextNumber: 1042 }]);
  });

  it("surfaces a failure as an ApiError", async () => {
    const transport = stubTransport({ "GET /sequences": () => ({ status: 500, body: {} }) });
    const { result } = renderHook(() => useSequences(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

describe("useUpdateSequence", () => {
  it("PATCHes /sequences/:code with the patch body and invalidates ['sequences'] — matches useSequences' own key", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    const transport = stubTransport({
      "PATCH /sequences/SI": (init, path) => {
        seenPath = path;
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { code: "SI", prefix: "INV-" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateSequence(), { wrapper: Wrapper });
    result.current.mutate({ code: "SI", patch: { prefix: "INV-" } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/sequences/SI");
    expect(seenBody).toEqual({ prefix: "INV-" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sequences"] });
  });
});

describe("useResetSequenceCounter", () => {
  it("posts to /sequences/:code/counter and invalidates ['sequences']", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /sequences/SI/counter": (init, path) => {
        seenPath = path;
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { code: "SI", nextNumber: 2000 } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useResetSequenceCounter(), { wrapper: Wrapper });
    result.current.mutate({ code: "SI", body: { nextNumber: 2000 } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/sequences/SI/counter");
    expect(seenBody).toEqual({ nextNumber: 2000 });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sequences"] });
  });

  it("surfaces the server's guard refusal (can't reset below the current counter) verbatim", async () => {
    const transport = stubTransport({
      "POST /sequences/SI/counter": () => ({ status: 400, body: { message: "لا يمكن تقليل الرقم التالي عن القيمة الحالية" } }),
    });
    const { result } = renderHook(() => useResetSequenceCounter(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ code: "SI", body: { nextNumber: 1 } as never });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("لا يمكن تقليل الرقم التالي عن القيمة الحالية");
  });
});

describe("useAuditLog", () => {
  it("builds the query string from every recognised filter field", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /audit": (_init, path) => {
        seenPath = path;
        return { body: { rows: [], total: 0 } };
      },
    });
    const { result } = renderHook(
      () => useAuditLog({ stream: "security", module: "sales", action: "create", severity: "INFO", limit: 50, offset: 0 }),
      { wrapper: makeWrapper(transport).Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/audit?stream=security&module=sales&action=create&severity=INFO&limit=50");
  });

  it("omits the query string entirely for an empty filter", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /audit": (_init, path) => {
        seenPath = path;
        return { body: { rows: [], total: 0 } };
      },
    });
    const { result } = renderHook(() => useAuditLog(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/audit");
  });

  it("keys the query by ['audit', filter] so two different filters don't share a cache entry", async () => {
    const transport = stubTransport({ "GET /audit": () => ({ body: { rows: [], total: 0 } }) });
    const { Wrapper, queryClient } = makeWrapper(transport);
    renderHook(() => useAuditLog({ module: "sales" }), { wrapper: Wrapper });
    renderHook(() => useAuditLog({ module: "purchases" }), { wrapper: Wrapper });
    await waitFor(() => {
      expect(queryClient.getQueryData(["audit", { module: "sales" }])).toBeDefined();
      expect(queryClient.getQueryData(["audit", { module: "purchases" }])).toBeDefined();
    });
  });
});
