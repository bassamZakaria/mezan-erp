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
  attachmentsKey,
  useAttachments,
  useDeleteAttachment,
  useDownloadAttachment,
  useUploadAttachment,
} from "./attachment-hooks";
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

describe("useAttachments", () => {
  it("requests /attachments with entityType and entityId as query params", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /attachments": (_init, path) => {
        seenPath = path;
        return { body: [{ id: "ATT-1" }] };
      },
    });
    const { result } = renderHook(() => useAttachments("sales_invoice", "SI-1"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/attachments?entityType=sales_invoice&entityId=SI-1");
    expect(result.current.data).toEqual([{ id: "ATT-1" }]);
  });

  it("is disabled (no request) when entityId is null", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /attachments": () => {
        called = true;
        return { body: [] };
      },
    });
    renderHook(() => useAttachments("sales_invoice", null), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
  });

  it("returns an empty list cleanly", async () => {
    const transport = stubTransport({ "GET /attachments": () => ({ body: [] }) });
    const { result } = renderHook(() => useAttachments("sales_invoice", "SI-2"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("surfaces a failure as an ApiError", async () => {
    const transport = stubTransport({ "GET /attachments": () => ({ status: 500, body: {} }) });
    const { result } = renderHook(() => useAttachments("sales_invoice", "SI-3"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

describe("useUploadAttachment", () => {
  it("sends the base64 payload as JSON and invalidates the exact ['attachments', entityType, entityId] key for the RETURNED attachment", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /attachments": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return {
          status: 201,
          body: { id: "ATT-9", entityType: "sales_invoice", entityId: "SI-1", fileName: "a.pdf" },
        };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUploadAttachment(), { wrapper: Wrapper });

    const input = {
      entityType: "sales_invoice" as const,
      entityId: "SI-1",
      fileName: "a.pdf",
      mimeType: "application/pdf",
      notes: null,
      contentBase64: "AAAA",
    };
    result.current.mutate(input);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(seenBody).toEqual(input);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: attachmentsKey("sales_invoice", "SI-1") });
  });

  it("surfaces an upload failure with the server's message", async () => {
    const transport = stubTransport({
      "POST /attachments": () => ({ status: 413, body: { message: "الملف أكبر من الحد المسموح" } }),
    });
    const { result } = renderHook(() => useUploadAttachment(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({
      entityType: "sales_invoice",
      entityId: "SI-1",
      fileName: "big.pdf",
      mimeType: "application/pdf",
      notes: null,
      contentBase64: "AAAA",
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("الملف أكبر من الحد المسموح");
  });
});

describe("useDeleteAttachment", () => {
  it("DELETEs the given id and invalidates the entity's attachments key", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "DELETE /attachments/ATT-1": (_init, path) => {
        seenPath = path;
        return { status: 204, body: null };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteAttachment("sales_invoice", "SI-1"), { wrapper: Wrapper });
    result.current.mutate("ATT-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/attachments/ATT-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: attachmentsKey("sales_invoice", "SI-1") });
  });
});

describe("useDownloadAttachment", () => {
  it("fetches the attachment's content on demand", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /attachments/ATT-1/content": (_init, path) => {
        seenPath = path;
        return { body: { fileName: "a.pdf", mimeType: "application/pdf", contentBase64: "AAAA" } };
      },
    });
    const { result } = renderHook(() => useDownloadAttachment(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate("ATT-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/attachments/ATT-1/content");
    expect(result.current.data).toEqual({ fileName: "a.pdf", mimeType: "application/pdf", contentBase64: "AAAA" });
  });
});
