// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DOCUMENT_REVERSAL_PATHS, ReversalDocumentType } from "@mezan/contracts";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";
import type { Transport, TransportResponse } from "../data/transport";
import { useApi } from "../data/ApiContext";
import { useQuery } from "@tanstack/react-query";
import { ReverseDocumentAction, useReverseDocumentAction } from "./ReverseDocumentAction";

const RUNS = [
  { id: "run-a", subject: "تشغيل مايو" },
  { id: "run-b", subject: "تشغيل يونيو" },
];

function TwoRows() {
  const { request } = useApi();
  const list = useQuery({ queryKey: ["runs"], queryFn: async () => (await request("/inventory/writedown-runs")).json<{ loads: number }>() });
  const reversal = useReverseDocumentAction(ReversalDocumentType.WritedownRun);
  return (
    <div>
      <output aria-label="loads">{list.data?.loads ?? 0}</output>
      {RUNS.map((run) => (
        <button key={run.id} type="button" disabled={reversal.pendingId === run.id} onClick={() => void reversal.ask({ id: run.id, params: { id: run.id }, subject: run.subject })}>
          {`عكس ${run.subject}`}
        </button>
      ))}
      {reversal.dialog}
    </div>
  );
}

function transportWith(reverse: (init: RequestInit | undefined, path: string) => StubResult | Promise<StubResult>): { transport: Transport; calls: { path: string; body: unknown }[] } {
  let loads = 0;
  const calls: { path: string; body: unknown }[] = [];
  const base = stubTransport({ "GET /inventory/writedown-runs": () => ({ body: { loads: ++loads } }) });
  const transport: Transport = async (path, init) => {
    if ((init?.method ?? "GET") !== "POST") return base(path, init);
    calls.push({ path, body: JSON.parse((init?.body as string) ?? "{}") });
    const result = await reverse(init, path);
    const status = result.status ?? 200;
    const response: TransportResponse = { status, ok: status < 400, json: <T,>() => Promise.resolve(result.body as T), text: () => Promise.resolve(JSON.stringify(result.body)) };
    return response;
  };
  return { transport, calls };
}

const session = (permissions: string[]) => ({ ...testAdminSession, permissions });

describe("ReverseDocumentAction", () => {
  it("renders nothing for a seat without the route's permission", () => {
    const { transport } = transportWith(() => ({ body: {} }));
    renderWithProviders(<ReverseDocumentAction type={ReversalDocumentType.WritedownRun} target={{ id: "run-a", params: { id: "run-a" }, subject: "تشغيل مايو" }} />, { transport, initialSession: session(["inventory.writedown.view"]) });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing for a seat that holds only the permission the route used to ride on", () => {
    const { transport } = transportWith(() => ({ body: {} }));
    renderWithProviders(<ReverseDocumentAction type={ReversalDocumentType.WritedownRun} target={{ id: "run-a", params: { id: "run-a" }, subject: "تشغيل مايو" }} />, { transport, initialSession: session(["inventory.writedown.view", DOCUMENT_REVERSAL_PATHS[ReversalDocumentType.WritedownRun].replaces]) });
    expect(DOCUMENT_REVERSAL_PATHS[ReversalDocumentType.WritedownRun].permission).toBe("inventory.writedown.reverse");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the action to a seat holding the permission the registry names", () => {
    const { transport } = transportWith(() => ({ body: {} }));
    renderWithProviders(<ReverseDocumentAction type={ReversalDocumentType.WritedownRun} target={{ id: "run-a", params: { id: "run-a" }, subject: "تشغيل مايو" }} />, { transport, initialSession: session([DOCUMENT_REVERSAL_PATHS[ReversalDocumentType.WritedownRun].permission]) });
    expect(screen.getByRole("button", { name: "عكس تشغيل الهبوط" })).toBeEnabled();
  });

  it("asks for a reason before it sends, then posts the reason and the date to the registry's route", async () => {
    const { transport, calls } = transportWith(() => ({ body: {} }));
    renderWithProviders(<TwoRows />, { transport, initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("button", { name: "عكس تشغيل مايو" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/تشغيل مايو/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "عكس تشغيل الهبوط" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("سبب العكس"), { target: { value: "   " } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("سبب العكس"), { target: { value: "أُدخلت الفترة خطأ" } });
    fireEvent.change(within(dialog).getByLabelText("تاريخ العكس"), { target: { value: "2026-06-30" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls).toEqual([{ path: "/inventory/writedown-runs/run-a/reverse", body: { memo: "أُدخلت الفترة خطأ", date: "2026-06-30" } }]);
  });

  it("keeps the dialog open on a refusal and shows the server's own sentence", async () => {
    const { transport } = transportWith(() => ({ status: 422, body: { error: "PERIOD_CLOSED", message: "الفترة «يونيو 2026» مغلقة؛ أعد فتحها أولاً.", messageEn: "June 2026 is closed." } }));
    renderWithProviders(<TwoRows />, { transport, initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("button", { name: "عكس تشغيل مايو" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("سبب العكس"), { target: { value: "خطأ" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "عكس تشغيل الهبوط" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("الفترة «يونيو 2026» مغلقة؛ أعد فتحها أولاً.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "عكس تشغيل مايو" })).toBeEnabled();
  });

  it("marks only the row being reversed as pending, and refreshes the lists once it settles", async () => {
    let release: (result: StubResult) => void = () => {};
    const { transport } = transportWith(() => new Promise<StubResult>((resolve) => { release = resolve; }));
    renderWithProviders(<TwoRows />, { transport, initialSession: testAdminSession });
    await waitFor(() => expect(screen.getByLabelText("loads")).toHaveTextContent("1"));
    fireEvent.click(screen.getByRole("button", { name: "عكس تشغيل مايو" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("سبب العكس"), { target: { value: "خطأ" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "عكس تشغيل الهبوط" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "عكس تشغيل مايو" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "عكس تشغيل يونيو" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "عكس تشغيل الهبوط" })).toBeDisabled();
    release({ body: {} });
    await waitFor(() => expect(screen.getByRole("button", { name: "عكس تشغيل مايو" })).toBeEnabled());
    await waitFor(() => expect(screen.getByLabelText("loads")).toHaveTextContent("2"));
  });

  it("sends no reason field on a route that takes none", async () => {
    const { transport, calls } = transportWith(() => ({ body: {} }));
    renderWithProviders(<ReverseDocumentAction type={ReversalDocumentType.Cheque} target={{ id: "chq-1", params: { id: "chq-1" }, subject: "شيك 1001" }} />, { transport, initialSession: testAdminSession });
    fireEvent.click(screen.getByRole("button", { name: "ارتداد بعد التحصيل" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("سبب العكس")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "ارتداد بعد التحصيل" }));
    await waitFor(() => expect(calls).toEqual([{ path: "/cheques/chq-1/return", body: {} }]));
  });
});
