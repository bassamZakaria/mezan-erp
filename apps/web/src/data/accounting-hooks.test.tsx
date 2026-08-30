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
  FxRevaluationError,
  useApproveExchangeRate,
  useCostCenterPnL,
  useCreateExchangeRate,
  useEtaConfig,
  useEtaSubmissions,
  useExchangeRates,
  useExcludeEtaSubmission,
  useFxRevaluationPost,
  useFxRevaluationPreview,
  useLockExchangeRate,
  useReconciliationReport,
  useSubmitAllEtaReady,
  useSubmitEtaSubmission,
} from "./accounting-hooks";
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

describe("useExchangeRates", () => {
  it("requests /exchange-rates and returns the list", async () => {
    const transport = stubTransport({ "GET /exchange-rates": () => ({ body: [{ id: "FX-1" }] }) });
    const { result } = renderHook(() => useExchangeRates(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "FX-1" }]);
  });

  it("returns an empty list cleanly and surfaces an error status", async () => {
    const empty = stubTransport({ "GET /exchange-rates": () => ({ body: [] }) });
    const { result: r1 } = renderHook(() => useExchangeRates(), { wrapper: makeWrapper(empty).Wrapper });
    await waitFor(() => expect(r1.current.isSuccess).toBe(true));
    expect(r1.current.data).toEqual([]);

    const failing = stubTransport({ "GET /exchange-rates": () => ({ status: 500, body: {} }) });
    const { result: r2 } = renderHook(() => useExchangeRates(), { wrapper: makeWrapper(failing).Wrapper });
    await waitFor(() => expect(r2.current.isError).toBe(true));
    expect(r2.current.error).toBeInstanceOf(ApiError);
  });
});

describe("useCreateExchangeRate", () => {
  it("posts the new rate and invalidates ['exchange-rates']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /exchange-rates": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { id: "FX-2" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateExchangeRate(), { wrapper: Wrapper });
    result.current.mutate({ currency: "USD", rate: "48.5", date: "2026-03-01" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ currency: "USD", rate: "48.5", date: "2026-03-01" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["exchange-rates"] });
  });
});

describe("useApproveExchangeRate / useLockExchangeRate", () => {
  it("approve posts to /exchange-rates/:id/approve and invalidates ['exchange-rates']", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "POST /exchange-rates/FX-1/approve": (_init, path) => {
        seenPath = path;
        return { body: { id: "FX-1", status: "approved" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useApproveExchangeRate(), { wrapper: Wrapper });
    result.current.mutate("FX-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/exchange-rates/FX-1/approve");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["exchange-rates"] });
  });

  it("lock posts to /exchange-rates/:id/lock", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "POST /exchange-rates/FX-1/lock": (_init, path) => {
        seenPath = path;
        return { body: { id: "FX-1", status: "locked" } };
      },
    });
    const { result } = renderHook(() => useLockExchangeRate(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate("FX-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/exchange-rates/FX-1/lock");
  });
});

