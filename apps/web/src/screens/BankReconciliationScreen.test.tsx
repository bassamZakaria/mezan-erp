// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MatchSourceCode,
  StatementSourceCode,
  type AutoMatchResultDTO,
  type BankStatementDTO,
  type BankStatementListItemDTO,
  type BankStatementReviewDTO,
  type MatchCandidateDTO,
  type ReconciliationPositionDTO,
  type StatementLineDTO,
  type TreasuryAccountDTO,
} from "@mezan/contracts";
import { BankReconciliationScreen } from "./BankReconciliationScreen";
import { scaledOf, sumScaled } from "../lib/money";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";

const BANK_ACCOUNT: TreasuryAccountDTO = {
  id: "ta-bank1",
  code: "BANK-001",
  name: "بنك مصر — الحساب الجاري", nameEn: null,
  type: "bank",
  currency: "EGP",
  bankAccountNumber: null,
  branchId: "BR1",
  glAccountId: "1310",
  openingBalance: "0.000000",
  openingBalanceDate: null,
  guaranteeFacilityLimit: null,
  status: "active",
};

function statement(overrides: Partial<BankStatementDTO> = {}): BankStatementDTO {
  return {
    id: "stmt-1",
    treasuryAccountId: "ta-bank1",
    branchId: "BR1",
    currency: "EGP",
    source: StatementSourceCode.Csv,
    statementNumber: "ST-001",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    openingBalance: "0.000000",
    closingBalance: "595.000000",
    status: "imported",
    importedAt: "2026-08-22T10:00:00.000Z",
    finalizedAt: null,
    ...overrides,
  };
}

function line(overrides: Partial<StatementLineDTO> = {}): StatementLineDTO {
  return {
    id: "stmt-1:L0",
    statementId: "stmt-1",
    date: "2026-08-01",
    description: "إيداع نقدي",
    reference: "TX1",
    amount: "1000.000000",
    status: "unmatched",
    matchedEntryId: null,
    matchedEntryNo: null,
    matchedAt: null,
    ...overrides,
  };
}

/** Lines matched over lines seen — the same rate the server would compute. */
function matchSummaryFor(lines: readonly StatementLineDTO[]) {
  const matched = lines.filter((l) => l.status === "matched").length;
  return {
    total: lines.length,
    matched,
    unmatched: lines.length - matched,
    matchRate: lines.length === 0 ? 0 : matched / lines.length,
  };
}

const STAMP = "2026-08-22T10:00:00.000Z";

/** A scale-1e-6 decimal string, the only money form that crosses the wire. */
function exact(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  return `${negative ? "-" : ""}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, "0")}`;
}

function matchedTo(entryId: string, entryNo: string, source: MatchSourceCode, overrides: Partial<StatementLineDTO> = {}): StatementLineDTO {
  return line({
    status: "matched",
    matchedEntryId: entryId,
    matchedEntryNo: entryNo,
    matchedEntryIds: [entryId],
    matchedEntryNos: [entryNo],
    matchSource: source,
    matchedAt: STAMP,
    ...overrides,
  });
}

/** The server's reconciliation position for these lines — cleared, difference and the unmatched tail all tie to them. */
function positionFor(base: BankStatementDTO, lines: readonly StatementLineDTO[]): ReconciliationPositionDTO {
  const opening = scaledOf(base.openingBalance);
  const closing = scaledOf(base.closingBalance);
  const linesTotal = sumScaled(lines.map((l) => l.amount));
  const open = lines.filter((l) => l.status !== "matched");
  const cleared = opening + sumScaled(lines.filter((l) => l.status === "matched").map((l) => l.amount));
  return {
    openingBalance: base.openingBalance,
    closingBalance: base.closingBalance,
    clearedBalance: exact(cleared),
    difference: exact(closing - cleared),
    statementLinesTotal: exact(linesTotal),
    statementArithmeticGap: exact(closing - opening - linesTotal),
    unmatchedLines: { count: open.length, total: exact(sumScaled(open.map((l) => l.amount))) },
    bookBalance: exact(cleared),
    bookDifference: "0.000000",
    outstandingBook: { count: 0, total: "0.000000", items: [] },
    unexplainedBookDifference: "0.000000",
  };
}

