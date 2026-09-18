// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { useState, type ReactNode } from "react";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    // guards Q-9: the register is a SERVER page now — a stub returning every
    // entry would let a client-side slice pass unnoticed.
    "GET /gl/journal-entries": (_init, path) => {
      const params = new URLSearchParams(path.split("?")[1] ?? "");
      const pageSize = Number(params.get("pageSize") ?? 25);
      const page = Number(params.get("page") ?? 1);
      return { body: current.slice((page - 1) * pageSize, page * pageSize) };
    },
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

/** The account picker is a listbox combobox, not a native <select> — open it, then commit an option (Select.tsx commits on mousedown). */
function chooseAccount(lineLabel: string, code: string) {
  fireEvent.click(screen.getByRole("combobox", { name: lineLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: new RegExp(`^${code}`) }));
}

function fillBalancedEntry() {
  fireEvent.click(screen.getByRole("button", { name: "قيد جديد" }));
  // The description field's label ("الوصف *") isn't wired to its input via
  // htmlFor/id (settings/form-controls.tsx's Field passes no htmlFor), so it
  // isn't reachable by accessible label — locate it by its placeholder instead.
  fireEvent.change(screen.getByPlaceholderText("وصف القيد..."), { target: { value: "قيد اختبار" } });
  chooseAccount("الحساب للسطر 1", "1300-1");
  fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "100" } });
  chooseAccount("الحساب للسطر 2", "4100");
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
    chooseAccount("الحساب للسطر 1", "1300-1");
    fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "100" } });
    expect(post).toBeDisabled();
    expect(screen.getByText("غير متوازن")).toBeInTheDocument();

    // Balance it → enabled + "متوازن ✓".
    chooseAccount("الحساب للسطر 2", "4100");
    fireEvent.change(screen.getByLabelText("دائن للسطر 2"), { target: { value: "100" } });
    expect(post).toBeEnabled();
    expect(screen.getByText("متوازن ✓")).toBeInTheDocument();
  });
});

