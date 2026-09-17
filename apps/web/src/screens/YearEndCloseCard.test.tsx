// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { screen, fireEvent, within, waitFor } from "@testing-library/react";
import type { AccountDTO, FiscalPeriodDTO, YearEndClosePreviewDTO } from "@mezan/contracts";
import type { JournalEntryDTO } from "../data/hooks";
import { YearEndCloseCard } from "./YearEndCloseCard";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";

function fieldInput(container: HTMLElement, labelText: string): HTMLElement {
  const label = within(container).getByText(labelText);
  const input = label.parentElement?.querySelector("input");
  if (!input) throw new Error(`no input found next to label "${labelText}"`);
  return input;
}

function pickFromCombobox(container: HTMLElement, label: string, optionLabel: string) {
  const input = within(container).getByLabelText(label);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: optionLabel } });
  const option = within(container).getByRole("button", { name: (accessibleName) => accessibleName.startsWith(optionLabel) });
  fireEvent.mouseDown(option);
}

const accounts: AccountDTO[] = [
  { id: "acc-3900", code: "3900", nameAr: "الأرباح المرحّلة", nameEn: null, type: "equity", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "acc-3800", code: "3800", nameAr: "رأس المال", nameEn: null, type: "equity", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
  { id: "acc-3000", code: "3000", nameAr: "حقوق الملكية", nameEn: null, type: "equity", naturalBalance: "credit", parentId: null, isHeader: true, status: "active" },
  { id: "acc-5000", code: "5000", nameAr: "مصروفات عمومية", nameEn: null, type: "expense", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
];

function openPeriods(count: number): FiscalPeriodDTO[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `period-${i}`,
    year: 2026,
    periodNumber: i + 1,
    startDate: `2026-${String(i + 1).padStart(2, "0")}-01`,
    endDate: `2026-${String(i + 1).padStart(2, "0")}-28`,
    status: "open" as const,
  }));
}

function preview(overrides: Partial<YearEndClosePreviewDTO> = {}): YearEndClosePreviewDTO {
  return {
    year: 2026,
    entryId: "entry-preview",
    date: "2026-12-31",
    netResult: "5000.000000",
    revenueClosed: "20000.000000",
    expensesClosed: "15000.000000",
    lines: [
      { accountId: "acc-4100", accountCode: "4100", accountNameAr: "المبيعات", accountType: "revenue", projectId: null, debit: "20000.000000", credit: "0" },
      { accountId: "acc-5000", accountCode: "5000", accountNameAr: "مصروفات عمومية", accountType: "expense", projectId: null, debit: "0", credit: "15000.000000" },
    ],
    ...overrides,
  };
}

function postedEntry(overrides: Partial<JournalEntryDTO> = {}): JournalEntryDTO {
  return {
    id: "je-year-close",
    entryNo: "JE-000099",
    date: "2026-12-31",
    memo: "إقفال سنة 2026",
    status: "posted",
    source: "system",
    createdAt: "2026-12-31T00:00:00.000Z",
    postedAt: "2026-12-31T00:00:00.000Z",
    reversesEntryId: null,
    reversedByEntryId: null,
    sourceDocType: null,
    sourceDocId: null,
    sourceDocNumber: null,
    sourceModule: "manual",
    lines: [],
    ...overrides,
  };
}

function renderCard(opts: {
  previewStatus?: number;
  previewBody?: YearEndClosePreviewDTO | null;
  entry?: JournalEntryDTO | null;
  periods?: FiscalPeriodDTO[];
  closeStatus?: number;
  closeBody?: unknown;
} = {}) {
  const periods = opts.periods ?? [];
  let lastCloseBody: unknown = null;
  const transport = stubTransport({
    "GET /accounts": () => ({ body: accounts }),
    "GET /gl/year-end-close/*/preview": () =>
      opts.previewStatus !== undefined
        ? { status: opts.previewStatus, body: {} }
        : { body: opts.previewBody === undefined ? preview() : opts.previewBody },
    "GET /gl/journal-entries/*": () => (opts.entry === undefined ? { status: 404, body: {} } : opts.entry === null ? { status: 404, body: {} } : { body: opts.entry }),
    "POST /gl/year-end-close": (init) => {
      lastCloseBody = JSON.parse((init?.body as string) ?? "{}");
      if (opts.closeStatus !== undefined) return { status: opts.closeStatus, body: opts.closeBody ?? {} };
      return { body: { journalEntryId: "je-new", year: 2026, netResult: "5000.000000", revenueClosed: "20000.000000", expensesClosed: "15000.000000", accountsClosed: 2 } };
    },
  });
  const result = renderWithProviders(<YearEndCloseCard year={2026} periodsInYear={periods} />, { transport, initialSession: testAdminSession });
  return { ...result, getCloseBody: () => lastCloseBody };
}

