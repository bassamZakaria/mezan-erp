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
  useApprovePayrollRun,
  useCalculatePayrollRun,
  useCancelPayrollRun,
  useCreatePayrollComponent,
  useCreatePayrollRun,
  useDecideEmployeeAdvance,
  useDisburseEmployeeAdvance,
  useDisbursePayrollRun,
  useEmployeeAdvanceBalances,
  useEmployeeAdvances,
  useEmployeePayslips,
  usePayrollComponents,
  usePayrollRun,
  usePayrollRuns,
  useRequestEmployeeAdvance,
  useUpdatePayrollComponent,
} from "./hr-payroll-hooks";
import { ApiError, useHrDashboard } from "./hooks";

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

describe("useEmployeeAdvances / useEmployeeAdvanceBalances", () => {
  it("requests /hr/advances and returns the list, empty when there are none", async () => {
    const transport = stubTransport({ "GET /hr/advances": () => ({ body: [] }) });
    const { result } = renderHook(() => useEmployeeAdvances(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("requests /hr/advances/outstanding for the balances and surfaces an error", async () => {
    const transport = stubTransport({ "GET /hr/advances/outstanding": () => ({ status: 500, body: {} }) });
    const { result } = renderHook(() => useEmployeeAdvanceBalances(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

describe("advance mutations invalidate ['hr','advances']", () => {
  it("useRequestEmployeeAdvance posts the body and invalidates", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /hr/advances": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { id: "ADV-1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRequestEmployeeAdvance(), { wrapper: Wrapper });
    result.current.mutate({ employeeId: "E1", amount: "1000" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ employeeId: "E1", amount: "1000" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr", "advances"] });
  });

  it("useDecideEmployeeAdvance posts to /hr/advances/:id/:decision and invalidates", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "POST /hr/advances/ADV-1/approve": (_init, path) => {
        seenPath = path;
        return { body: { id: "ADV-1", status: "approved" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDecideEmployeeAdvance(), { wrapper: Wrapper });
    result.current.mutate({ id: "ADV-1", decision: "approve" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/hr/advances/ADV-1/approve");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr", "advances"] });
  });

  it("useDisburseEmployeeAdvance posts the treasury body to /hr/advances/:id/disburse", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /hr/advances/ADV-1/disburse": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { id: "ADV-1", status: "disbursed" } };
      },
    });
    const { result } = renderHook(() => useDisburseEmployeeAdvance(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ id: "ADV-1", body: { treasuryAccountId: "TA-1" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ treasuryAccountId: "TA-1" });
  });
});

describe("usePayrollRuns / usePayrollRun", () => {
  it("lists runs from /hr/payroll/runs", async () => {
    const transport = stubTransport({ "GET /hr/payroll/runs": () => ({ body: [{ id: "PR-1" }] }) });
    const { result } = renderHook(() => usePayrollRuns(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "PR-1" }]);
  });

  it("usePayrollRun(id) fetches the run detail; a null id disables the query", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /hr/payroll/runs/PR-1": () => {
        called = true;
        return { body: { id: "PR-1", lines: [] } };
      },
    });
    const { result: disabled } = renderHook(() => usePayrollRun(null), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
    expect(disabled.current.isPending).toBe(true);

    const { result: enabled } = renderHook(() => usePayrollRun("PR-1"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(enabled.current.isSuccess).toBe(true));
    expect(called).toBe(true);
  });
});

describe("payroll run lifecycle mutations all invalidate both ['hr','payroll'] and ['hr','advances']", () => {
  it("useCreatePayrollRun posts to /hr/payroll/runs and invalidates hr/payroll + hr/advances", async () => {
    const transport = stubTransport({ "POST /hr/payroll/runs": () => ({ status: 201, body: { id: "PR-2" } }) });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreatePayrollRun(), { wrapper: Wrapper });
    result.current.mutate({ periodFrom: "2026-03-01", periodTo: "2026-03-31" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr", "payroll"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr", "advances"] });
  });

  it("useCalculatePayrollRun posts to /hr/payroll/runs/:id/calculate", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "POST /hr/payroll/runs/PR-1/calculate": (_init, path) => {
        seenPath = path;
        return { body: { id: "PR-1" } };
      },
    });
    const { result } = renderHook(() => useCalculatePayrollRun(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate("PR-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/hr/payroll/runs/PR-1/calculate");
  });

  it("useApprovePayrollRun posts to /hr/payroll/runs/:id/approve", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "POST /hr/payroll/runs/PR-1/approve": (_init, path) => {
        seenPath = path;
        return { body: { id: "PR-1" } };
      },
    });
    const { result } = renderHook(() => useApprovePayrollRun(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate("PR-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/hr/payroll/runs/PR-1/approve");
  });

  it("useDisbursePayrollRun posts the treasury body to /hr/payroll/runs/:id/disburse", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /hr/payroll/runs/PR-1/disburse": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { id: "PR-1" } };
      },
    });
    const { result } = renderHook(() => useDisbursePayrollRun(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ id: "PR-1", body: { treasuryAccountId: "TA-1" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ treasuryAccountId: "TA-1" });
  });

  it("useCancelPayrollRun posts to /hr/payroll/runs/:id/cancel", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "POST /hr/payroll/runs/PR-1/cancel": (_init, path) => {
        seenPath = path;
        return { body: { id: "PR-1" } };
      },
    });
    const { result } = renderHook(() => useCancelPayrollRun(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate("PR-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/hr/payroll/runs/PR-1/cancel");
  });
});

