// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { RecurringJournalHistory } from "./RecurringJournalsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../../data/test-support";

const run = (id: string, period: string) => ({ id, templateId: "tpl-1", period, journalEntryId: `je-${id}`, journalEntryNo: `JE-${id}`, reversalJournalEntryId: null, reversalJournalEntryNo: null, generatedAt: `${period}-01T00:00:00.000Z`, generatedBy: "admin" });

function show(onReverse: (runId: string, body: unknown) => { status?: number; body: unknown }, runs: unknown[] = [run("r1", "2026-09"), run("r2", "2026-10")]) {
  const transport = stubTransport({
    "GET /gl/recurring/runs": () => ({ body: runs }),
    "GET /gl/recurring/skips": () => ({ body: [] }),
    "GET /gl/recurring/templates": () => ({ body: [{ id: "tpl-1", nameAr: "رسوم اشتراك", nameEn: null, memo: "", frequency: "monthly", dayOfPeriod: 1, yearlyMonth: null, startDate: "2026-01-01", endDate: null, autoReverseNextPeriod: false, status: "active", lines: [] }] }),
    "POST /gl/recurring/runs/*/reverse": (init, path) => onReverse(path.split("/")[4]!, JSON.parse(String(init?.body ?? "{}"))),
  });
  renderWithProviders(<RecurringJournalHistory />, { transport, initialSession: testAdminSession });
}

async function reverseFromMenu(period: string, reason: string) {
  fireEvent.click(await screen.findByRole("button", { name: `إجراءات ${period}` }));
  fireEvent.click(screen.getByRole("menuitem", { name: "عكس قيد الدورة" }));
  const confirm = await screen.findByRole("button", { name: "عكس قيد الدورة" });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/سبب/), { target: { value: reason } });
  fireEvent.click(confirm);
}

describe("reversing a recurring run's entry from the run history", () => {
  it("asks for a reason first, then sends the reversal for that run only, with the reason", async () => {
    const sent: [string, unknown][] = [];
    show((runId, body) => {
      sent.push([runId, body]);
      return { status: 201, body: { runId, entryStatus: "reversed" } };
    });
    await reverseFromMenu("2026-09", "قيد مكرر بالخطأ");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]![0]).toBe("r1");
    expect(sent[0]![1]).toEqual({ memo: "قيد مكرر بالخطأ" });
  });

  it("shows the server's refusal", async () => {
    show(() => ({ status: 409, body: { message: "القيد مسودة ولم يُرحَّل بعد." } }));
    await reverseFromMenu("2026-10", "سبب");
    expect(await screen.findByText("القيد مسودة ولم يُرحَّل بعد.")).toBeInTheDocument();
  });
});

describe("a period that was reversed and generated again", () => {
  const first = { ...run("r1", "2026-09"), generation: 1, entryStatus: "reversed", current: false, reversedByEntryId: "je-rev", reversedByEntryNo: "JE-000200", reversedOn: "2026-10-05" };
  const second = { ...run("r1b", "2026-09"), generation: 2, generatedAt: "2026-10-05T09:00:00.000Z", entryStatus: "posted", current: true, reversedByEntryId: null, reversedByEntryNo: null, reversedOn: null };

  it("keeps the earlier run in the history, marked reversed, with the entry that reversed it and the day", async () => {
    show(() => ({ status: 201, body: {} }), [second, first]);
    await screen.findByText("JE-000200");
    const rows = screen.getAllByRole("row").filter((row) => row.textContent?.includes("2026-09"));
    expect(rows).toHaveLength(2);
    const [current, earlier] = rows as [HTMLElement, HTMLElement];
    expect(current).toHaveTextContent("JE-r1b");
    expect(current).toHaveTextContent("مولَّد");
    expect(earlier).toHaveTextContent("JE-r1");
    expect(earlier).toHaveTextContent("معكوس");
    expect(earlier).toHaveTextContent("JE-000200");
    expect(earlier).toHaveTextContent("2026-10-05");
    expect(within(current).getByText("2", { selector: "[data-generation]" })).toBeInTheDocument();
    expect(within(earlier).getByText("1", { selector: "[data-generation]" })).toBeInTheDocument();
  });

  it("offers the reversal on the run that stands, not on the one already reversed", async () => {
    const sent: string[] = [];
    show((runId) => {
      sent.push(runId);
      return { status: 201, body: { runId, entryStatus: "reversed" } };
    }, [second, first]);
    expect(await screen.findAllByRole("button", { name: "إجراءات 2026-09" })).toHaveLength(1);
    await reverseFromMenu("2026-09", "سبب العكس");
    await waitFor(() => expect(sent).toEqual(["r1b"]));
  });
});

describe("a run whose entry is still a draft", () => {
  const draft = { ...run("r3", "2026-11"), journalEntryId: "3f0c7b1a-52de-4a8e-9d1b-7a6f0c2e4b19", journalEntryNo: null, entryStatus: "draft", current: true };

  it("is named «مسودة» with its template and period, never by the entry's internal id", async () => {
    show(() => ({ status: 201, body: {} }), [draft]);
    const link = await screen.findByRole("button", { name: "مسودة — رسوم اشتراك · 2026-11" });
    expect(link).toBeInTheDocument();
    expect(screen.queryByText(/3f0c7b1a/)).not.toBeInTheDocument();
  });

  it("with its template gone it is still «مسودة» and the period, not an id", async () => {
    show(() => ({ status: 201, body: {} }), [{ ...draft, templateId: "9a1d2c3b-0000-4000-8000-000000000001" }]);
    expect(await screen.findByRole("button", { name: "مسودة · 2026-11" })).toBeInTheDocument();
    expect(screen.queryByText(/3f0c7b1a/)).not.toBeInTheDocument();
  });

  it("a numbered entry is still named by its number", async () => {
    show(() => ({ status: 201, body: {} }), [run("r4", "2026-12")]);
    expect(await screen.findByRole("button", { name: "JE-r4" })).toBeInTheDocument();
  });
});