describe("YearEndCloseCard", () => {
  it("shows the loading state while the preview/entry queries are in flight", () => {
    const transport = stubTransport({
      "GET /accounts": () => new Promise(() => {}) as never,
      "GET /gl/year-end-close/*/preview": () => new Promise(() => {}) as never,
      "GET /gl/journal-entries/*": () => new Promise(() => {}) as never,
    });
    renderWithProviders(<YearEndCloseCard year={2026} periodsInYear={[]} />, { transport, initialSession: testAdminSession });
    expect(screen.getByText("جارِ التحميل…")).toBeInTheDocument();
  });

  it("already-closed state: shows the posted entry and hides the preview/action UI, never calls close", async () => {
    renderCard({ entry: postedEntry() });
    expect(await screen.findByText("مقفلة")).toBeInTheDocument();
    expect(screen.getByText("JE-000099")).toBeInTheDocument();
    expect(screen.getByText("القيد مُرحَّل ونهائي — يُصحَّح بقيد عكسي، ولا يُعدَّل ولا يُحذف.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إقفال السنة المالية" })).not.toBeInTheDocument();
  });

  it("nothing-to-close state: shows the Arabic message and offers no action button", async () => {
    renderCard({ previewStatus: 409 });
    expect(await screen.findByText("لا توجد أرصدة إيرادات أو مصروفات لإقفالها في سنة 2026.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "إقفال السنة المالية" })).not.toBeInTheDocument();
  });

  it("plan preview: renders money formatted (never raw), net result labeled profit/loss by sign", async () => {
    renderCard({ previewBody: preview({ netResult: "5000.000000" }) });
    expect(await screen.findByText("صافي الربح")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("20000.000000")).not.toBeInTheDocument());
    expect(screen.getAllByText("2").length).toBeGreaterThan(0); // accountsToClose = lines.length
  });

  it("a negative net result renders as a labeled loss, with the absolute value shown", async () => {
    renderCard({ previewBody: preview({ netResult: "-3000.000000" }) });
    expect(await screen.findByText("صافي الخسارة")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("-3000.000000")).not.toBeInTheDocument());
    expect(screen.queryByText("3000.000000")).not.toBeInTheDocument();
  });

  it("defaults the equity picker to account code 3900 when present, but the confirmed close posts the REAL picked account id", async () => {
    const { getCloseBody } = renderCard();
    await screen.findByText("صافي الربح");
    fireEvent.click(screen.getByRole("button", { name: "إقفال السنة المالية" }));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الإقفال" }));
    await waitFor(() => expect(getCloseBody()).not.toBeNull());
    expect((getCloseBody() as Record<string, unknown>).retainedEarningsAccountId).toBe("acc-3900");
  });

  it("picking a different equity account overrides the 3900 default in the close request", async () => {
    const { getCloseBody } = renderCard();
    await screen.findByText("صافي الربح");
    pickFromCombobox(document.body, "حساب الأرباح المرحّلة", "رأس المال");
    fireEvent.click(screen.getByRole("button", { name: "إقفال السنة المالية" }));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الإقفال" }));
    await waitFor(() => expect(getCloseBody()).not.toBeNull());
    expect((getCloseBody() as Record<string, unknown>).retainedEarningsAccountId).toBe("acc-3800");
  });

  it("only header equity accounts and non-equity accounts are excluded from the picker", async () => {
    renderCard();
    await screen.findByText("صافي الربح");
    fireEvent.focus(fieldInput(document.body, "بيان القيد (اختياري)"));
    const input = within(document.body).getByLabelText("حساب الأرباح المرحّلة");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "حقوق" } });
    expect(screen.queryByRole("button", { name: /^حقوق الملكية/ })).not.toBeInTheDocument();
  });

  it("the two-step confirm flow: only Confirm posts, Cancel dismisses without posting", async () => {
    const { getCloseBody } = renderCard();
    await screen.findByText("صافي الربح");
    fireEvent.click(screen.getByRole("button", { name: "إقفال السنة المالية" }));
    expect(screen.getByText("تأكيد إقفال سنة 2026؟")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    expect(screen.queryByText("تأكيد إقفال سنة 2026؟")).not.toBeInTheDocument();
    expect(getCloseBody()).toBeNull();
  });

  it("a server refusal on close renders an Arabic message, not raw JSON", async () => {
    renderCard({ closeStatus: 400, closeBody: { message: "توجد فترات غير مقفلة قبل هذه السنة" } });
    await screen.findByText("صافي الربح");
    fireEvent.click(screen.getByRole("button", { name: "إقفال السنة المالية" }));
    fireEvent.click(screen.getByRole("button", { name: "تأكيد الإقفال" }));
    expect(await screen.findByText("توجد فترات غير مقفلة قبل هذه السنة")).toBeInTheDocument();
  });

  it("shows the open-fiscal-periods warning with the real count", async () => {
    renderCard({ periods: openPeriods(3) });
    expect(await screen.findByText("ما زالت هناك فترات مفتوحة في سنة 2026 عددها 3؛ أي قيد يُرحَّل إليها بعد الإقفال لن يدخل في نتيجة السنة المُرحَّلة.")).toBeInTheDocument();
  });

  it("no warning when every period in the year is already closed", async () => {
    renderCard({ periods: [{ id: "p1", year: 2026, periodNumber: 1, startDate: "2026-01-01", endDate: "2026-01-31", status: "closed" }] });
    await screen.findByText("صافي الربح");
    await waitFor(() => expect(screen.queryByText(/فترات مفتوحة/)).not.toBeInTheDocument());
  });
});