describe("useEmployeePayslips", () => {
  it("requests /hr/payroll/payslips with the employeeId as a query param; a null id disables it", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /hr/payroll/payslips": (_init, path) => {
        called = true;
        expect(path).toBe("/hr/payroll/payslips?employeeId=E1");
        return { body: [{ id: "PS-1" }] };
      },
    });
    const { result: disabled } = renderHook(() => useEmployeePayslips(null), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
    expect(disabled.current.isPending).toBe(true);

    const { result } = renderHook(() => useEmployeePayslips("E1"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "PS-1" }]);
  });
});

describe("payroll components (['hr','payroll','components'] + also invalidates ['hr-contracts'])", () => {
  it("usePayrollComponents lists from /hr/payroll/components", async () => {
    const transport = stubTransport({ "GET /hr/payroll/components": () => ({ body: [] }) });
    const { result } = renderHook(() => usePayrollComponents(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("useCreatePayrollComponent posts the body and invalidates BOTH ['hr','payroll','components'] and ['hr-contracts']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /hr/payroll/components": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { id: "PC-1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreatePayrollComponent(), { wrapper: Wrapper });
    result.current.mutate({ code: "BONUS", nameAr: "مكافأة" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ code: "BONUS", nameAr: "مكافأة" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr", "payroll", "components"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr-contracts"] });
  });

  it("useUpdatePayrollComponent PUTs to /hr/payroll/components/:id", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    const transport = stubTransport({
      "PUT /hr/payroll/components/PC-1": (init, path) => {
        seenPath = path;
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { id: "PC-1", nameAr: "مكافأة معدّلة" } };
      },
    });
    const { result } = renderHook(() => useUpdatePayrollComponent(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ id: "PC-1", body: { nameAr: "مكافأة معدّلة" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/hr/payroll/components/PC-1");
    expect(seenBody).toEqual({ nameAr: "مكافأة معدّلة" });
  });
});

describe("useHrDashboard — module-licence refusal", () => {
  it("surfaces the server's own MODULE_NOT_LICENSED message, not the generic loader failure", async () => {
    const transport = stubTransport({
      "GET /hr/dashboard": () => ({
        status: 403,
        body: { error: "MODULE_NOT_LICENSED", module: "hr", message: "وحدة الموارد البشرية غير مفعّلة في باقتكم" },
      }),
    });
    const { result } = renderHook(() => useHrDashboard(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.message).toBe("وحدة الموارد البشرية غير مفعّلة في باقتكم");
  });

  it("keeps the generic translated failure for a plain 500", async () => {
    const transport = stubTransport({ "GET /hr/dashboard": () => ({ status: 500, body: {} }) });
    const { result } = renderHook(() => useHrDashboard(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).not.toBe("وحدة الموارد البشرية غير مفعّلة في باقتكم");
  });
});
