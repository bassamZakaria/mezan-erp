// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { stubTransport, testAdminSession } from "./test-support";
import type { Transport } from "./transport";
import type { Session } from "./session";
import { useManufacturingDashboard, useScopeSelector, useSystemStatus, useWorkingLocation } from "./hub-hooks";
import { ApiError } from "./hooks";

function makeWrapper(transport: Transport, session: Session | null = testAdminSession) {
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

describe("useManufacturingDashboard", () => {
  it("requests /manufacturing/dashboard and returns the buckets/kpis shape", async () => {
    const body = {
      overdueCount: 1,
      kpis: { activeWorkOrders: 2, wipValue: "1000.00", unitsProducedThisMonth: "50", avgCostPerUnit: "20.00" },
      buckets: { notStarted: [], awaitingMaterialIssue: [], awaitingProductReceipt: [], readyToComplete: [] },
      activeOrders: [],
    };
    const transport = stubTransport({ "GET /manufacturing/dashboard": () => ({ body }) });
    const { result } = renderHook(() => useManufacturingDashboard(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(body);
  });

  it("surfaces a failure as an ApiError", async () => {
    const transport = stubTransport({ "GET /manufacturing/dashboard": () => ({ status: 500, body: {} }) });
    const { result } = renderHook(() => useManufacturingDashboard(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

describe("useSystemStatus", () => {
  it("reports both checks operational when /health and /profile both succeed", async () => {
    const transport = stubTransport({
      "GET /health": () => ({ body: { ok: true } }),
      "GET /profile": () => ({ body: {} }),
    });
    const { result } = renderHook(() => useSystemStatus(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const services = result.current.data?.services ?? [];
    expect(services.find((s) => s.key === "api")?.state).toBe("operational");
    expect(services.find((s) => s.key === "database")?.state).toBe("operational");
  });

  it("reports the database check as down when /profile fails, independently of /health", async () => {
    const transport = stubTransport({
      "GET /health": () => ({ body: { ok: true } }),
      "GET /profile": () => ({ status: 500, body: {} }),
    });
    const { result } = renderHook(() => useSystemStatus(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const services = result.current.data?.services ?? [];
    expect(services.find((s) => s.key === "api")?.state).toBe("operational");
    expect(services.find((s) => s.key === "database")?.state).toBe("down");
  });

  it("never fabricates an uptime/incident feed — only the two real checks are reported", async () => {
    const transport = stubTransport({
      "GET /health": () => ({ body: { ok: true } }),
      "GET /profile": () => ({ body: {} }),
    });
    const { result } = renderHook(() => useSystemStatus(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.services.map((s) => s.key).sort()).toEqual(["api", "database"]);
  });
});

const branches = [
  { id: "B-MAIN", code: "MAIN", name: "الفرع الرئيسي", parentBranchId: null, phone: null, email: null, address: null, isMain: true, active: true },
  { id: "B-ALEX", code: "ALEX", name: "فرع الإسكندرية", parentBranchId: null, phone: null, email: null, address: null, isMain: false, active: true },
  { id: "B-OLD", code: "OLD", name: "فرع مغلق", parentBranchId: null, phone: null, email: null, address: null, isMain: false, active: false },
];
const warehouses = [
  { id: "W-MAIN", code: "WMAIN", name: "المخزن الرئيسي", branchId: "B-MAIN", isDefault: true, active: true },
  { id: "W-ALEX", code: "WALEX", name: "مخزن الإسكندرية", branchId: "B-ALEX", isDefault: true, active: true },
];

function scopeTransport() {
  return stubTransport({
    "GET /branches": () => ({ body: branches }),
    "GET /warehouses": () => ({ body: warehouses }),
    "GET /branches/lookup": () => ({ body: { branches: branches.filter((branch) => branch.id === "B-ALEX"), restricted: true, unattributed: false } }),
    "GET /warehouses/lookup": () => ({ body: warehouses.filter((warehouse) => warehouse.branchId === "B-ALEX") }),
  });
}

describe("useScopeSelector", () => {
  it("excludes inactive branches and narrows warehouse options to the selected branch", async () => {
    const { result } = renderHook(() => useScopeSelector(), { wrapper: makeWrapper(scopeTransport()).Wrapper });
    await waitFor(() => expect(result.current.branchOptions.length).toBeGreaterThan(0));
    expect(result.current.branchOptions.map((b) => b.id).sort()).toEqual(["B-ALEX", "B-MAIN"]);

    act(() => result.current.setBranch("B-MAIN"));
    await waitFor(() => expect(result.current.selection.branchId).toBe("B-MAIN"));
    expect(result.current.warehouseOptions.map((w) => w.id)).toEqual(["W-MAIN"]);
  });

  it("restricts branch options to the session's own branchScope when it isn't '*'", async () => {
    const scoped = { ...testAdminSession, branchScope: ["B-ALEX"] };
    const { result } = renderHook(() => useScopeSelector(), { wrapper: makeWrapper(scopeTransport(), scoped).Wrapper });
    await waitFor(() => expect(result.current.branchOptions.length).toBeGreaterThan(0));
    expect(result.current.branchOptions.map((b) => b.id)).toEqual(["B-ALEX"]);
  });

  it("clears the warehouse selection when switching to a branch the current warehouse doesn't belong to", async () => {
    const { result } = renderHook(() => useScopeSelector(), { wrapper: makeWrapper(scopeTransport()).Wrapper });
    await waitFor(() => expect(result.current.branchOptions.length).toBeGreaterThan(0));
    act(() => result.current.setWarehouse("W-ALEX"));
    await waitFor(() => expect(result.current.selection.warehouseId).toBe("W-ALEX"));
    act(() => result.current.setBranch("B-MAIN"));
    await waitFor(() => expect(result.current.selection.branchId).toBe("B-MAIN"));
    expect(result.current.selection.warehouseId).toBeNull();
  });
});

describe("useWorkingLocation", () => {
  it("defaults a new document to the tenant's main branch and that branch's default warehouse when nothing is explicitly selected", async () => {
    const { result } = renderHook(() => useWorkingLocation(), { wrapper: makeWrapper(scopeTransport()).Wrapper });
    await waitFor(() => expect(result.current.branchId).toBe("B-MAIN"));
    await waitFor(() => expect(result.current.warehouseId).toBe("W-MAIN"));
  });

  it("never falls back to the literal ids 'MAIN'/'MAIN-WH' — only real fetched branch/warehouse ids", async () => {
    const { result } = renderHook(() => useWorkingLocation(), { wrapper: makeWrapper(scopeTransport()).Wrapper });
    await waitFor(() => expect(result.current.branchId).not.toBeNull());
    expect(result.current.branchId).not.toBe("MAIN");
    expect(result.current.warehouseId).not.toBe("MAIN-WH");
  });
});
