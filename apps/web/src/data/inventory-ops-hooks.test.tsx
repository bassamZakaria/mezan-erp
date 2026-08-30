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
import {
  useAdjustmentJournalEntry,
  useCancelPhysicalCount,
  useCompletePhysicalCount,
  useCreateStockAdjustment,
  useCreateStockTransfer,
  useGenerateAdjustmentFromCount,
  usePhysicalCounts,
  useRecordPhysicalCounts,
  useStartPhysicalCount,
  useStockAdjustments,
  useStockBalance,
  useStockTransfers,
} from "./inventory-ops-hooks";
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

describe("useStockBalance", () => {
  it("requests /inventory/stock-balance without a warehouse filter and unwraps the rows envelope", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /inventory/stock-balance": (_init, path) => {
        seenPath = path;
        return { body: { rows: [{ itemId: "I1" }] } };
      },
    });
    const { result } = renderHook(() => useStockBalance(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/inventory/stock-balance");
    expect(result.current.data).toEqual([{ itemId: "I1" }]);
  });

  it("appends the warehouseId filter when given", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /inventory/stock-balance": (_init, path) => {
        seenPath = path;
        return { body: { rows: [] } };
      },
    });
    const { result } = renderHook(() => useStockBalance("WH-1"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/inventory/stock-balance?warehouseId=WH-1");
  });
});

describe("useStockAdjustments / useCreateStockAdjustment", () => {
  it("lists adjustments, optionally filtered by status", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /inventory/stock-adjustments": (_init, path) => {
        seenPath = path;
        return { body: [] };
      },
    });
    const { result } = renderHook(() => useStockAdjustments("confirmed"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/inventory/stock-adjustments?status=confirmed");
  });

  it("creates a draft then immediately confirms it, and invalidates both stock-adjustments and stock-balance", async () => {
    let draftBody: unknown = null;
    let confirmCalled = false;
    const transport = stubTransport({
      "POST /inventory/stock-adjustments/draft": (init) => {
        draftBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { id: "ADJ-1" } };
      },
      "POST /inventory/stock-adjustments/ADJ-1/confirm": () => {
        confirmCalled = true;
        return { body: { document: { id: "ADJ-1", status: "confirmed" }, held: false } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateStockAdjustment(), { wrapper: Wrapper });
    result.current.mutate({ warehouseId: "WH-1", lines: [] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(draftBody).toEqual({ warehouseId: "WH-1", lines: [] });
    expect(confirmCalled).toBe(true);
    expect(result.current.data).toEqual({ id: "ADJ-1", status: "confirmed" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inventory", "stock-adjustments"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inventory", "stock-balance"] });
  });

  it("fails without ever confirming when the draft itself is refused", async () => {
    let confirmCalled = false;
    const transport = stubTransport({
      "POST /inventory/stock-adjustments/draft": () => ({ status: 400, body: { message: "لا توجد أسطر في التسوية" } }),
      "POST /inventory/stock-adjustments/*/confirm": () => {
        confirmCalled = true;
        return { body: {} };
      },
    });
    const { result } = renderHook(() => useCreateStockAdjustment(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ warehouseId: "WH-1", lines: [] } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("لا توجد أسطر في التسوية");
    expect(confirmCalled).toBe(false);
  });
});

describe("useAdjustmentJournalEntry", () => {
  it("returns null (not an error) on a 404 — no value delta means no posted entry", async () => {
    const transport = stubTransport({ "GET /gl/journal-entries/ADJ-1": () => ({ status: 404, body: {} }) });
    const { result } = renderHook(() => useAdjustmentJournalEntry("ADJ-1"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("returns the journal entry when one was posted, and is disabled for a null docId", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /gl/journal-entries/ADJ-1": () => {
        called = true;
        return { body: { id: "JE-1" } };
      },
    });
    const { result: disabled } = renderHook(() => useAdjustmentJournalEntry(null), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
    expect(disabled.current.isPending).toBe(true);

    const { result } = renderHook(() => useAdjustmentJournalEntry("ADJ-1"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ id: "JE-1" });
  });
});

describe("useStockTransfers / useCreateStockTransfer", () => {
  it("lists transfers", async () => {
    const transport = stubTransport({ "GET /inventory/stock-transfers": () => ({ body: [] }) });
    const { result } = renderHook(() => useStockTransfers(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("drafts then confirms a transfer, invalidating stock-transfers and stock-balance", async () => {
    const transport = stubTransport({
      "POST /inventory/stock-transfers/draft": () => ({ status: 201, body: { id: "TRF-1" } }),
      "POST /inventory/stock-transfers/TRF-1/confirm": () => ({ body: { document: { id: "TRF-1" }, held: false } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateStockTransfer(), { wrapper: Wrapper });
    result.current.mutate({ fromWarehouseId: "WH-1", toWarehouseId: "WH-2", lines: [] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inventory", "stock-transfers"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inventory", "stock-balance"] });
  });
});

describe("physical counts", () => {
  it("usePhysicalCounts builds the query string from status and warehouseId", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /inventory/physical-counts": (_init, path) => {
        seenPath = path;
        return { body: [] };
      },
    });
    const { result } = renderHook(() => usePhysicalCounts({ status: "in_progress", warehouseId: "WH-1" }), {
      wrapper: makeWrapper(transport).Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/inventory/physical-counts?status=in_progress&warehouseId=WH-1");
  });

  it("every count lifecycle mutation invalidates ['inventory','physical-counts']", async () => {
    const transport = stubTransport({
      "POST /inventory/physical-counts": () => ({ status: 201, body: { id: "PC-1" } }),
      "POST /inventory/physical-counts/PC-1/counts": () => ({ body: { id: "PC-1" } }),
      "POST /inventory/physical-counts/PC-1/complete": () => ({ body: { id: "PC-1" } }),
      "POST /inventory/physical-counts/PC-1/cancel": () => ({ body: { id: "PC-1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result: start } = renderHook(() => useStartPhysicalCount(), { wrapper: Wrapper });
    start.current.mutate({ warehouseId: "WH-1" } as never);
    await waitFor(() => expect(start.current.isSuccess).toBe(true));

    const { result: record } = renderHook(() => useRecordPhysicalCounts(), { wrapper: Wrapper });
    record.current.mutate({ id: "PC-1", body: { entries: [] } as never });
    await waitFor(() => expect(record.current.isSuccess).toBe(true));

    const { result: complete } = renderHook(() => useCompletePhysicalCount(), { wrapper: Wrapper });
    complete.current.mutate("PC-1");
    await waitFor(() => expect(complete.current.isSuccess).toBe(true));

    const { result: cancel } = renderHook(() => useCancelPhysicalCount(), { wrapper: Wrapper });
    cancel.current.mutate("PC-1");
    await waitFor(() => expect(cancel.current.isSuccess).toBe(true));

    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["inventory", "physical-counts"] });
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("useGenerateAdjustmentFromCount invalidates physical-counts, stock-adjustments AND stock-balance together", async () => {
    const transport = stubTransport({
      "POST /inventory/physical-counts/PC-1/generate-adjustment": () => ({
        body: { count: { id: "PC-1" }, adjustment: { id: "ADJ-1" } },
      }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useGenerateAdjustmentFromCount(), { wrapper: Wrapper });
    result.current.mutate({ id: "PC-1", body: {} as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inventory", "physical-counts"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inventory", "stock-adjustments"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["inventory", "stock-balance"] });
  });

  it("surfaces an ApiError when the list request fails", async () => {
    const transport = stubTransport({ "GET /inventory/physical-counts": () => ({ status: 500, body: {} }) });
    const { result } = renderHook(() => usePhysicalCounts(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});