function detail(overrides: { statement?: Partial<BankStatementDTO>; lines?: StatementLineDTO[] } = {}) {
  const lines = overrides.lines ?? [line()];
  const openingBalance = overrides.statement?.openingBalance ?? "0.000000";
  const base = statement({
    openingBalance,
    closingBalance: exact(scaledOf(openingBalance) + sumScaled(lines.map((l) => l.amount))),
    ...overrides.statement,
  });
  return { ...base, lines, matchSummary: matchSummaryFor(lines), position: positionFor(base, lines) };
}

/** `GET /bank-statements/:id/review` — the position plus one review item per still-open line. */
function reviewOf(overrides: { statement?: Partial<BankStatementDTO>; lines?: StatementLineDTO[] } = {}): BankStatementReviewDTO {
  const d = detail(overrides);
  return {
    position: d.position,
    items: d.lines.filter((l) => l.status !== "matched").map((l) => ({ lineId: l.id, suggestions: [], rule: null })),
  };
}

const DEPOSIT_CANDIDATE: MatchCandidateDTO = {
  entryId: "je-deposit",
  entryNo: "JE-000010",
  date: "2026-08-01",
  amount: "1000.000000",
  description: "إيداع نقدي - سند قبض",
  currency: "EGP",
};

/**
 * A list row: `GET /bank-statements` always returns a `matchSummary` next to
 * each statement (`bankStatementListItemSchema` requires it) — a bare
 * `BankStatementDTO` is not a real list response.
 */
function listItem(base: BankStatementDTO, lines: readonly StatementLineDTO[] = [line()]): BankStatementListItemDTO {
  return { ...base, matchSummary: matchSummaryFor(lines) };
}

const CSV = "التاريخ,البيان,مدين,دائن,المرجع\n01/08/2026,إيداع نقدي,0,1000.00,TX1\n";

function csvFile(): File {
  return new File([CSV], "statement.csv", { type: "text/csv" });
}

/**
 * The column-mapping fields are the custom `Select` combobox (@mezan/ui), not
 * a native `<select>`: opening it renders the option list into a portal, and
 * an option commits on `mousedown` rather than `click`.
 */
async function pickColumn(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, comboboxLabel: string, optionLabel: string) {
  await user.click(within(dialog).getByRole("combobox", { name: comboboxLabel }));
  fireEvent.mouseDown(await screen.findByRole("option", { name: optionLabel }));
}

function baseHandlers(statements: BankStatementDTO[]): Record<string, () => StubResult> {
  return {
    "GET /bank-statements": () => ({ body: statements.map((s) => listItem(s)) }),
    "GET /treasury-accounts": () => ({ body: [BANK_ACCOUNT] }),
  };
}

describe("BankReconciliationScreen — list", () => {
  it("renders real statements off GET /bank-statements with the account name resolved from treasury accounts", async () => {
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers([statement()])),
    });
    expect(await screen.findByText("بنك مصر — الحساب الجاري")).toBeInTheDocument();
    expect(screen.getByText("ST-001")).toBeInTheDocument();
    expect(screen.getByText("2026-08-01 — 2026-08-31")).toBeInTheDocument();
  });

  it("shows the load error instead of the empty state when the statements request fails", async () => {
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /bank-statements": () => ({ status: 500, body: { error: "INTERNAL" } }),
        "GET /treasury-accounts": () => ({ body: [BANK_ACCOUNT] }),
      }),
    });
    // guards §4.5 #13 — the fallback sentence now carries the status as a support code.
    expect(await screen.findByText("تعذّر تحميل كشوف البنك. (رمز 500)")).toBeInTheDocument();
  });

  it("shows the documented empty state when no statement has been imported", async () => {
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers([])),
    });
    expect(await screen.findByText("لا توجد كشوف بنك بعد")).toBeInTheDocument();
  });

  it("sends the status filter tab to the server as a query param", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    // A zero-count status chip is not rendered (ListViews), so every status
    // needs at least one statement here for all four tabs to appear.
    const statements = [
      statement(),
      statement({ id: "stmt-2", statementNumber: "ST-002", status: "in_progress" }),
      statement({ id: "stmt-3", statementNumber: "ST-003", status: "completed" }),
    ];
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: (path, init) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && path.startsWith("/bank-statements")) paths.push(path);
        const key = `${method} ${path.split("?")[0]}`;
        const handler = baseHandlers(statements)[key];
        const result: StubResult = handler ? handler() : { status: 404, body: { error: "NOT_FOUND" } };
        const status = result.status ?? 200;
        return Promise.resolve({
          status,
          ok: status >= 200 && status < 400,
          json: <T,>() => Promise.resolve(result.body as T),
          text: () => Promise.resolve(JSON.stringify(result.body)),
        });
      },
    });
    await screen.findByText("ST-001");
    for (const label of ["الكل", "مستورد", "قيد التسوية", "منتهية"]) {
      expect(screen.getByRole("tab", { name: new RegExp(label) })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("tab", { name: /قيد التسوية/ }));
    await waitFor(() => expect(paths.some((p) => p.includes("status=in_progress"))).toBe(true));
  });
});

