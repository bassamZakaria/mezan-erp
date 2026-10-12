// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PeriodCloseErrorCodeDTO } from "@mezan/contracts";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { testAdminSession } from "./test-support";
import type { Transport } from "./transport";
import { ApiError, useClosePeriod, useLockPeriod } from "./hooks";

function httpTransport(status: number, body: unknown, seen: string[] = []): Transport {
  return (path, init) => {
    seen.push(`${init?.method ?? "GET"} ${path}`);
    const res = new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    return Promise.resolve({ status: res.status, ok: res.ok, json: <T,>() => res.json() as Promise<T>, text: () => res.text() });
  };
}

function wrapperFor(transport: Transport) {
  const queryClient = createQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppI18nProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider transport={transport} initialSession={testAdminSession}>
            {children}
          </ApiProvider>
        </QueryClientProvider>
      </AppI18nProvider>
    );
  };
}

describe("closing and locking a period from the periods list, over HTTP", () => {
  const refusal = {
    error: PeriodCloseErrorCodeDTO.Blocked,
    message: "لا يمكن إقفال الفترة المحاسبية «يونيو 2026»: توجد بنود لم تكتمل في قائمة الإقفال.",
    messageEn: "Fiscal period June 2026 cannot be closed: the closing checklist has unfinished items.",
  };

  it("a refused lock shows the server's Arabic refusal and keeps its code, from a body that can be read once", async () => {
    const seen: string[] = [];
    const { result } = renderHook(() => useLockPeriod(), { wrapper: wrapperFor(httpTransport(409, refusal, seen)) });
    act(() => result.current.mutate("fp-2026-06"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(seen).toEqual(["POST /fiscal-periods/fp-2026-06/lock"]);
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.message).toBe(refusal.message);
    expect(result.current.error?.code).toBe(PeriodCloseErrorCodeDTO.Blocked);
    expect(result.current.error?.status).toBe(409);
  });

  it("a refusal with no readable body falls back to the screen's own sentence", async () => {
    const transport: Transport = () => Promise.resolve({ status: 502, ok: false, json: () => Promise.reject(new Error("not json")), text: () => Promise.resolve("") });
    const { result } = renderHook(() => useClosePeriod(), { wrapper: wrapperFor(transport) });
    act(() => result.current.mutate("fp-2026-06"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).not.toBe("");
    expect(result.current.error?.message).not.toBe(refusal.message);
    expect(result.current.error?.code).toBeUndefined();
  });
});