describe("JournalsScreen — create: decimals and dimensions", () => {
  // guards B-1: lines were summed as floats and the balance check then called
  // Money.fromMajor(String(300.29999999999995)), which throws — in render.
  it("balances 100.10 + 200.20 against 300.30 without throwing", async () => {
    renderScreen();
    await screen.findByText("JE-000001");
    fireEvent.click(screen.getByRole("button", { name: "قيد جديد" }));
    fireEvent.change(screen.getByPlaceholderText("وصف القيد..."), { target: { value: "قيد كسور" } });
    chooseAccount("الحساب للسطر 1", "1300-1");
    fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "100.10" } });
    chooseAccount("الحساب للسطر 2", "4100");
    fireEvent.change(screen.getByLabelText("دائن للسطر 2"), { target: { value: "100.10" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة سطر" }));
    chooseAccount("الحساب للسطر 3", "1300-1");
    fireEvent.change(screen.getByLabelText("مدين للسطر 3"), { target: { value: "200.20" } });
    fireEvent.click(screen.getByRole("button", { name: "إضافة سطر" }));
    chooseAccount("الحساب للسطر 4", "4100");
    fireEvent.change(screen.getByLabelText("دائن للسطر 4"), { target: { value: "200.20" } });

    expect(screen.getByText("متوازن ✓")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ترحيل القيد" })).toBeEnabled();
  });

  // guards C-5 (first half): glJournalLineSchema already carries costCenterId;
  // the screen sent none, so the cost-centre P&L never saw a manual accrual.
  it("sends the line's cost centre with the posted entry", async () => {
    const posted: unknown[] = [];
    const transport = stubTransport({
      "GET /gl/journal-entries": () => ({ body: sampleEntries }),
      "GET /gl/journal-entries/counts": () => ({ body: countsOf(sampleEntries) }),
      "GET /gl/journal-entries/stats": () => ({ body: statsOf(sampleEntries) }),
      "GET /accounts": () => ({ body: sampleAccounts }),
      "GET /cost-centers": () => ({
        body: [
          { id: "cc-1", code: "CC-01", nameAr: "الإدارة", nameEn: null, type: "general", departmentId: null, branchId: null, parentId: null, notes: null, status: "active" },
        ],
      }),
      "POST /gl/journal-entries": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        posted.push(body);
        return { status: 201, body: entry({ id: body.id, entryNo: "JE-000009" }) };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <JournalsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("JE-000001");
    fireEvent.click(screen.getByRole("button", { name: "قيد جديد" }));
    fireEvent.change(screen.getByPlaceholderText("وصف القيد..."), { target: { value: "مصروف" } });
    chooseAccount("الحساب للسطر 1", "1300-1");
    fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("combobox", { name: "مركز التكلفة للسطر 1" }));
    fireEvent.mouseDown(await screen.findByRole("option", { name: /CC-01/ }));
    chooseAccount("الحساب للسطر 2", "4100");
    fireEvent.change(screen.getByLabelText("دائن للسطر 2"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "ترحيل القيد" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0] as { lines: { costCenterId: string | null }[] };
    expect(body.lines[0]?.costCenterId).toBe("cc-1");
    expect(body.lines[1]?.costCenterId).toBeNull();
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

describe("JournalsScreen — create: a line on a party control account names its party (D205)", () => {
  it("asks for the customer on a 1105 line, keeps the post disabled until one is chosen, and sends its real id", async () => {
    const posted: unknown[] = [];
    const transport = stubTransport({
      "GET /gl/journal-entries": () => ({ body: sampleEntries }),
      "GET /gl/journal-entries/counts": () => ({ body: countsOf(sampleEntries) }),
      "GET /gl/journal-entries/stats": () => ({ body: statsOf(sampleEntries) }),
      "GET /accounts": () => ({
        body: [
          ...sampleAccounts,
          { id: "1105", code: "1105", nameAr: "ذمم عملاء تجارية", nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" },
        ],
      }),
      "GET /gl/party-control-accounts": () => ({
        body: [
          { accountId: "1105", partyKind: "customer" },
          { accountId: "2100", partyKind: "supplier" },
        ],
      }),
      "GET /customers": () => ({ body: [{ id: "CUST-7", code: "C-0007", nameAr: "شركة النيل", nameEn: null }] }),
      "GET /suppliers": () => ({ body: [] }),
      "POST /gl/journal-entries": (init) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        posted.push(body);
        return { status: 201, body: entry({ id: body.id, entryNo: "JE-000009" }) };
      },
    });
    renderWithProviders(
      <TestNavigation>
        <JournalsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
    await screen.findByText("JE-000001");
    fireEvent.click(screen.getByRole("button", { name: "قيد جديد" }));
    fireEvent.change(screen.getByPlaceholderText("وصف القيد..."), { target: { value: "مبيعات مباشرة" } });
    chooseAccount("الحساب للسطر 1", "1105");
    fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "1140" } });
    chooseAccount("الحساب للسطر 2", "4100");
    fireEvent.change(screen.getByLabelText("دائن للسطر 2"), { target: { value: "1140" } });

    const post = screen.getByRole("button", { name: "ترحيل القيد" });
    const picker = await screen.findByRole("combobox", { name: "العميل أو المورد للسطر 1" });
    expect(screen.queryByRole("combobox", { name: "العميل أو المورد للسطر 2" })).not.toBeInTheDocument();
    expect(post).toBeDisabled();
    expect(screen.getByText(/يجب أن يحدد العميل أو المورد/)).toBeInTheDocument();

    fireEvent.focus(picker);
    fireEvent.mouseDown(await screen.findByRole("button", { name: /شركة النيل/ }));
    expect(post).toBeEnabled();
    fireEvent.click(post);

    await waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0] as { lines: { accountId: string; partyId: string | null }[] };
    expect(body.lines[0]).toMatchObject({ accountId: "1105", partyId: "CUST-7" });
    expect(body.lines[1]?.partyId).toBeNull();
  });
});

describe("JournalsScreen — editing and deleting a draft (D226)", () => {
  function draftEntry(overrides: Partial<JournalEntryDTO> = {}): JournalEntryDTO {
    return entry({
      id: "je-draft",
      entryNo: null,
      status: "draft",
      postedAt: null,
      memo: "مسودة قيد",
      ...overrides,
    });
  }

  function renderWithDraft(
    current: JournalEntryDTO[],
    extra: Record<string, (init: RequestInit | undefined, path: string) => { status?: number; body?: unknown }> = {},
  ) {
    const transport = stubTransport({
      "GET /gl/journal-entries": () => ({ body: current }),
      "GET /gl/journal-entries/counts": () => ({ body: countsOf(current) }),
      "GET /gl/journal-entries/stats": () => ({ body: statsOf(current) }),
      "GET /accounts": () => ({ body: sampleAccounts }),
      ...extra,
    });
    return renderWithProviders(
      <TestNavigation>
        <JournalsScreen />
      </TestNavigation>,
      { transport, initialSession: testAdminSession },
    );
  }

  it("a posted entry offers neither تعديل nor حذف", async () => {
    renderWithDraft([entry()]);
    fireEvent.click(await screen.findByText("JE-000001"));
    expect(screen.queryByRole("button", { name: "تعديل" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "حذف" })).not.toBeInTheDocument();
  });

  it("a draft entry offers both تعديل and حذف", async () => {
    renderWithDraft([draftEntry()]);
    fireEvent.click(await screen.findByText("مسودة قيد"));
    expect(screen.getByRole("button", { name: "تعديل" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حذف" })).toBeInTheDocument();
  });

  it("تعديل opens the form prefilled from the draft and PUTs the changes", async () => {
    let putBody: { date: string; memo: string; lines: unknown[] } | null = null;
    renderWithDraft([draftEntry()], {
      "PUT /gl/journal-entries/je-draft": (init) => {
        putBody = JSON.parse((init?.body as string) ?? "{}");
        return { status: 200, body: { ...draftEntry(), ...putBody } };
      },
    });
    fireEvent.click(await screen.findByText("مسودة قيد"));
    fireEvent.click(screen.getByRole("button", { name: "تعديل" }));

    expect(await screen.findByRole("heading", { name: "تعديل قيد يومية" })).toBeInTheDocument();
    const memoField = screen.getByPlaceholderText("وصف القيد...") as HTMLInputElement;
    expect(memoField.value).toBe("مسودة قيد");

    fireEvent.change(memoField, { target: { value: "مسودة معدّلة" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ التعديلات" }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody!.memo).toBe("مسودة معدّلة");
    expect(putBody!.lines).toHaveLength(2);
  });

  it("حذف asks for confirmation, then DELETEs the draft", async () => {
    let deleted = false;
    renderWithDraft([draftEntry()], {
      "DELETE /gl/journal-entries/je-draft": () => {
        deleted = true;
        return { status: 204 };
      },
    });
    fireEvent.click(await screen.findByText("مسودة قيد"));
    fireEvent.click(screen.getByRole("button", { name: "حذف" }));

    const dialog = await screen.findByRole("dialog");
    expect(deleted).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "حذف" }));

    await waitFor(() => expect(deleted).toBe(true));
  });
});
