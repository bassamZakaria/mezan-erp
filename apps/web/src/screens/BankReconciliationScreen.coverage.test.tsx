// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MatchSourceCode,
  StatementSourceCode,
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
import type { Transport } from "../data/transport";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";

const BANK_ACCOUNT: TreasuryAccountDTO = {
  id: "ta-bank1",
  code: "BANK-001",
  name: "بنك مصر — الحساب الجاري",
  nameEn: null,
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

function matchedTo(entryId: string, entryNo: string, overrides: Partial<StatementLineDTO> = {}): StatementLineDTO {
  return line({
    status: "matched",
    matchedEntryId: entryId,
    matchedEntryNo: entryNo,
    matchedEntryIds: [entryId],
    matchedEntryNos: [entryNo],
    matchSource: MatchSourceCode.Manual,
    matchedAt: STAMP,
    ...overrides,
  });
}

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

function reviewOf(overrides: { statement?: Partial<BankStatementDTO>; lines?: StatementLineDTO[] } = {}): BankStatementReviewDTO {
  const d = detail(overrides);
  return {
    position: d.position,
    items: d.lines.filter((l) => l.status !== "matched").map((l) => ({ lineId: l.id, suggestions: [], rule: null })),
  };
}

const DEPOSIT_CANDIDATE: MatchCandidateDTO = {
  entryId: "je-1",
  entryNo: "JE-000010",
  date: "2026-08-01",
  amount: "1000.000000",
  description: "إيداع نقدي - سند قبض",
  currency: "EGP",
};

const CHARGE_CANDIDATE: MatchCandidateDTO = {
  entryId: "je-2",
  entryNo: "JE-000020",
  date: "2026-08-01",
  amount: "-20.000000",
  description: "مصروف بنكي",
  currency: "EGP",
};

function listItem(base: BankStatementDTO, lines: readonly StatementLineDTO[] = [line()]): BankStatementListItemDTO {
  return { ...base, matchSummary: matchSummaryFor(lines) };
}

function baseHandlers(statements: BankStatementDTO[]): Record<string, (init?: RequestInit) => StubResult> {
  return {
    "GET /bank-statements": () => ({ body: statements.map((s) => listItem(s)) }),
    "GET /treasury-accounts": () => ({ body: [BANK_ACCOUNT] }),
  };
}

async function pickColumn(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, comboboxLabel: string, optionLabel: string) {
  await user.click(within(dialog).getByRole("combobox", { name: comboboxLabel }));
  fireEvent.mouseDown(await screen.findByRole("option", { name: optionLabel }));
}

async function openStatement(
  handlers: Record<string, (init?: RequestInit) => StubResult>,
  statements: BankStatementDTO[] = [statement()],
  wrap: (transport: Transport) => Transport = (transport) => transport,
) {
  const user = userEvent.setup();
  renderWithProviders(<BankReconciliationScreen />, {
    initialSession: testAdminSession,
    transport: wrap(
      stubTransport({
        ...baseHandlers(statements),
        "GET /bank-statements/rules": () => ({ body: [] }),
        "GET /accounts": () => ({ body: [] }),
        "GET /cost-centers": () => ({ body: [] }),
        ...handlers,
      }),
    ),
  });
  const row = (await screen.findByText(statements[0]!.statementNumber ?? statements[0]!.id)).closest("tr") as HTMLElement;
  await user.click(within(row).getByRole("button", { name: `إجراءات ${statements[0]!.statementNumber ?? statements[0]!.id}` }));
  await user.click(within(row).getByRole("menuitem", { name: "فتح التسوية" }));
  return { user, panel: await screen.findByRole("dialog", { name: /تسوية/ }) };
}

describe("BankReconciliationScreen — list filters", () => {
  it("resets to the first page once the loaded data no longer has that many pages", async () => {
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers([statement()])),
      route: "/?page=5",
    });
    expect(await screen.findByText("ST-001")).toBeInTheDocument();
  });

  it("narrows the list by treasury account and a date range, and reflects the count on the filter toggle", async () => {
    const user = userEvent.setup();
    const paths: string[] = [];
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: (path, init) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "GET" && path.startsWith("/bank-statements") && !path.startsWith("/bank-statements/")) paths.push(path);
        const key = `${method} ${path.split("?")[0]}`;
        const handler = baseHandlers([statement()])[key];
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

    await user.type(screen.getByPlaceholderText("جميع الحسابات"), "بنك");
    // The same name also sits in the statement row's account column, so scope the
    // click to the picker's listbox — and to the label span, since the mousedown
    // handler lives on the button inside the <li role="option">.
    const accountList = await screen.findByRole("listbox");
    await user.click(within(accountList).getByText("بنك مصر — الحساب الجاري"));
    await waitFor(() => expect(paths.some((p) => p.includes("treasuryAccountId=ta-bank1"))).toBe(true));

    fireEvent.change(screen.getByLabelText("من"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("إلى"), { target: { value: "2026-08-31" } });
    await waitFor(() => expect(paths.some((p) => p.includes("fromDate=2026-08-01") && p.includes("toDate=2026-08-31"))).toBe(true));

    const toggle = screen.getByRole("button", { name: /تصفية النتائج/ });
    expect(within(toggle).getByText("3")).toBeInTheDocument();
  });

  it("searches statements by account name, statement number or period", async () => {
    const statements = [statement(), statement({ id: "stmt-2", statementNumber: "ST-002", periodStart: "2026-09-01", periodEnd: "2026-09-30" })];
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport(baseHandlers(statements)),
    });
    await screen.findByText("ST-001");
    expect(screen.getByText("ST-002")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("بحث بالحساب أو المرجع أو الفترة..."), { target: { value: "ST-002" } });
    await waitFor(() => expect(screen.queryByText("ST-001")).not.toBeInTheDocument());
    expect(screen.getByText("ST-002")).toBeInTheDocument();
  });

  it("shows a statement's raw account id, a dash reference and a dash match rate when it has no matching data", async () => {
    const orphan = statement({ id: "stmt-2", treasuryAccountId: "ta-missing", statementNumber: null });
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /bank-statements": () => ({ body: [listItem(orphan, [])] }),
        "GET /treasury-accounts": () => ({ body: [BANK_ACCOUNT] }),
      }),
    });
    expect(await screen.findByText("ta-missing")).toBeInTheDocument();
    const row = screen.getByText("ta-missing").closest("tr") as HTMLElement;
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(within(row).getByRole("button", { name: "إجراءات stmt-2" })).toBeInTheDocument();
  });
});

