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
import { useCreateLabelLayout, useLabelLayouts, useUpdateLabelLayout } from "./label-hooks";
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

describe("useLabelLayouts", () => {
  it("requests /label-layouts and returns the list", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /label-layouts": (_init, path) => {
        seenPath = path;
        return { body: [{ id: "L1" }] };
      },
    });
    const { result } = renderHook(() => useLabelLayouts(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/label-layouts");
    expect(result.current.data).toEqual([{ id: "L1" }]);
  });

  it("returns an empty list cleanly and surfaces a failure", async () => {
    const { result: empty } = renderHook(() => useLabelLayouts(), {
      wrapper: makeWrapper(stubTransport({ "GET /label-layouts": () => ({ body: [] }) })).Wrapper,
    });
    await waitFor(() => expect(empty.current.isSuccess).toBe(true));
    expect(empty.current.data).toEqual([]);

    const { result: failing } = renderHook(() => useLabelLayouts(), {
      wrapper: makeWrapper(stubTransport({ "GET /label-layouts": () => ({ status: 500, body: {} }) })).Wrapper,
    });
    await waitFor(() => expect(failing.current.isError).toBe(true));
    expect(failing.current.error).toBeInstanceOf(ApiError);
  });
});

describe("useCreateLabelLayout / useUpdateLabelLayout", () => {
  it("create posts the body and invalidates ['label-layouts']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /label-layouts": (init) => {
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 201, body: { id: "L2" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateLabelLayout(), { wrapper: Wrapper });
    result.current.mutate({ name: "ملصق 4×6", widthMm: 40, heightMm: 60 } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ name: "ملصق 4×6", widthMm: 40, heightMm: 60 });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["label-layouts"] });
  });

  it("update PATCHes /label-layouts/:id and invalidates ['label-layouts']", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    const transport = stubTransport({
      "PATCH /label-layouts/L1": (init, path) => {
        seenPath = path;
        seenBody = JSON.parse((init?.body as string) ?? "{}");
        return { body: { id: "L1", name: "معدّل" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateLabelLayout(), { wrapper: Wrapper });
    result.current.mutate({ id: "L1", body: { name: "معدّل" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/label-layouts/L1");
    expect(seenBody).toEqual({ name: "معدّل" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["label-layouts"] });
  });

  it("surfaces a create refusal with the server's message", async () => {
    const transport = stubTransport({
      "POST /label-layouts": () => ({ status: 400, body: { message: "اسم التخطيط مستخدم بالفعل" } }),
    });
    const { result } = renderHook(() => useCreateLabelLayout(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ name: "دوبلكيت" } as never);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("اسم التخطيط مستخدم بالفعل");
  });
});
