// @vitest-environment jsdom
import { act, render, renderHook, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { IdempotencyRefusal } from "@mezan/contracts";
import { ApiError } from "../data/hooks";
import { AlreadySavedNotice, useAlreadySavedNotice, useDocumentId } from "./document-id";

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

const reused = () => new ApiError(409, "سبق تسجيل مستند بهذا المعرّف", undefined, undefined, IdempotencyRefusal.KeyReused);

describe("useDocumentId", () => {
  it("keeps one id across renders and across a save that failed, and mints another only when told the save succeeded", () => {
    const { result, rerender } = renderHook(() => useDocumentId(() => undefined), { wrapper });
    const first = result.current.current();
    rerender();
    expect(result.current.recover(new ApiError(503, "busy"))).toBe(false);
    expect(result.current.current()).toBe(first);

    act(() => result.current.renew());
    expect(result.current.current()).not.toBe(first);
  });

  it("hands over the saved document's id and mints a new one when the server says the id already holds a document", () => {
    const onAlreadySaved = vi.fn();
    const { result } = renderHook(() => useDocumentId(onAlreadySaved), { wrapper });
    const first = result.current.current();

    expect(result.current.recover(reused())).toBe(true);

    expect(onAlreadySaved).toHaveBeenCalledExactlyOnceWith(first);
    expect(result.current.current()).not.toBe(first);
  });

  it("calls the handler it was last rendered with, not the one from its first render", () => {
    const stale = vi.fn();
    const fresh = vi.fn();
    const { result, rerender } = renderHook(({ handler }) => useDocumentId(handler), { initialProps: { handler: stale }, wrapper });
    rerender({ handler: fresh });

    result.current.recover(reused());

    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("leaves every other failure to the form", () => {
    const onAlreadySaved = vi.fn();
    const { result } = renderHook(() => useDocumentId(onAlreadySaved), { wrapper });
    expect(result.current.recover(new Error("network"))).toBe(false);
    expect(result.current.recover(new ApiError(409, "duplicate number", undefined, undefined, "DUPLICATE_NUMBER"))).toBe(false);
    expect(onAlreadySaved).not.toHaveBeenCalled();
  });
});

describe("the already-saved notice", () => {
  function Harness({ openId }: { openId: string | null }) {
    const notice = useAlreadySavedNotice();
    return (
      <div>
        <button onClick={() => notice.show("doc-1")}>recover</button>
        <AlreadySavedNotice notice={notice} openId={openId} message="سبق حفظ هذا المستند" dismissLabel="إخفاء" />
      </div>
    );
  }

  it("shows beside the document it is about, and is gone once another document is open or it is dismissed", () => {
    const { rerender } = render(<Harness openId="doc-1" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("recover"));
    expect(screen.getByRole("status")).toHaveTextContent("سبق حفظ هذا المستند");

    rerender(<Harness openId="doc-2" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<Harness openId="doc-1" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("recover"));
    fireEvent.click(screen.getByRole("button", { name: "إخفاء" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
