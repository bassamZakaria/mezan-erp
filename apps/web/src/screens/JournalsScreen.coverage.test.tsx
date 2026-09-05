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
 * Same in-memory stand-in for the shell's `useSubPage` as JournalsScreen.test.tsx,
 * but accepting an initial segment so a test can land directly on a detail
 * sub-page (a bookmarked/deep-linked URL) without clicking through the list.
 */
function TestNavigation({ children, initialSegments = [] }: { children: ReactNode; initialSegments?: readonly string[] }) {
  const [segments, setSegments] = useState<readonly string[]>(initialSegments);
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

const accounts: AccountDTO[] = [
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
    reversedByEntryId: null,
    sourceDocType: null,
    sourceDocId: null,
    sourceDocNumber: null,
    sourceModule: "manual" as const,
    lines: [
      { accountId: "1300-1", debit: "100.00", credit: "0.00", memo: null },
      { accountId: "4100", debit: "0.00", credit: "100.00", memo: null },
    ],
    ...overrides,
  };
}

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

interface RenderOptions {
  entries?: JournalEntryDTO[];
  route?: string;
  initialSegments?: readonly string[];
  /** Captures the last querystring the list request was made with. */
  listPath?: { current: string };
  listStatus?: number;
  reversePost?: (init: RequestInit | undefined) => { status?: number; body: unknown };
  createPost?: (init: RequestInit | undefined) => { status?: number; body: unknown };
}

function renderScreen(options: RenderOptions = {}) {
  const entries =
    options.entries ??
    ([entry(), entry({ id: "je-2", entryNo: "JE-000002", date: "2026-08-12" }), entry({ id: "je-3", entryNo: "JE-000003", date: "2026-08-18" })] as JournalEntryDTO[]);
  let current = [...entries];
  let nextSeq = current.length + 1;
  const transport = stubTransport({
    "GET /gl/journal-entries": (_init, path) => {
      if (options.listPath) options.listPath.current = path;
      if (options.listStatus) return { status: options.listStatus, body: { message: "تعذّر الاتصال بالخادم" } };
      return { body: current };
    },
    "GET /gl/journal-entries/counts": () => ({ body: countsOf(current) }),
    "GET /gl/journal-entries/stats": () => ({ body: statsOf(current) }),
    "GET /accounts": () => ({ body: accounts }),
    "POST /gl/journal-entries": (init) => {
      if (options.createPost) return options.createPost(init);
      const body = JSON.parse((init?.body as string) ?? "{}");
      const created = entry({ id: body.id, entryNo: `JE-${String(nextSeq++).padStart(6, "0")}`, date: body.date, memo: body.memo, lines: body.lines });
      current = [...current, created];
      return { status: 201, body: created };
    },
    "POST /gl/journal-entries/*/reverse": (init) => {
      if (options.reversePost) return options.reversePost(init);
      const original = { ...current[0]!, status: "reversed" as const };
      const reversal = entry({ id: "je-reversal-1", entryNo: "JE-000099", reversesEntryId: current[0]!.id });
      current = [original, ...current.slice(1), reversal];
      return { status: 201, body: { original, reversal } };
    },
  });
  return renderWithProviders(
    <TestNavigation initialSegments={options.initialSegments}>
      <JournalsScreen />
    </TestNavigation>,
    { transport, initialSession: testAdminSession, route: options.route },
  );
}

function chooseAccount(lineLabel: string, code: string) {
  fireEvent.click(screen.getByRole("combobox", { name: lineLabel }));
  fireEvent.mouseDown(screen.getByRole("option", { name: new RegExp(`^${code}`) }));
}

function fillBalancedEntry() {
  fireEvent.click(screen.getByRole("button", { name: "قيد جديد" }));
  fireEvent.change(screen.getByPlaceholderText("وصف القيد..."), { target: { value: "قيد اختبار" } });
  chooseAccount("الحساب للسطر 1", "1300-1");
  fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "100" } });
  chooseAccount("الحساب للسطر 2", "4100");
  fireEvent.change(screen.getByLabelText("دائن للسطر 2"), { target: { value: "100" } });
}

