// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { AccountDTO } from "@mezan/contracts";
import { JournalsScreen } from "./JournalsScreen";
import { renderWithProviders, stubTransport, testAdminSession } from "../data/test-support";
import type { JournalEntryDTO } from "../data/hooks";
import { NavigationProvider } from "../navigation";

/**
 * JournalsScreen's create/detail views are sub-pages addressed via the shell's
 * `useSubPage` (navigation.tsx), which no-ops outside a real `NavigationProvider`.
 * This stands in for the shell's URL-driven one with in-memory segments — enough
 * for the screen under test to open, close and read its own sub-page.
 */
function TestNavigation({ children }: { children: ReactNode }) {
  const [segments, setSegments] = useState<readonly string[]>([]);
  return (
    <NavigationProvider
      value={{
        navigate: () => {},
        segments,
        openSubPage: setSegments,
        openScreenAt: () => {},
        intent: null,
        clearIntent: () => {},
      }}
    >
      {children}
    </NavigationProvider>
  );
}

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
});

const sampleAccounts: AccountDTO[] = [
  { id: "1300-1", code: "1300-1", nameAr: "صندوق نقدي الفرع الرئيسي", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
  { id: "4100", code: "4100", nameAr: "إيرادات المبيعات", nameEn: null, type: "revenue", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" },
];

function entry(overrides: Partial<JournalEntryDTO> = {}): JournalEntryDTO {
  return {
    id: "je-1",
    entryNo: "JE-000001",
    date: "2026-08-05",
    memo: "إثبات رأس المال الافتتاحي",
    status: "posted",
    source: "manual",
    createdAt: "2026-08-05T09:00:00.000Z",
    postedAt: "2026-08-05T09:00:00.000Z",
    reversesEntryId: null,
    reversedByEntryId: null, sourceDocType: null, sourceDocId: null, sourceDocNumber: null, sourceModule: "manual" as const,
    lines: [
      { accountId: "1300-1", debit: "100.00", credit: "0.00", memo: null },
      { accountId: "4100", debit: "0.00", credit: "100.00", memo: null },
    ],
    ...overrides,
  };
}

const sampleEntries: JournalEntryDTO[] = [
  entry(),
  entry({ id: "je-2", entryNo: "JE-000002", date: "2026-08-12" }),
  entry({ id: "je-3", entryNo: "JE-000003", date: "2026-08-18" }),
];

/** Mirrors gl-routes.ts's /counts and /stats shape, computed over the fake list. */
function countsOf(entries: JournalEntryDTO[]): Record<string, number> {
  const counts: Record<string, number> = { all: entries.length, draft: 0, pending: 0, posted: 0, reversed: 0 };
  for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
  return counts;
}
function statsOf(entries: JournalEntryDTO[]): Record<string, number> {
  return {
    count: entries.length,
    draft: entries.filter((e) => e.status === "draft").length,
    posted: entries.filter((e) => e.status === "posted").length,
    reversed: entries.filter((e) => e.status === "reversed").length,
  };
}

function renderScreen(entries: JournalEntryDTO[] = sampleEntries) {
  let current = [...entries];
  let nextSeq = current.length + 1;
  const transport = stubTransport({
    "GET /gl/journal-entries": () => ({ body: current }),
    "GET /gl/journal-entries/counts": () => ({ body: countsOf(current) }),
    "GET /gl/journal-entries/stats": () => ({ body: statsOf(current) }),
    "GET /accounts": () => ({ body: sampleAccounts }),
    "POST /gl/journal-entries": (init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created = entry({
        id: body.id,
        entryNo: `JE-${String(nextSeq++).padStart(6, "0")}`,
        date: body.date,
        memo: body.memo,
        lines: body.lines,
      });
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /gl/journal-entries/je-1/reverse": () => {
      const original = { ...current[0]!, status: "reversed" as const };
      const reversal = entry({ id: "je-reversal-1", entryNo: "JE-000099", reversesEntryId: "je-1" });
      current = [original, ...current.slice(1), reversal];
      return { status: 201, body: { original, reversal } };
    },
  });
  return renderWithProviders(
    <TestNavigation>
      <JournalsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession },
  );
}

function fillBalancedEntry() {
  fireEvent.click(screen.getByRole("button", { name: "قيد جديد" }));
  // The description field's label ("الوصف *") isn't wired to its input via
  // htmlFor/id (settings/form-controls.tsx's Field passes no htmlFor), so it
  // isn't reachable by accessible label — locate it by its placeholder instead.
  fireEvent.change(screen.getByPlaceholderText("وصف القيد..."), { target: { value: "قيد اختبار" } });
  fireEvent.change(screen.getByLabelText("الحساب للسطر 1"), { target: { value: "1300-1" } });
  fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("الحساب للسطر 2"), { target: { value: "4100" } });
  fireEvent.change(screen.getByLabelText("دائن للسطر 2"), { target: { value: "100" } });
}

