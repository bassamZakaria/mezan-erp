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
import { ApiError, useBarcodeConfig, useParseBarcode, useUpdateBarcodeConfig } from "./barcode-config-hooks";

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

describe("useBarcodeConfig", () => {
  it("requests /barcode-config and returns the config", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /barcode-config": (_init, path) => {
        seenPath = path;
        return { body: { prefix: "20", digits: 13 } };
      },
    });
    const { result } = renderHook(() => useBarcodeConfig(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/barcode-config");
    expect(result.current.data).toEqual({ prefix: "20", digits: 13 });
  });

  it("surfaces a failure as an ApiError", async () => {
    const transport = stubTransport({ "GET /barcode-config": () => ({ status: 500, body: {} }) });
    const { result } = renderHook(() => useBarcodeConfig(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.status).toBe(500);
  });
});

describe("useUpdateBarcodeConfig", () => {
  it("PUTs the edited config", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "PUT /barcode-config": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { prefix: "21", digits: 13 } };
      },
    });
    const { result } = renderHook(() => useUpdateBarcodeConfig(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ prefix: "21", digits: 13 } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ prefix: "21", digits: 13 });
  });

  it("writes the returned config directly into the ['barcode-config'] cache instead of invalidating (setQueryData, not invalidateQueries)", async () => {
    const transport = stubTransport({
      "PUT /barcode-config": () => ({ body: { prefix: "22", digits: 13 } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result } = renderHook(() => useUpdateBarcodeConfig(), { wrapper: Wrapper });
    result.current.mutate({ prefix: "22", digits: 13 } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["barcode-config"])).toEqual({ prefix: "22", digits: 13 });
  });

  it("joins multiple server-side reasons with the channel separator when the save is refused", async () => {
    const transport = stubTransport({
      "PUT /barcode-config": () => ({ status: 400, body: { reasons: ["البادئة مستخدمة", "عدد الأرقام غير صالح"] } }),
    });
    const { result } = renderHook(() => useUpdateBarcodeConfig(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ prefix: "bad" } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain("البادئة مستخدمة");
    expect(result.current.error?.message).toContain("عدد الأرقام غير صالح");
  });
});

describe("useParseBarcode", () => {
  it("posts the scanned code and returns a matched result", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /barcode-config/parse": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { matched: true, ruleId: "R1", itemCode: "I-1", value: 12.5, valueType: "PRICE" } };
      },
    });
    const { result } = renderHook(() => useParseBarcode(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate("2012345000005");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ code: "2012345000005" });
    expect(result.current.data).toEqual({ matched: true, ruleId: "R1", itemCode: "I-1", value: 12.5, valueType: "PRICE" });
  });

  it("returns an unmatched result without throwing when the code isn't recognised", async () => {
    const transport = stubTransport({
      "POST /barcode-config/parse": () => ({ body: { matched: false } }),
    });
    const { result } = renderHook(() => useParseBarcode(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate("0000000000000");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ matched: false });
  });
});
