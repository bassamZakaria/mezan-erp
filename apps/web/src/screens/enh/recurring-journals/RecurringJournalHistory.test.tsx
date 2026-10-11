// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { RecurringJournalHistory } from "./RecurringJournalsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../../../data/test-support";

const run = (id: string, period: string) => ({ id, templateId: "tpl-1", period, journalEntryId: `je-${id}`, journalEntryNo: `JE-${id}`, reversalJournalEntryId: null, reversalJournalEntryNo: null, generatedAt: `${period}-01T00:00:00.000Z`, generatedBy: "admin" });

function show(onReverse: (runId: string, body: unknown) => { status?: number; body: unknown }) {
  const transport = stubTransport({
    "GET /gl/recurring/runs": () => ({ body: [run("r1", "2026-09"), run("r2", "2026-10")] }),
    "GET /gl/recurring/skips": () => ({ body: [] }),
    "GET /gl/recurring/templates": () => ({ body: [{ id: "tpl-1", nameAr: "رسوم اشتراك", nameEn: null, memo: "", frequency: "monthly", dayOfPeriod: 1, yearlyMonth: null, startDate: "2026-01-01", endDate: null, autoReverseNextPeriod: false, status: "active", lines: [] }] }),
    "POST /gl/recurring/runs/*/reverse": (init, path) => onReverse(path.split("/")[4]!, JSON.parse(String(init?.body ?? "{}"))),
  });
  renderWithProviders(<RecurringJournalHistory />, { transport, initialSession: testAdminSession });
}

describe("reversing a recurring run's entry from the run history", () => {
  it("sends the reversal for that run only, dated today", async () => {
    const sent: [string, unknown][] = [];
    show((runId, body) => {
      sent.push([runId, body]);
      return { status: 201, body: { runId, entryStatus: "reversed" } };
    });
    fireEvent.click(await screen.findByRole("button", { name: "إجراءات 2026-09" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "عكس قيد الدورة" }));
    fireEvent.click(await screen.findByRole("button", { name: "عكس قيد الدورة" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]![0]).toBe("r1");
    expect(sent[0]![1]).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  });

  it("shows the server's refusal", async () => {
    show(() => ({ status: 409, body: { message: "القيد مسودة ولم يُرحَّل بعد." } }));
    fireEvent.click(await screen.findByRole("button", { name: "إجراءات 2026-10" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "عكس قيد الدورة" }));
    fireEvent.click(await screen.findByRole("button", { name: "عكس قيد الدورة" }));
    expect(await screen.findByText("القيد مسودة ولم يُرحَّل بعد.")).toBeInTheDocument();
  });
});