describe("BankReconciliationScreen — import dialog", () => {
  it("keeps the column mapping locked until a CSV is chosen, then maps its real headers", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ ...baseHandlers([]), "GET /bank-statements/column-mapping/ta-bank1": () => ({ status: 404, body: {} }) }),
    });
    await screen.findByText("لا توجد كشوف بنك بعد");
    await user.click(screen.getAllByRole("button", { name: "استيراد كشف بنك" })[0]!);

    const dialog = await screen.findByRole("dialog", { name: "استيراد كشف بنك" });
    expect(within(dialog).getByRole("button", { name: "تعيين الأعمدة" })).toBeDisabled();

    await user.upload(within(dialog).getByLabelText("ملف الكشف"), csvFile());
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "تعيين الأعمدة" })).toBeEnabled());

    await user.click(within(dialog).getByRole("button", { name: "تعيين الأعمدة" }));
    // the selects are populated from the uploaded file's real header row
    await user.click(within(dialog).getByRole("combobox", { name: "عمود التاريخ *" }));
    expect(await screen.findByRole("option", { name: "التاريخ" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "المرجع" })).toBeInTheDocument();
  });

  it("prefills the mapping from the account's saved per-account mapping", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers([]),
        "GET /bank-statements/column-mapping/ta-bank1": () => ({
          body: {
            treasuryAccountId: "ta-bank1",
            dateColumn: "التاريخ",
            descriptionColumn: "البيان",
            amountColumn: null,
            debitColumn: "مدين",
            creditColumn: "دائن",
            referenceColumn: "المرجع",
            dateFormat: "DD/MM/YYYY",
            updatedAt: "2026-08-22T10:00:00.000Z",
          },
        }),
      }),
    });
    await screen.findByText("لا توجد كشوف بنك بعد");
    await user.click(screen.getAllByRole("button", { name: "استيراد كشف بنك" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "استيراد كشف بنك" });

    await user.type(within(dialog).getByPlaceholderText("اختر حسابا بنكيا"), "بنك");
    await user.click(await within(dialog).findByText("بنك مصر — الحساب الجاري (BANK-001)"));
    await user.upload(within(dialog).getByLabelText("ملف الكشف"), csvFile());
    await user.click(within(dialog).getByRole("button", { name: "تعيين الأعمدة" }));

    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "عمود التاريخ *" })).toHaveTextContent("التاريخ"));
    expect(within(dialog).getByRole("combobox", { name: "عمود المدين" })).toHaveTextContent("مدين");
    expect(within(dialog).getByRole("combobox", { name: "عمود الدائن" })).toHaveTextContent("دائن");
    expect(within(dialog).getByRole("combobox", { name: "صيغة التاريخ" })).toHaveTextContent("DD/MM/YYYY");
  });

  it("posts the raw CSV plus the chosen mapping to POST /bank-statements/import", async () => {
    const user = userEvent.setup();
    let imported: Record<string, unknown> | null = null;
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /treasury-accounts": () => ({ body: [BANK_ACCOUNT] }),
        "GET /bank-statements": () => ({ body: imported ? [listItem(statement())] : [] }),
        "GET /bank-statements/column-mapping/ta-bank1": () => ({ status: 404, body: {} }),
        "GET /bank-statements/stmt-1": () => ({ body: detail() }),
        "POST /bank-statements/import": (init) => {
          imported = JSON.parse(String(init?.body));
          return { status: 201, body: detail() };
        },
      }),
    });
    await screen.findByText("لا توجد كشوف بنك بعد");
    await user.click(screen.getAllByRole("button", { name: "استيراد كشف بنك" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "استيراد كشف بنك" });

    await user.type(within(dialog).getByPlaceholderText("اختر حسابا بنكيا"), "بنك");
    await user.click(await within(dialog).findByText("بنك مصر — الحساب الجاري (BANK-001)"));
    await user.upload(within(dialog).getByLabelText("ملف الكشف"), csvFile());
    // The identity/period text fields render in this order: period start,
    // period end, opening balance, closing balance, statement number.
    const [periodStartInput, periodEndInput, openingBalanceInput, closingBalanceInput, statementNumberInput] =
      within(dialog).getAllByRole("textbox");
    await user.type(periodStartInput!, "2026-08-01");
    await user.type(periodEndInput!, "2026-08-31");
    await user.type(openingBalanceInput!, "0.00");
    await user.type(closingBalanceInput!, "595.00");
    await user.type(statementNumberInput!, "ST-001");

    await user.click(within(dialog).getByRole("button", { name: "تعيين الأعمدة" }));
    await pickColumn(user, dialog, "عمود التاريخ *", "التاريخ");
    await pickColumn(user, dialog, "عمود البيان *", "البيان");
    await pickColumn(user, dialog, "عمود المدين", "مدين");
    await pickColumn(user, dialog, "عمود الدائن", "دائن");
    await pickColumn(user, dialog, "عمود المرجع", "المرجع");
    await pickColumn(user, dialog, "صيغة التاريخ", "DD/MM/YYYY");

    await user.click(within(dialog).getByRole("button", { name: "استيراد" }));
    await waitFor(() => expect(imported).not.toBeNull());
    expect(imported).toMatchObject({
      treasuryAccountId: "ta-bank1",
      rawCsv: CSV,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      openingBalance: "0.00",
      closingBalance: "595.00",
      statementNumber: "ST-001",
      mapping: {
        dateColumn: "التاريخ",
        descriptionColumn: "البيان",
        amountColumn: null,
        debitColumn: "مدين",
        creditColumn: "دائن",
        referenceColumn: "المرجع",
        dateFormat: "DD/MM/YYYY",
      },
    });
  });
});