describe("FX revaluation", () => {
  it("preview posts the request body without touching any cache", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /revaluation/preview": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { lines: [] } };
      },
    });
    const { result } = renderHook(() => useFxRevaluationPreview(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ asOfDate: "2026-03-31" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ asOfDate: "2026-03-31" });
  });

  it("post invalidates ['journal-entries'] on success", async () => {
    const transport = stubTransport({
      "POST /revaluation/post": () => ({ body: { journalEntryId: "JE-1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useFxRevaluationPost(), { wrapper: Wrapper });
    result.current.mutate({ asOfDate: "2026-03-31" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["journal-entries"] });
  });

  it("carries the missing currency on a FxRevaluationError so the screen can show the same Arabic notice", async () => {
    const transport = stubTransport({
      "POST /revaluation/post": () => ({ status: 400, body: { message: "لا يوجد سعر صرف لهذه العملة", currency: "USD" } }),
    });
    const { result } = renderHook(() => useFxRevaluationPost(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ asOfDate: "2026-03-31" } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(FxRevaluationError);
    expect((result.current.error as FxRevaluationError).currency).toBe("USD");
    expect(result.current.error?.message).toBe("لا يوجد سعر صرف لهذه العملة");
  });
});

describe("useReconciliationReport", () => {
  it("requests /reconciliation", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /reconciliation": (_init, path) => {
        seenPath = path;
        return { body: { lines: [] } };
      },
    });
    const { result } = renderHook(() => useReconciliationReport(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/reconciliation");
  });
});

describe("useCostCenterPnL", () => {
  it("builds the query string only from non-blank from/to dates", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /cost-center-pl": (_init, path) => {
        seenPath = path;
        return { body: { rows: [] } };
      },
    });
    const { result } = renderHook(() => useCostCenterPnL("2026-01-01", "2026-01-31"), {
      wrapper: makeWrapper(transport).Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/cost-center-pl?fromDate=2026-01-01&toDate=2026-01-31");
  });

  it("omits the query string entirely when both dates are blank", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /cost-center-pl": (_init, path) => {
        seenPath = path;
        return { body: { rows: [] } };
      },
    });
    const { result } = renderHook(() => useCostCenterPnL("", ""), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/cost-center-pl");
  });
});

describe("ETA e-invoicing", () => {
  it("useEtaConfig requests /eta/config", async () => {
    const transport = stubTransport({
      "GET /eta/config": () => ({ body: { config: { enabled: true }, readiness: { ready: true } } }),
    });
    const { result } = renderHook(() => useEtaConfig(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.readiness).toEqual({ ready: true });
  });

  it("useEtaSubmissions with no status omits the query string; with a status appends it", async () => {
    const seen: string[] = [];
    const transport = stubTransport({
      "GET /eta/submissions": (_init, path) => {
        seen.push(path);
        return { body: [] };
      },
    });
    const { result: unfiltered } = renderHook(() => useEtaSubmissions(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(unfiltered.current.isSuccess).toBe(true));
    const { result: accepted } = renderHook(() => useEtaSubmissions("accepted"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(accepted.current.isSuccess).toBe(true));
    expect(seen).toContain("/eta/submissions");
    expect(seen).toContain("/eta/submissions?status=accepted");
  });

  it("useSubmitEtaSubmission treats a 202 as a queued/offline result rather than an error, and still invalidates submissions", async () => {
    const transport = stubTransport({
      "POST /eta/submissions/SUB-1/submit": () => ({ status: 202, body: { message: "التقديم متاح فقط عند الاتصال بالإنترنت" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSubmitEtaSubmission(), { wrapper: Wrapper });
    result.current.mutate("SUB-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      submission: null,
      offline: true,
      message: "التقديم متاح فقط عند الاتصال بالإنترنت",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eta", "submissions"] });
  });

  it("useSubmitEtaSubmission returns the real submission and offline:false on a normal success", async () => {
    const transport = stubTransport({
      "POST /eta/submissions/SUB-2/submit": () => ({ body: { id: "SUB-2", etaUuid: "UUID-1" } }),
    });
    const { result } = renderHook(() => useSubmitEtaSubmission(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate("SUB-2");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ submission: { id: "SUB-2", etaUuid: "UUID-1" }, offline: false, message: null });
  });

  it("useSubmitAllEtaReady invalidates ['eta','submissions'] (a prefix of ['eta','submissions',status])", async () => {
    const transport = stubTransport({
      "POST /eta/submissions/submit-all": () => ({ body: { submitted: [], queued: [] } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSubmitAllEtaReady(), { wrapper: Wrapper });
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eta", "submissions"] });
  });

  it("useExcludeEtaSubmission sends the exclusion reason and invalidates submissions", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /eta/submissions/SUB-3/exclude": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { id: "SUB-3", status: "excluded" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useExcludeEtaSubmission(), { wrapper: Wrapper });
    result.current.mutate({ id: "SUB-3", reason: "فاتورة اختبار" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ reason: "فاتورة اختبار" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["eta", "submissions"] });
  });
});
