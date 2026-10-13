// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { EquipmentLogDTO } from "@mezan/contracts";
import { EquipmentLogsScreen } from "./EquipmentLogsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../../data/test-support";

const log = (overrides: Partial<EquipmentLogDTO>): EquipmentLogDTO => ({
  id: "eq-1",
  docNo: "EQL-0001",
  projectId: "prj-1",
  assetId: "ast-1",
  date: "2026-06-10",
  hours: "8.000000",
  hourlyRate: "250.000000",
  amount: "2000.000000",
  boqLineId: null,
  notes: null,
  status: "confirmed",
  journalEntryId: "je-1",
  createdAt: "2026-06-10T08:00:00.000Z",
  confirmedAt: "2026-06-10T09:00:00.000Z",
  ...overrides,
});

function renderScreen(initial: EquipmentLogDTO[]) {
  let rows = initial;
  const bodies: unknown[] = [];
  const transport = stubTransport({
    "GET /contracting/site/equipment-logs": () => ({ body: rows }),
    "GET /projects": () => ({ body: [] }),
    "GET /assets": () => ({ body: [] }),
    "POST /contracting/site/equipment-logs/eq-1/reverse": (init) => {
      bodies.push(JSON.parse((init?.body as string) ?? "{}"));
      rows = rows.map((row) => (row.id === "eq-1" ? { ...row, status: "reversed" } : row));
      return { body: rows[0] };
    },
  });
  renderWithProviders(<EquipmentLogsScreen />, { transport, initialSession: testAdminSession });
  return bodies;
}

const rowOf = (docNo: string) => screen.getByText(docNo).closest("tr") as HTMLElement;

describe("EquipmentLogsScreen — reversing a confirmed log", () => {
  it("reverses a confirmed log with a reason, and the refreshed row reads reversed with nothing left to do on it", async () => {
    const bodies = renderScreen([log({}), log({ id: "eq-2", docNo: null, status: "draft", journalEntryId: null, confirmedAt: null })]);
    await screen.findByText("EQL-0001");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات EQL-0001" }));
    fireEvent.click(within(rowOf("EQL-0001")).getByRole("menuitem", { name: "عكس سجل التشغيل" }));
    const dialog = screen.getByRole("dialog", { name: "عكس سجل تشغيل المعدة؟" });
    fireEvent.change(within(dialog).getByLabelText("سبب العكس"), { target: { value: "سُجّلت الساعات على مشروع آخر" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "عكس سجل التشغيل" }));
    await waitFor(() => expect(bodies).toEqual([{ memo: "سُجّلت الساعات على مشروع آخر" }]));
    await waitFor(() => expect(within(rowOf("EQL-0001")).getByText("معكوس")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "إجراءات EQL-0001" })).not.toBeInTheDocument();
  });

  it("a log reversed earlier is shown as reversed, never as a draft", async () => {
    renderScreen([log({ status: "reversed" })]);
    const row = (await screen.findByText("EQL-0001")).closest("tr") as HTMLElement;
    expect(within(row).getByText("معكوس")).toBeInTheDocument();
    expect(within(row).queryByText("مسودة")).not.toBeInTheDocument();
  });

  it("a draft log offers confirmation and no reversal", async () => {
    renderScreen([log({ id: "eq-2", docNo: "EQL-0002", status: "draft", journalEntryId: null, confirmedAt: null })]);
    await screen.findByText("EQL-0002");
    fireEvent.click(screen.getByRole("button", { name: "إجراءات EQL-0002" }));
    expect(screen.queryByRole("menuitem", { name: "عكس سجل التشغيل" })).not.toBeInTheDocument();
  });
});