describe("JournalsScreen — filters", () => {
  it("narrows the register by source module, a posting-date range and free-text search", async () => {
    const listPath = { current: "" };
    renderScreen({ listPath });
    await screen.findByText("JE-000001");

    fireEvent.click(screen.getByRole("combobox", { name: "المصدر" }));
    fireEvent.mouseDown(screen.getByRole("option", { name: "المبيعات" }));

    fireEvent.change(screen.getByLabelText("من تاريخ"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("إلى تاريخ"), { target: { value: "2026-08-31" } });
    fireEvent.change(screen.getByPlaceholderText("بحث برقم القيد..."), { target: { value: "JE-000002" } });

    await waitFor(() => expect(listPath.current).toContain("sourceModule=sales"));
    expect(listPath.current).toContain("fromDate=2026-08-01");
    expect(listPath.current).toContain("toDate=2026-08-31");
    await waitFor(() => expect(listPath.current).toContain("search=JE-000002"), { timeout: 2000 });
  });
});

describe("JournalsScreen — system-sourced vs. manual entries", () => {
  it("shows a system-sourced entry's origin document and reserves reversal for posted entries", async () => {
    const sysEntry = entry({
      id: "je-sys-1",
      entryNo: null,
      status: "draft",
      sourceModule: "sales",
      sourceDocType: "salesInvoice",
      sourceDocId: "inv-1",
      sourceDocNumber: "INV-000045",
    });
    renderScreen({ entries: [sysEntry] });

    expect(await screen.findByText("INV-000045")).toBeInTheDocument();
    expect(screen.getByText("المبيعات")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إجراءات je-sys-1" }));
    expect(screen.getByRole("menuitem", { name: "عرض" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "عكس القيد" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "عرض" }));
    expect(await screen.findByRole("heading", { name: "قيد يومية" })).toBeInTheDocument();
  });

  it("displays the raw account id when a posted line points at an account no longer in the chart", async () => {
    const driftedEntry = entry({
      id: "je-drift",
      lines: [
        { accountId: "9999-gone", debit: "50.00", credit: "0.00", memo: null },
        { accountId: "4100", debit: "0.00", credit: "50.00", memo: null },
      ],
    });
    renderScreen({ entries: [driftedEntry] });
    fireEvent.click(await screen.findByText("JE-000001"));
    expect(await screen.findByText("9999-gone")).toBeInTheDocument();
  });

  it("flags an entry whose posted lines drift out of balance", async () => {
    const driftedEntry = entry({
      id: "je-drift-2",
      lines: [
        { accountId: "1300-1", debit: "100.00", credit: "0.00", memo: null },
        { accountId: "4100", debit: "0.00", credit: "90.00", memo: null },
      ],
    });
    renderScreen({ entries: [driftedEntry] });
    fireEvent.click(await screen.findByText("JE-000001"));
    expect(await screen.findAllByText("غير متوازن")).not.toHaveLength(0);
  });
});

describe("JournalsScreen — deep links and load failures", () => {
  it("shows the register's own not-found state for a bookmarked entry the current filters hide", async () => {
    renderScreen({ initialSegments: ["JE-GHOST"] });
    expect(await screen.findByText("لم يُعثر على هذا القيد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "رجوع" }));
    expect(await screen.findByRole("heading", { name: "القيود المحاسبية" })).toBeInTheDocument();
  });

  it("offers a retry when the register cannot be loaded", async () => {
    const listPath = { current: "" };
    renderScreen({ listStatus: 500, listPath });
    expect(await screen.findByText("تعذّر تحميل القيود المحاسبية.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(listPath.current).not.toBe(""));
  });

  it("keeps the register on a valid page when the address points past the end of a filtered result", async () => {
    renderScreen({ route: "/?page=99" });
    expect(await screen.findByText("JE-000001")).toBeInTheDocument();
  });
});

describe("JournalsScreen — create: refusals from the posting engine", () => {
  it("surfaces the server's own message when the entry's period is closed", async () => {
    renderScreen({
      createPost: () => ({ status: 400, body: { message: "الفترة مقفلة" } }),
    });
    await screen.findByText("JE-000001");
    fillBalancedEntry();
    fireEvent.change(screen.getByLabelText("البيان للسطر 1"), { target: { value: "سطر ملاحظة" } });
    fireEvent.click(screen.getByRole("button", { name: "ترحيل القيد" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("الفترة مقفلة");
    expect(screen.getByRole("button", { name: "ترحيل القيد" })).toBeInTheDocument();
  });

  it("clears a line back to zero rather than leaving it blank when its figure is emptied", async () => {
    renderScreen();
    await screen.findByText("JE-000001");
    fillBalancedEntry();
    const post = screen.getByRole("button", { name: "ترحيل القيد" });
    expect(post).toBeEnabled();

    fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "" } });
    expect(post).toBeDisabled();

    fireEvent.change(screen.getByLabelText("مدين للسطر 1"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("دائن للسطر 2"), { target: { value: "" } });
    expect(post).toBeDisabled();
  });
});

describe("JournalsScreen — reversing from the register", () => {
  it("surfaces a refusal inline when reversing a posted entry from its row menu fails", async () => {
    renderScreen({
      reversePost: () => ({ status: 400, body: { message: "الفترة مقفلة" } }),
    });
    await screen.findByText("JE-000001");

    fireEvent.click(screen.getByRole("button", { name: "إجراءات JE-000001" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "عكس القيد" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "عكس القيد" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("الفترة مقفلة");
  });
});
