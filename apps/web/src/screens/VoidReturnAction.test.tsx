// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { SessionDTO } from "@mezan/contracts";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import { ReturnFamily, VoidReturnAction, VoidReturnReasonNotice, type VoidableReturn } from "./VoidReturnAction";

const returned = (status: string, over: Partial<VoidableReturn> = {}): VoidableReturn => ({ id: "R-1", docNo: "SR-000001", status, voidReason: null, ...over });
const viewer: SessionDTO = { ...testAdminSession, permissions: ["sales.return.view", "purchases.return.view"] };
const trigger = () => screen.queryByRole("button", { name: "إلغاء المرتجع" });

describe("VoidReturnAction — «إلغاء المرتجع» on a confirmed return", () => {
  it.each([ReturnFamily.Sales, ReturnFamily.Purchases])("is offered only on a confirmed %s return to a caller who may void it", (family) => {
    for (const [document, session] of [
      [returned("confirmed"), viewer],
      [returned("draft"), testAdminSession],
      [returned("reversed"), testAdminSession],
    ] as const) {
      const { unmount } = renderWithProviders(<VoidReturnAction family={family} document={document} />, { transport: stubTransport({}), initialSession: session });
      expect(trigger()).toBeNull();
      unmount();
    }
    renderWithProviders(<VoidReturnAction family={family} document={returned("confirmed")} />, { transport: stubTransport({}), initialSession: testAdminSession });
    expect(trigger()).not.toBeNull();
  });

  it.each([
    [ReturnFamily.Sales, "POST /sales-returns/*/void"],
    [ReturnFamily.Purchases, "POST /purchase-returns/*/void"],
  ])("asks for confirmation and a reason, sends it once to the %s route, and shows the server's Arabic refusal", async (family, route) => {
    const sent: unknown[] = [];
    let refuse = true;
    const transport = stubTransport({
      [route]: (init) => {
        sent.push(JSON.parse((init?.body as string) ?? "{}"));
        if (refuse) return { status: 409, body: { error: "RETURN_HAS_REFUNDS", message: "اعكس سند الرد أولاً ثم ألغِ المرتجع." } };
        return { body: returned("reversed", { voidReason: "خطأ" }) };
      },
    });
    renderWithProviders(<VoidReturnAction family={family} document={returned("confirmed")} />, { transport, initialSession: testAdminSession });
    fireEvent.click(trigger()!);
    const confirm = () => screen.getAllByRole("button", { name: "إلغاء المرتجع" }).at(-1)!;
    expect(confirm()).toBeDisabled();
    expect(sent).toEqual([]);
    fireEvent.change(screen.getByLabelText("سبب الإلغاء"), { target: { value: "  خطأ  " } });
    fireEvent.click(confirm());
    expect(await screen.findByRole("alert")).toHaveTextContent("اعكس سند الرد أولاً");
    refuse = false;
    fireEvent.click(confirm());
    await waitFor(() => expect(screen.queryByLabelText("سبب الإلغاء")).toBeNull());
    expect(sent).toEqual([{ reason: "خطأ" }, { reason: "خطأ" }]);
  });

  it("sends one void while the first is in flight", async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const answered = stubTransport({ "POST /sales-returns/*/void": () => ({ body: returned("reversed", { voidReason: "خطأ" }) }) });
    const transport: typeof answered = async (path, init) => {
      if ((init?.method ?? "GET") !== "POST") return answered(path, init);
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return answered(path, init);
    };
    renderWithProviders(<VoidReturnAction family={ReturnFamily.Sales} document={returned("confirmed")} />, { transport, initialSession: testAdminSession });
    fireEvent.click(trigger()!);
    fireEvent.change(screen.getByLabelText("سبب الإلغاء"), { target: { value: "خطأ" } });
    const confirm = () => screen.getAllByRole("button", { name: "إلغاء المرتجع" }).at(-1)!;
    fireEvent.click(confirm());
    await waitFor(() => expect(confirm()).toBeDisabled());
    fireEvent.click(confirm());
    expect(calls).toBe(1);
    release?.();
    await waitFor(() => expect(screen.queryByLabelText("سبب الإلغاء")).toBeNull());
  });
});

describe("VoidReturnReasonNotice — the reason on the voided return", () => {
  it("states why a return was voided, and says nothing on a standing one", () => {
    const { unmount } = renderWithProviders(<VoidReturnReasonNotice document={returned("reversed", { voidReason: "أُدخل على الفاتورة الخطأ" })} />, { transport: stubTransport({}), initialSession: testAdminSession });
    expect(screen.getByRole("note")).toHaveTextContent("سبب الإلغاء: أُدخل على الفاتورة الخطأ");
    unmount();
    renderWithProviders(<VoidReturnReasonNotice document={returned("confirmed")} />, { transport: stubTransport({}), initialSession: testAdminSession });
    expect(screen.queryByRole("note")).toBeNull();
  });
});