describe("BankReconciliationScreen — import dialog", () => {
  it("shows a generic error and clears the headers when the uploaded file has no rows, and ignores a cleared file input", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({ ...baseHandlers([]), "GET /bank-statements/column-mapping/ta-bank1": () => ({ status: 404, body: {} }) }),
    });
    await screen.findByText("لا توجد كشوف بنك بعد");
    await user.click(screen.getAllByRole("button", { name: "استيراد كشف بنك" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "استيراد كشف بنك" });

    const fileInput = within(dialog).getByLabelText("ملف الكشف") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [] } });
    expect(within(dialog).getByRole("button", { name: "تعيين الأعمدة" })).toBeDisabled();

    await user.upload(fileInput, new File([""], "empty.csv", { type: "text/csv" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "تعذّرت العملية. راجع البيانات وأعد المحاولة، وإن تكرّر الأمر فأبلغ الدعم.",
    );
    expect(within(dialog).getByRole("button", { name: "تعيين الأعمدة" })).toBeDisabled();
  });

  it("imports using a single signed amount column, leaving debit, credit, reference and the statement number blank", async () => {
    const user = userEvent.setup();
    let imported: Record<string, unknown> | null = null;
    const csv = "التاريخ,البيان,المبلغ\n01/08/2026,إيداع نقدي,1000.00\n";
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /treasury-accounts": () => ({ body: [BANK_ACCOUNT] }),
        "GET /bank-statements": () => ({ body: imported ? [listItem(statement())] : [] }),
        "GET /bank-statements/column-mapping/ta-bank1": () => ({ status: 404, body: {} }),
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
    await user.upload(within(dialog).getByLabelText("ملف الكشف"), new File([csv], "statement.csv", { type: "text/csv" }));

    const [periodStartInput, periodEndInput, openingBalanceInput, closingBalanceInput] = within(dialog).getAllByRole("textbox");
    await user.type(periodStartInput!, "2026-08-01");
    await user.type(periodEndInput!, "2026-08-31");
    await user.type(openingBalanceInput!, "0.00");
    await user.type(closingBalanceInput!, "1000.00");

    await user.click(within(dialog).getByRole("button", { name: "تعيين الأعمدة" }));
    await pickColumn(user, dialog, "عمود التاريخ *", "التاريخ");
    await pickColumn(user, dialog, "عمود البيان *", "البيان");
    await pickColumn(user, dialog, "عمود المبلغ (بإشارة)", "المبلغ");

    await user.click(within(dialog).getByRole("button", { name: "استيراد" }));
    await waitFor(() => expect(imported).not.toBeNull());
    expect(imported).toMatchObject({
      treasuryAccountId: "ta-bank1",
      statementNumber: null,
      mapping: {
        dateColumn: "التاريخ",
        descriptionColumn: "البيان",
        amountColumn: "المبلغ",
        debitColumn: null,
        creditColumn: null,
        referenceColumn: null,
      },
    });
  });

  it("prefills a blank debit, credit and reference from a saved mapping that has none of them", async () => {
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
            amountColumn: "المبلغ",
            debitColumn: null,
            creditColumn: null,
            referenceColumn: null,
            dateFormat: "YYYY-MM-DD",
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
    await user.upload(
      within(dialog).getByLabelText("ملف الكشف"),
      new File(["التاريخ,البيان,المبلغ\n01/08/2026,إيداع نقدي,1000.00\n"], "statement.csv", { type: "text/csv" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "تعيين الأعمدة" }));

    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "عمود المبلغ (بإشارة)" })).toHaveTextContent("المبلغ"));
    expect(within(dialog).getByRole("combobox", { name: "عمود المدين" })).toHaveTextContent("— بدون —");
    expect(within(dialog).getByRole("combobox", { name: "عمود الدائن" })).toHaveTextContent("— بدون —");
    expect(within(dialog).getByRole("combobox", { name: "عمود المرجع" })).toHaveTextContent("— بدون —");
  });

  it("surfaces the server's rejection when importing a statement fails", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BankReconciliationScreen />, {
      initialSession: testAdminSession,
      transport: stubTransport({
        "GET /treasury-accounts": () => ({ body: [BANK_ACCOUNT] }),
        "GET /bank-statements": () => ({ body: [] }),
        "GET /bank-statements/column-mapping/ta-bank1": () => ({ status: 404, body: {} }),
        "POST /bank-statements/import": () => ({ status: 409, body: { error: "DUPLICATE", message: "هذا الكشف مستورد مسبقا." } }),
      }),
    });
    await screen.findByText("لا توجد كشوف بنك بعد");
    await user.click(screen.getAllByRole("button", { name: "استيراد كشف بنك" })[0]!);
    const dialog = await screen.findByRole("dialog", { name: "استيراد كشف بنك" });

    await user.type(within(dialog).getByPlaceholderText("اختر حسابا بنكيا"), "بنك");
    await user.click(await within(dialog).findByText("بنك مصر — الحساب الجاري (BANK-001)"));
    await user.upload(
      within(dialog).getByLabelText("ملف الكشف"),
      new File(["التاريخ,البيان,مدين,دائن\n01/08/2026,إيداع نقدي,0,1000.00\n"], "statement.csv", { type: "text/csv" }),
    );
    const [periodStartInput, periodEndInput, openingBalanceInput, closingBalanceInput] = within(dialog).getAllByRole("textbox");
    await user.type(periodStartInput!, "2026-08-01");
    await user.type(periodEndInput!, "2026-08-31");
    await user.type(openingBalanceInput!, "0.00");
    await user.type(closingBalanceInput!, "1000.00");
    await user.click(within(dialog).getByRole("button", { name: "تعيين الأعمدة" }));
    await pickColumn(user, dialog, "عمود التاريخ *", "التاريخ");
    await pickColumn(user, dialog, "عمود البيان *", "البيان");
    await pickColumn(user, dialog, "عمود المدين", "مدين");
    await pickColumn(user, dialog, "عمود الدائن", "دائن");

    await user.click(within(dialog).getByRole("button", { name: "استيراد" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("هذا الكشف مستورد مسبقا.");
  });
});

