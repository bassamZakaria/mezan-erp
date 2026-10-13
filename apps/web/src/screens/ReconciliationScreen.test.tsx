// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReconciliationReportDTO } from "@mezan/contracts";
import { ReconciliationScreen } from "./ReconciliationScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function report(overrides: Partial<ReconciliationReportDTO> = {}): ReconciliationReportDTO {
  return {
    rows: [
      {
        key: "customers",
        label: "العملاء",
        controlAccountId: "acc-1103",
        subLedgerBalance: "5000.000000",
        glBalance: "5000.000000",
        difference: "0.000000",
        matched: true,
      },
      {
        key: "suppliers",
        label: "الموردون",
        controlAccountId: "acc-2101",
        subLedgerBalance: "3000.000000",
        glBalance: "2900.000000",
        difference: "100.000000",
        matched: false,
      },
    ],
    allMatched: false,
    unlinked: [
      { entryId: "entry-1", entryNo: "JE-000001", date: "2026-08-10", accountId: "acc-1103", memo: "قيد يدوي", debit: "100.000000", credit: "0.000000" },
    ],
    ...overrides,
  };
}

function renderScreen(data: ReconciliationReportDTO = report()) {
  let calls = 0;
  const transport = stubTransport({
    "GET /reconciliation": () => {
      calls += 1;
      return { body: data };
    },
  });
  const result = renderWithProviders(<ReconciliationScreen />, { transport, initialSession: testAdminSession });
  return { ...result, getCalls: () => calls };
}

describe("ReconciliationScreen", () => {
  it("lists reconciliation rows with money formatted, never a raw scaled-decimal string", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "مطابقة الأرصدة" })).toBeInTheDocument();
    expect(await screen.findByText("العملاء")).toBeInTheDocument();
    expect(screen.getByText("الموردون")).toBeInTheDocument();
    expect(screen.getAllByText("5,000.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("5000.000000")).not.toBeInTheDocument();
    expect(screen.getByText("متطابق")).toBeInTheDocument();
    expect(screen.getByText("غير متطابق")).toBeInTheDocument();
  });

  it("shows the not-all-matched banner when a row disagrees, and the all-matched banner otherwise", async () => {
    renderScreen(report({ allMatched: false }));
    expect(await screen.findByText("توجد فروقات تحتاج إلى مراجعة")).toBeInTheDocument();
  });

  it("shows the all-matched banner when every row agrees", async () => {
    renderScreen(report({ allMatched: true, rows: [{ key: "customers", label: "العملاء", controlAccountId: "a", subLedgerBalance: "5000.000000", glBalance: "5000.000000", difference: "0.000000", matched: true }] }));
    expect(await screen.findByText("جميع الأرصدة متطابقة")).toBeInTheDocument();
  });

  it("switches to the unlinked tab, showing its own entries independent of the summary table", async () => {
    renderScreen();
    await screen.findByText("العملاء");
    fireEvent.click(screen.getByText(/القيود غير المرتبطة/));
    expect(await screen.findByText("JE-000001")).toBeInTheDocument();
    expect(screen.getByText("قيد يدوي")).toBeInTheDocument();
    expect(screen.queryByText("العملاء")).not.toBeInTheDocument();
  });

  it("shows the linked-everything message on the unlinked tab when there is nothing unlinked", async () => {
    renderScreen(report({ unlinked: [] }));
    await screen.findByText("العملاء");
    fireEvent.click(screen.getByText(/القيود غير المرتبطة/));
    expect(await screen.findByText("جميع بنود حسابات المراقبة مخصصة بشكل صحيح")).toBeInTheDocument();
  });

  it("shows an Arabic error banner with a working retry on load failure", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /reconciliation": () => {
        calls += 1;
        return calls === 1 ? { status: 500, body: { error: "SERVER_ERROR" } } : { body: report() };
      },
    });
    renderWithProviders(<ReconciliationScreen />, { transport, initialSession: testAdminSession });
    expect(await screen.findByText("تعذّر تحميل مطابقة الأرصدة. (رمز 500)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await screen.findByText("العملاء");
    await waitFor(() => expect(screen.queryByText("تعذّر تحميل مطابقة الأرصدة. (رمز 500)")).not.toBeInTheDocument());
  });

  it("the empty state renders honestly when there are no control-account rows", async () => {
    renderScreen(report({ rows: [], allMatched: true }));
    expect(await screen.findByText("لا توجد حسابات مراقبة")).toBeInTheDocument();
  });

  it("the refresh button re-fetches the report", async () => {
    const { getCalls } = renderScreen();
    await screen.findByText("العملاء");
    expect(getCalls()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "تحديث" }));
    await waitFor(() => expect(getCalls()).toBe(2));
  });
});

describe("ReconciliationScreen — stock moved in a different month from its entry", () => {
  const allTied = report({ rows: report().rows.map((row) => ({ ...row, glBalance: row.subLedgerBalance, difference: "0.000000", matched: true })), allMatched: true, unlinked: [] });

  it("counts and lists each document with the day its stock moved and the day its entry is dated, and no longer says every balance matches", async () => {
    renderScreen({ ...allTied, stockLedgerDates: { count: 1, rows: [{ docType: "ADJUSTMENT", docId: "adj-9", docNo: "ADJ-000009", movedOn: "2026-08-31", postedOn: ["2026-09-01"] }] } });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("مستندات تحركت كميتها في شهر وقيدها في شهر آخر (1)");
    expect(alert).toHaveTextContent("ADJ-000009");
    expect(alert).toHaveTextContent("2026-08-31");
    expect(alert).toHaveTextContent("2026-09-01");
    expect(screen.queryByText("جميع الأرصدة متطابقة")).not.toBeInTheDocument();
  });

  it("says nothing when there is none", async () => {
    renderScreen({ ...allTied, stockLedgerDates: { count: 0, rows: [] } });
    await screen.findByText("العملاء");
    expect(screen.queryByText(/تحركت كميتها في شهر/)).not.toBeInTheDocument();
  });
});
