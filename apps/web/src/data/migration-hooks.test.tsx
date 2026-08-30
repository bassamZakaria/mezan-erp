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
import {
  ApiError,
  useCustomerImportCommit,
  useCustomerImportPreview,
  useHistoricalImportCommit,
  useHistoricalImportPreview,
  useItemImportCommit,
  useItemImportPreview,
  useOpeningBalanceImportCommit,
  useOpeningBalanceImportPreview,
  useSupplierImportCommit,
  useSupplierImportPreview,
} from "./migration-hooks";

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

describe("useCustomerImportPreview / useCustomerImportCommit", () => {
  it("preview posts the batch to /data-migration/customers/preview", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /data-migration/customers/preview": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { total: 2, valid: 2, invalid: 0, rows: [] } };
      },
    });
    const { result } = renderHook(() => useCustomerImportPreview(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ rows: [{ name: "عميل 1" }] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ rows: [{ name: "عميل 1" }] });
    expect(result.current.data).toEqual({ total: 2, valid: 2, invalid: 0, rows: [] });
  });

  it("commit posts to /data-migration/customers/commit", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "POST /data-migration/customers/commit": (_init, path) => {
        seenPath = path;
        return { body: { total: 2, valid: 2, invalid: 0, rows: [] } };
      },
    });
    const { result } = renderHook(() => useCustomerImportCommit(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ rows: [] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/data-migration/customers/commit");
  });

  it("throws an ApiError on a genuine server failure", async () => {
    const transport = stubTransport({
      "POST /data-migration/customers/commit": () => ({ status: 500, body: { message: "فشل الاستيراد" } }),
    });
    const { result } = renderHook(() => useCustomerImportCommit(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ rows: [] } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error?.message).toBe("فشل الاستيراد");
  });

  it("a 422 (row-level validation errors) resolves successfully with the payload rather than throwing — the wizard renders per-row errors instead of a global failure", async () => {
    const transport = stubTransport({
      "POST /data-migration/customers/commit": () => ({
        status: 422,
        body: { total: 3, valid: 1, invalid: 2, rows: [{ row: 2, error: "الاسم مطلوب" }] },
      }),
    });
    const { result } = renderHook(() => useCustomerImportCommit(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ rows: [] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.invalid).toBe(2);
  });
});

describe("supplier / item / opening-balance import mutations hit their own distinct endpoints", () => {
  it("useSupplierImportPreview / Commit", async () => {
    const seen: string[] = [];
    const transport = stubTransport({
      "POST /data-migration/suppliers/preview": (_i, p) => {
        seen.push(p);
        return { body: { total: 0, valid: 0, invalid: 0, rows: [] } };
      },
      "POST /data-migration/suppliers/commit": (_i, p) => {
        seen.push(p);
        return { body: { total: 0, valid: 0, invalid: 0, rows: [] } };
      },
    });
    const { result: preview } = renderHook(() => useSupplierImportPreview(), { wrapper: makeWrapper(transport).Wrapper });
    preview.current.mutate({ rows: [] } as never);
    await waitFor(() => expect(preview.current.isSuccess).toBe(true));
    const { result: commit } = renderHook(() => useSupplierImportCommit(), { wrapper: makeWrapper(transport).Wrapper });
    commit.current.mutate({ rows: [] } as never);
    await waitFor(() => expect(commit.current.isSuccess).toBe(true));
    expect(seen).toEqual(["/data-migration/suppliers/preview", "/data-migration/suppliers/commit"]);
  });

  it("useItemImportPreview / Commit", async () => {
    const seen: string[] = [];
    const transport = stubTransport({
      "POST /data-migration/items/preview": (_i, p) => {
        seen.push(p);
        return { body: { total: 0, valid: 0, invalid: 0, rows: [] } };
      },
      "POST /data-migration/items/commit": (_i, p) => {
        seen.push(p);
        return { body: { total: 0, valid: 0, invalid: 0, rows: [] } };
      },
    });
    const { result: preview } = renderHook(() => useItemImportPreview(), { wrapper: makeWrapper(transport).Wrapper });
    preview.current.mutate({ rows: [] } as never);
    await waitFor(() => expect(preview.current.isSuccess).toBe(true));
    const { result: commit } = renderHook(() => useItemImportCommit(), { wrapper: makeWrapper(transport).Wrapper });
    commit.current.mutate({ rows: [] } as never);
    await waitFor(() => expect(commit.current.isSuccess).toBe(true));
    expect(seen).toEqual(["/data-migration/items/preview", "/data-migration/items/commit"]);
  });

  it("useOpeningBalanceImportPreview / Commit", async () => {
    const seen: string[] = [];
    const transport = stubTransport({
      "POST /data-migration/opening-balances/preview": (_i, p) => {
        seen.push(p);
        return { body: { total: 0, valid: 0, invalid: 0, rows: [] } };
      },
      "POST /data-migration/opening-balances/commit": (_i, p) => {
        seen.push(p);
        return { body: { total: 0, valid: 0, invalid: 0, rows: [] } };
      },
    });
    const { result: preview } = renderHook(() => useOpeningBalanceImportPreview(), { wrapper: makeWrapper(transport).Wrapper });
    preview.current.mutate({ rows: [] } as never);
    await waitFor(() => expect(preview.current.isSuccess).toBe(true));
    const { result: commit } = renderHook(() => useOpeningBalanceImportCommit(), { wrapper: makeWrapper(transport).Wrapper });
    commit.current.mutate({ rows: [] } as never);
    await waitFor(() => expect(commit.current.isSuccess).toBe(true));
    expect(seen).toEqual(["/data-migration/opening-balances/preview", "/data-migration/opening-balances/commit"]);
  });
});

describe("historical document import reuses the existing purchases historical-import routes", () => {
  it("preview posts to /purchases/historical-import/preview", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "POST /purchases/historical-import/preview": (_init, path) => {
        seenPath = path;
        return { body: { total: 0, valid: 0, invalid: 0, rows: [] } };
      },
    });
    const { result } = renderHook(() => useHistoricalImportPreview(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ kind: "purchase_invoice", docType: "purchase_invoice", rows: [] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/purchases/historical-import/preview");
  });

  it("commit posts to /purchases/historical-import/commit and surfaces a genuine failure", async () => {
    const transport = stubTransport({
      "POST /purchases/historical-import/commit": () => ({ status: 500, body: { message: "فشل الاستيراد التاريخي" } }),
    });
    const { result } = renderHook(() => useHistoricalImportCommit(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ kind: "purchase_invoice", docType: "purchase_invoice", rows: [] } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("فشل الاستيراد التاريخي");
  });
});