describe("BankReconciliationScreen — matching", () => {
  async function openStatement(handlers: Record<string, (init?: RequestInit) => StubResult>) {
    const user = userEvent.setup();
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        ...baseHandlers([statement()]),
        "GET /bank-statements/rules": () => ({ body: [] }),
        "GET /accounts": () => ({ body: [] }),
        "GET /cost-centers": () => ({ body: [] }),
        ...handlers,
      }),
    });
    const row = (await screen.findByText("ST-001")).closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "إجراءات ST-001" }));
    await user.click(within(row).getByRole("menuitem", { name: "فتح التسوية" }));
    return { user, panel: await screen.findByRole("dialog", { name: /تسوية/ }) };
  }

  it("lists the statement's lines with their matched/unmatched status and the match summary", async () => {
    const lines = [
      line(),
      line({
        ...matchedTo("je-fee", "JE-000038", MatchSourceCode.Manual),
        id: "stmt-1:L1",
        description: "مصروفات بنكية",
        reference: "TX2",
        amount: "-5.000000",
      }),
    ];
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({ body: detail({ lines }) }),
      "GET /bank-statements/stmt-1/review": () => ({ body: reviewOf({ lines }) }),
      "GET /bank-statements/stmt-1/candidates": () => ({ body: [] }),
    });

    // every line, under the state it is in: the open one under «للمراجعة», the settled one under «مطابَقة»
    expect(await within(panel).findByRole("tab", { name: "للمراجعة (1)" })).toHaveAttribute("aria-selected", "true");
    expect(within(panel).getByRole("tab", { name: "مطابَقة (1)" })).toHaveAttribute("aria-selected", "false");
    expect(within(panel).getByText("إيداع نقدي")).toBeInTheDocument();
    expect(within(panel).queryByText("مصروفات بنكية")).not.toBeInTheDocument();

    // the summary figures: the headline difference and every position row that feeds it
    const headline = within(panel).getByText("الفرق").parentElement!.parentElement as HTMLElement;
    expect(within(headline).getByText("1,000.00")).toBeInTheDocument();
    expect(within(panel).queryByText("متوازن")).not.toBeInTheDocument();
    const closingRow = within(panel).getByText("الرصيد الختامي للكشف").closest("div") as HTMLElement;
    expect(within(closingRow).getByText("995.00")).toBeInTheDocument();
    const clearedRow = within(panel).getByText("الرصيد الدفتري المُسوّى").closest("div") as HTMLElement;
    expect(within(clearedRow).getByText("-5.00")).toBeInTheDocument();
    const unmatchedRow = within(panel).getByText("سطور بنكية غير مسجلة دفترياً").closest("div") as HTMLElement;
    expect(within(unmatchedRow).getByText("(1)")).toBeInTheDocument();
    expect(within(unmatchedRow).getByText("1,000.00")).toBeInTheDocument();

    await user.click(within(panel).getByRole("tab", { name: "مطابَقة (1)" }));
    expect(await within(panel).findByText("مصروفات بنكية")).toBeInTheDocument();
    expect(within(panel).queryByText("إيداع نقدي")).not.toBeInTheDocument();
    expect(within(panel).getByText("JE-000038")).toBeInTheDocument();
    expect(within(panel).getByText(/طريقة المطابقة: يدوية/)).toBeInTheDocument();
  });

  it("matches an unmatched line against a ledger entry id, then unmatches it", async () => {
    let matchBody: unknown = null;
    let matched = false;
    const lines = () => [matched ? matchedTo("je-deposit", "JE-000010", MatchSourceCode.Manual) : line()];
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({ body: detail({ lines: lines() }) }),
      "GET /bank-statements/stmt-1/review": () => ({ body: reviewOf({ lines: lines() }) }),
      // Manual matching picks from real treasury movements — it never asks
      // the user to type a journal-entry id.
      "GET /bank-statements/stmt-1/candidates": () => ({ body: [DEPOSIT_CANDIDATE] }),
      "POST /bank-statements/stmt-1/lines/stmt-1:L0/match-many": (init) => {
        matchBody = JSON.parse(String(init?.body));
        matched = true;
        return { body: lines()[0]! };
      },
      "POST /bank-statements/stmt-1/lines/stmt-1:L0/unmatch": () => {
        matched = false;
        return { body: lines()[0]! };
      },
    });

    await within(panel).findByText("إيداع نقدي");
    await user.click(within(panel).getByRole("button", { name: "مطابقة يدوية" }));
    // A checkbox's accessible name trims each span, so « · » loses its leading space.
    await user.click(await within(panel).findByRole("checkbox", { name: "JE-000010· 2026-08-01· إيداع نقدي - سند قبض" }));
    expect(within(panel).getByText("المحدد: 1,000.00 من 1,000.00")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "مطابقة المحدد" }));
    await waitFor(() => expect(matchBody).toEqual({ entryIds: ["je-deposit"] }));

    await user.click(await within(panel).findByRole("tab", { name: "مطابَقة (1)" }));
    expect(await within(panel).findByText("JE-000010")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "إلغاء المطابقة" }));
    await waitFor(() => expect(matched).toBe(false));
    await user.click(await within(panel).findByRole("tab", { name: "للمراجعة (1)" }));
    expect(await within(panel).findByRole("button", { name: "مطابقة يدوية" })).toBeEnabled();
  });

  it("runs auto-match and reports the server's applied count through the refreshed summary", async () => {
    let autoMatched = false;
    const lines = () => [autoMatched ? matchedTo("je-auto", "JE-000020", MatchSourceCode.Auto) : line()];
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({
        body: detail({ statement: autoMatched ? { status: "in_progress" } : {}, lines: lines() }),
      }),
      "GET /bank-statements/stmt-1/review": () => ({ body: reviewOf({ lines: lines() }) }),
      "GET /bank-statements/stmt-1/candidates": () => ({ body: [] }),
      "POST /bank-statements/stmt-1/auto-match": () => {
        autoMatched = true;
        const result: AutoMatchResultDTO = { matchedCount: 1, suggestedCount: 0 };
        return { body: result };
      },
    });

    await within(panel).findByRole("tab", { name: "للمراجعة (1)" });
    await user.click(within(panel).getByRole("button", { name: "اقتراح المطابقات" }));
    expect(await within(panel).findByRole("status")).toHaveTextContent(
      "طُبّقت 1 مطابقة تلقائياً (ثقة 90% فأكثر)، و0 سطر ينتظر المراجعة.",
    );

    // and the refreshed state carries the same count: the line moved, and the statement balances
    expect(await within(panel).findByRole("tab", { name: "مطابَقة (1)" })).toBeInTheDocument();
    expect(within(panel).getByRole("tab", { name: "للمراجعة (0)" })).toBeInTheDocument();
    expect(within(panel).getByText("متوازن")).toBeInTheDocument();
    await user.click(within(panel).getByRole("tab", { name: "مطابَقة (1)" }));
    expect(await within(panel).findByText("JE-000020")).toBeInTheDocument();
    expect(within(panel).getByText(/طريقة المطابقة: تلقائية/)).toBeInTheDocument();
  });

  it("finalizes the statement and then locks every matching control", async () => {
    const REASON = "فرق يُسوّى الشهر القادم";
    let finalizeBody: unknown = null;
    const lines = [
      line(),
      line({
        ...matchedTo("je-fee", "JE-000038", MatchSourceCode.Manual),
        id: "stmt-1:L1",
        description: "مصروفات بنكية",
        amount: "-5.000000",
      }),
    ];
    const finalizedStatement: Partial<BankStatementDTO> = {
      status: "completed",
      finalizedAt: STAMP,
      unmatchedAtFinalize: 1,
      finalizeOverrideReason: REASON,
    };
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({
        body: detail({ statement: finalizeBody ? finalizedStatement : {}, lines }),
      }),
      "GET /bank-statements/stmt-1/review": () => ({ body: reviewOf({ lines }) }),
      "GET /bank-statements/stmt-1/candidates": () => ({ body: [] }),
      "POST /bank-statements/stmt-1/finalize": (init) => {
        finalizeBody = JSON.parse(String(init?.body));
        return { body: statement(finalizedStatement) };
      },
    });

    await within(panel).findByRole("tab", { name: "للمراجعة (1)" });
    await user.click(within(panel).getByRole("button", { name: "إنهاء التسوية" }));
    const confirm = await screen.findByRole("dialog", { name: "إنهاء التسوية مع وجود فروق" });
    expect(
      within(confirm).getByText("ما زال 1 سطراً غير مطابَق والفرق 1,000.00. سيُسجَّل الإنهاء بتجاوز وسببه على الكشف."),
    ).toBeInTheDocument();
    await user.type(within(confirm).getByLabelText("سبب التجاوز"), REASON);
    await user.click(within(confirm).getByRole("button", { name: "إنهاء مع التجاوز" }));
    await waitFor(() => expect(finalizeBody).toEqual({ force: true, reason: REASON }));

    expect(await within(panel).findByText("منتهية")).toBeInTheDocument();
    expect(within(panel).getByText(`أُنهي بتجاوز: ${REASON}`)).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByRole("button", { name: "اقتراح المطابقات" })).toBeDisabled());
    expect(within(panel).getByRole("button", { name: "إنهاء التسوية" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "مطابقة يدوية" })).toBeDisabled();
    expect(within(panel).getByRole("button", { name: "إنشاء قيد" })).toBeDisabled();
    await user.click(within(panel).getByRole("tab", { name: "مطابَقة (1)" }));
    expect(await within(panel).findByRole("button", { name: "إلغاء المطابقة" })).toBeDisabled();
  });

  it("surfaces a rejected match's server error", async () => {
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({ body: detail() }),
      "GET /bank-statements/stmt-1/review": () => ({ body: reviewOf() }),
      "GET /bank-statements/stmt-1/candidates": () => ({ body: [DEPOSIT_CANDIDATE] }),
      "POST /bank-statements/stmt-1/lines/stmt-1:L0/match-many": () => ({
        status: 409,
        body: { error: "LINE_ALREADY_MATCHED", message: "السطر مطابَق بالفعل." },
      }),
    });

    await within(panel).findByText("إيداع نقدي");
    await user.click(within(panel).getByRole("button", { name: "مطابقة يدوية" }));
    await user.click(await within(panel).findByRole("checkbox", { name: /JE-000010/ }));
    await user.click(within(panel).getByRole("button", { name: "مطابقة المحدد" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("السطر مطابَق بالفعل.");
  });
});
