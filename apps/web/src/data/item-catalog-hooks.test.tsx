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
  categoryLabel,
  unitLabel,
  useCreateItemCategory,
  useCreateItemSpecification,
  useCreateItemUnit,
  useDeleteItemSpecification,
  useItemCategories,
  useItemSpecifications,
  useItemUnits,
  useUpdateItemSpecification,
} from "./item-catalog-hooks";
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

describe("unitLabel / categoryLabel", () => {
  const units = [{ code: "PCS", nameAr: "قطعة" } as never, { code: "KG", nameAr: "كيلوجرام" } as never];
  const categories = [{ id: "C1", nameAr: "مشروبات" } as never];

  it("resolves a known unit code to its Arabic name and falls back to the raw code otherwise", () => {
    expect(unitLabel(units, "KG")).toBe("كيلوجرام");
    expect(unitLabel(units, "UNKNOWN")).toBe("UNKNOWN");
  });

  it("resolves a known category id, falls back to the raw id, and uses the uncategorized label for null", () => {
    expect(categoryLabel(categories, "C1", "بدون تصنيف")).toBe("مشروبات");
    expect(categoryLabel(categories, "NOPE", "بدون تصنيف")).toBe("NOPE");
    expect(categoryLabel(categories, null, "بدون تصنيف")).toBe("بدون تصنيف");
  });
});

describe("useItemUnits / useCreateItemUnit", () => {
  it("lists units from /item-units", async () => {
    const transport = stubTransport({ "GET /item-units": () => ({ body: [{ code: "PCS" }] }) });
    const { result } = renderHook(() => useItemUnits(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ code: "PCS" }]);
  });

  it("create posts the body and invalidates ['item-units']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /item-units": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { code: "BOX" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateItemUnit(), { wrapper: Wrapper });
    result.current.mutate({ code: "BOX", nameAr: "صندوق" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ code: "BOX", nameAr: "صندوق" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["item-units"] });
  });
});

describe("useItemCategories / useCreateItemCategory", () => {
  it("lists categories and surfaces an error", async () => {
    const { result: ok } = renderHook(() => useItemCategories(), {
      wrapper: makeWrapper(stubTransport({ "GET /item-categories": () => ({ body: [] }) })).Wrapper,
    });
    await waitFor(() => expect(ok.current.isSuccess).toBe(true));
    expect(ok.current.data).toEqual([]);

    const { result: failing } = renderHook(() => useItemCategories(), {
      wrapper: makeWrapper(stubTransport({ "GET /item-categories": () => ({ status: 500, body: {} }) })).Wrapper,
    });
    await waitFor(() => expect(failing.current.isError).toBe(true));
    expect(failing.current.error).toBeInstanceOf(ApiError);
  });

  it("create posts the body and invalidates ['item-categories']", async () => {
    const transport = stubTransport({ "POST /item-categories": () => ({ status: 201, body: { id: "C2" } }) });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateItemCategory(), { wrapper: Wrapper });
    result.current.mutate({ nameAr: "أجبان" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["item-categories"] });
  });
});

describe("item specifications registry", () => {
  it("useItemSpecifications lists from /item-specifications", async () => {
    const transport = stubTransport({ "GET /item-specifications": () => ({ body: [{ code: "COLOR" }] }) });
    const { result } = renderHook(() => useItemSpecifications(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ code: "COLOR" }]);
  });

  it("create/update/delete all invalidate ['item-specifications']", async () => {
    const transport = stubTransport({
      "POST /item-specifications": () => ({ status: 201, body: { code: "SIZE" } }),
      "PATCH /item-specifications/SIZE": () => ({ body: { code: "SIZE", nameAr: "المقاس" } }),
      "DELETE /item-specifications/SIZE": () => ({ status: 204, body: null }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result: create } = renderHook(() => useCreateItemSpecification(), { wrapper: Wrapper });
    create.current.mutate({ code: "SIZE" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));

    const { result: update } = renderHook(() => useUpdateItemSpecification(), { wrapper: Wrapper });
    update.current.mutate({ code: "SIZE", patch: { nameAr: "المقاس" } as never });
    await waitFor(() => expect(update.current.isSuccess).toBe(true));

    const { result: del } = renderHook(() => useDeleteItemSpecification(), { wrapper: Wrapper });
    del.current.mutate("SIZE");
    await waitFor(() => expect(del.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledTimes(3);
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["item-specifications"] });
  });

  it("encodes the code in the PATCH/DELETE URL", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "PATCH /item-specifications/*": (_init, path) => {
        seenPath = path;
        return { body: { code: "A/B" } };
      },
    });
    const { result } = renderHook(() => useUpdateItemSpecification(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ code: "A/B", patch: {} as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/item-specifications/A%2FB");
  });
});