describe("BankReconciliationScreen — matching", () => {
  it("shows a statement that has no lines yet", async () => {
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({ body: detail({ lines: [] }) }),
      "GET /bank-statements/stmt-1/review": () => ({ body: reviewOf({ lines: [] }) }),
      "GET /bank-statements/stmt-1/candidates": () => ({ body: [] }),
    });

    expect(await within(panel).findByRole("tab", { name: "للمراجعة (0)" })).toBeInTheDocument();
    expect(within(panel).getByText("لا توجد سطور تنتظر المراجعة.")).toBeInTheDocument();
    // an empty statement is empty, not broken: no error and nothing left to reconcile
    expect(within(panel).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(panel).getByText("متوازن")).toBeInTheDocument();

    await user.click(within(panel).getByRole("tab", { name: "مطابَقة (0)" }));
    expect(await within(panel).findByText("لم تُطابَق أي سطور بعد.")).toBeInTheDocument();
  });

  it("ignores a second match click on a different line while the first is still in flight", async () => {
    const calls: Record<string, number> = {};
    let matchedFirst = false;
    let releaseFirst: (() => void) | null = null;
    const firstInFlight = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const lines = () => [
      matchedFirst ? matchedTo("je-1", "JE-000010") : line(),
      line({ id: "stmt-1:L1", description: "سطر ثانٍ", reference: null, amount: "-20.000000" }),
    ];
    const { user, panel } = await openStatement(
      {
        "GET /bank-statements/stmt-1": () => ({ body: detail({ lines: lines() }) }),
        "GET /bank-statements/stmt-1/review": () => ({ body: reviewOf({ lines: lines() }) }),
        "GET /bank-statements/stmt-1/candidates": () => ({ body: [DEPOSIT_CANDIDATE, CHARGE_CANDIDATE] }),
        "POST /bank-statements/stmt-1/lines/stmt-1:L0/match-many": () => {
          matchedFirst = true;
          return { body: lines()[0]! };
        },
        "POST /bank-statements/stmt-1/lines/stmt-1:L1/match-many": () => ({
          body: matchedTo("je-2", "JE-000020", { id: "stmt-1:L1", description: "سطر ثانٍ", reference: null, amount: "-20.000000" }),
        }),
      },
      [statement()],
      (transport) => async (path, init) => {
        if ((init?.method ?? "GET").toUpperCase() === "POST" && path.endsWith("/match-many")) {
          const key = path.includes("stmt-1:L0") ? "L0" : "L1";
          calls[key] = (calls[key] ?? 0) + 1;
          if (key === "L0") await firstInFlight;
        }
        return transport(path, init);
      },
    );

    await within(panel).findByText("إيداع نقدي");
    const openManual = within(panel).getAllByRole("button", { name: "مطابقة يدوية" });
    await user.click(openManual[0]!);
    await user.click(openManual[1]!);
    // A checkbox's accessible name trims each span, so « · » loses its leading space.
    await user.click(await within(panel).findByRole("checkbox", { name: "JE-000010· 2026-08-01· إيداع نقدي - سند قبض" }));
    await user.click(within(panel).getByRole("checkbox", { name: "JE-000020· 2026-08-01· مصروف بنكي" }));

    const matchButtons = within(panel).getAllByRole("button", { name: "مطابقة المحدد" });
    fireEvent.click(matchButtons[0]!);
    fireEvent.click(matchButtons[1]!);

    await waitFor(() => expect(calls["L0"]).toBe(1));
    expect(calls["L1"]).toBeUndefined();
    // only the acting row goes busy — the second line keeps its own controls live
    expect(matchButtons[0]!).toBeDisabled();
    expect(matchButtons[1]!).toBeEnabled();
    expect(openManual[1]!).toBeEnabled();

    releaseFirst!();
    expect(await within(panel).findByRole("tab", { name: "مطابَقة (1)" })).toBeInTheDocument();
    expect(calls["L1"]).toBeUndefined();
  });

  it("reports a server error when automatic matching is rejected", async () => {
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({ body: detail() }),
      "GET /bank-statements/stmt-1/review": () => ({ body: reviewOf() }),
      "GET /bank-statements/stmt-1/candidates": () => ({ body: [] }),
      "POST /bank-statements/stmt-1/auto-match": () => ({
        status: 500,
        body: { error: "INTERNAL", message: "تعذّر تشغيل المطابقة التلقائية." },
      }),
    });

    await within(panel).findByRole("tab", { name: "للمراجعة (1)" });
    await user.click(within(panel).getByRole("button", { name: "اقتراح المطابقات" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("تعذّر تشغيل المطابقة التلقائية.");
  });

  it("shows fallback labels for a line with no reference and match candidates missing a description or entry number", async () => {
    const lines = [line({ reference: null })];
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({ body: detail({ lines }) }),
      "GET /bank-statements/stmt-1/review": () => ({ body: reviewOf({ lines }) }),
      "GET /bank-statements/stmt-1/candidates": () => ({
        body: [
          DEPOSIT_CANDIDATE,
          { entryId: "je-numbered", entryNo: "JE-000099", date: "2026-08-01", amount: "1000.000000", description: null, currency: "EGP" },
          { entryId: "je-bare", entryNo: null, date: "2026-08-02", amount: "500.000000", description: null, currency: "EGP" },
        ] satisfies MatchCandidateDTO[],
      }),
    });

    await within(panel).findByText("إيداع نقدي");
    // with no reference the line's meta row is its date alone, with no dangling separator
    expect(within(panel).getByText("2026-08-01")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "مطابقة يدوية" }));
    // A checkbox's accessible name trims each span, so « · » loses its leading space.
    expect(await within(panel).findByRole("checkbox", { name: "JE-000010· 2026-08-01· إيداع نقدي - سند قبض" })).toBeInTheDocument();
    expect(within(panel).getByRole("checkbox", { name: "JE-000099· 2026-08-01" })).toBeInTheDocument();
    expect(within(panel).getByRole("checkbox", { name: "je-bare· 2026-08-02" })).toBeInTheDocument();
  });
});