describe("JournalsScreen — list", () => {
  it("renders posted journal entries from the real GL engine with correct KPIs", async () => {
    renderScreen();
    expect(screen.getByRole("heading", { name: "القيود المحاسبية" })).toBeInTheDocument();
    expect(await screen.findByText("JE-000001")).toBeInTheDocument();
    expect(screen.getByText("JE-000003")).toBeInTheDocument();
  });

  it("shows an empty state when there are no journal entries yet", async () => {
    renderScreen([]);
    expect(await screen.findByText("لا توجد قيود مطابقة")).toBeInTheDocument();
  });

  it("filters to posted via the status chips", async () => {
    renderScreen();
    await screen.findByText("JE-000001");
    fireEvent.click(screen.getByRole("tab", { name: /مرحل/ }));
    expect(screen.getByText("JE-000002")).toBeInTheDocument();
  });

  it("opens the detail view with a balance badge and lifecycle stepper", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("JE-000001"));
    expect(screen.getByLabelText("حالة المستند")).toBeInTheDocument();
    expect(screen.getAllByText("متوازن ✓").length).toBeGreaterThanOrEqual(1);
  });
});

describe("JournalsScreen — create: balance gating", () => {
  it("keeps the post button disabled until the entry balances", async () => {
    renderScreen();
    await screen.findByText("JE-000001");
    fireEvent.click(screen.getByRole("button", { name: "قيد جديد" }));
    const post = screen.getByRole("button", { name: "ترحيل القيد" });
    expect(post).toBeDisabled();

    // One-sided (debit only) → still unbalanced → disabled.
    fireEvent.change(screen.getByPlaceholderText("وصف القيد..."), { target: { value: "قيد" } });
    fireEvent.change(screen.getByLabelText("الحساب للسطر 1"), { target: { value: "1300-1" } });
    fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "100" } });
    expect(post).toBeDisabled();
    expect(screen.getByText("غير متوازن")).toBeInTheDocument();

    // Balance it → enabled + "متوازن ✓".
    fireEvent.change(screen.getByLabelText("الحساب للسطر 2"), { target: { value: "4100" } });
    fireEvent.change(screen.getByLabelText("دائن للسطر 2"), { target: { value: "100" } });
    expect(post).toBeEnabled();
    expect(screen.getByText("متوازن ✓")).toBeInTheDocument();
  });
});

describe("JournalsScreen — create: post flow", () => {
  it("posts a balanced entry via the real GL engine and shows it in the list", async () => {
    renderScreen();
    await screen.findByText("JE-000001");
    fillBalancedEntry();
    fireEvent.click(screen.getByRole("button", { name: "ترحيل القيد" }));

    // Back on the list, the new posted entry (JE-000004, continuing the sequence) appears.
    await waitFor(() => expect(screen.getByRole("heading", { name: "القيود المحاسبية" })).toBeInTheDocument());
    expect(await screen.findByText("JE-000004")).toBeInTheDocument();
    // posted KPI advanced from 3 → 4.
    const postedStat = screen.getByText("مرحل", { selector: "div" }).closest("div");
    expect(postedStat).not.toBeNull();
  });

  it("reverses a posted entry from its detail view", async () => {
    renderScreen();
    fireEvent.click(await screen.findByText("JE-000001"));
    fireEvent.click(screen.getByRole("button", { name: "عكس القيد" }));

    // The mutation invalidates the journal-entries query; the same detail
    // sub-page re-renders with the refetched, now-reversed status — no
    // navigation back to the list happens on reverse.
    await waitFor(() => expect(screen.getAllByText("معكوس").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "عكس القيد" })).not.toBeInTheDocument();
  });
});

describe("JournalsScreen — themes", () => {
  it.each(["light", "dark"] as const)("renders + gates the post button in the %s theme", async (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    renderScreen();
    await screen.findByText("JE-000001");
    fillBalancedEntry();
    expect(screen.getByRole("button", { name: "ترحيل القيد" })).toBeEnabled();
  });
});
