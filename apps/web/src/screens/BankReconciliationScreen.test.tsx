// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BankStatementDTO, BankStatementListItemDTO, StatementLineDTO, TreasuryAccountDTO } from "@mezan/contracts";
import { BankReconciliationScreen } from "./BankReconciliationScreen";
import { renderWithProviders, stubTransport, testAdminSession, type StubResult } from "../data/test-support";

const BANK_ACCOUNT: TreasuryAccountDTO = {
  id: "ta-bank1",
  code: "BANK-001",
  name: "بنك مصر — الحساب الجاري", nameEn: null,
  type: "bank",
  currency: "EGP",
  branchId: "BR1",
  glAccountId: "1310",
  openingBalance: "0.000000",
  openingBalanceDate: null,
  status: "active",
};

function statement(overrides: Partial<BankStatementDTO> = {}): BankStatementDTO {
  return {
    id: "stmt-1",
    treasuryAccountId: "ta-bank1",
    source: "csv",
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

function detail(overrides: { statement?: Partial<BankStatementDTO>; lines?: StatementLineDTO[] } = {}) {
  const lines = overrides.lines ?? [line()];
  return {
    ...statement(overrides.statement),
    lines,
    matchSummary: matchSummaryFor(lines),
  };
}

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
    expect(await screen.findByText("تعذّر تحميل كشوف البنك.")).toBeInTheDocument();
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
      transport: stubTransport({ ...baseHandlers([statement()]), ...handlers }),
    });
    const row = (await screen.findByText("ST-001")).closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "إجراءات ST-001" }));
    await user.click(within(row).getByRole("menuitem", { name: "فتح التسوية" }));
    return { user, panel: await screen.findByRole("dialog", { name: /تسوية/ }) };
  }

  it("lists the statement's lines with their matched/unmatched status and the match summary", async () => {
    const { panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({
        body: detail({ lines: [line(), line({ id: "stmt-1:L1", description: "مصروفات بنكية", amount: "-5.000000", status: "matched", matchedEntryId: "je-fee" })] }),
      }),
    });
    expect(await within(panel).findByText("إيداع نقدي")).toBeInTheDocument();
    expect(within(panel).getByText("مصروفات بنكية")).toBeInTheDocument();
    expect(within(panel).getByText("غير مطابَق")).toBeInTheDocument();
    // one line's status pill plus the summary tile's own "مطابَق" label
    expect(within(panel).getAllByText("مطابَق")).toHaveLength(2);
    expect(within(panel).getByText("القيد: je-fee")).toBeInTheDocument();
    expect(within(panel).getByText("1 / 2")).toBeInTheDocument();
    expect(within(panel).getByText("50%")).toBeInTheDocument();
  });

  it("matches an unmatched line against a ledger entry id, then unmatches it", async () => {
    let matchedEntryId: string | null = null;
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({
        body: detail({ lines: [matchedEntryId ? line({ status: "matched", matchedEntryId }) : line()] }),
      }),
      "POST /bank-statements/stmt-1/lines/stmt-1:L0/match": (init) => {
        matchedEntryId = JSON.parse(String(init?.body)).entryId;
        return { body: line({ status: "matched", matchedEntryId }) };
      },
      "POST /bank-statements/stmt-1/lines/stmt-1:L0/unmatch": () => {
        matchedEntryId = null;
        return { body: line() };
      },
      // Manual matching picks from real treasury movements — it never asks
      // the user to type a journal-entry id.
      "GET /bank-statements/stmt-1/candidates": () => ({
        body: [{ entryId: "je-deposit", entryNo: "JE-000010", date: "2026-08-01", amount: "1000.000000", description: "إيداع نقدي - سند قبض" }],
      }),
    });

    await within(panel).findByText("إيداع نقدي");
    await user.type(within(panel).getByLabelText("طابِق مع حركة خزينة"), "سند قبض");
    await user.click(await within(panel).findByText("إيداع نقدي - سند قبض"));
    await user.click(within(panel).getByRole("button", { name: "مطابقة" }));
    await waitFor(() => expect(matchedEntryId).toBe("je-deposit"));
    expect(await within(panel).findByText("القيد: je-deposit")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "إلغاء المطابقة" }));
    await waitFor(() => expect(matchedEntryId).toBeNull());
    expect(await within(panel).findByLabelText("طابِق مع حركة خزينة")).toBeInTheDocument();
  });

  it("runs auto-match and reports the server's applied count through the refreshed summary", async () => {
    let autoMatched = false;
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({
        body: detail({
          statement: autoMatched ? { status: "in_progress" } : {},
          lines: [autoMatched ? line({ status: "matched", matchedEntryId: "je-auto" }) : line()],
        }),
      }),
      "POST /bank-statements/stmt-1/auto-match": () => {
        autoMatched = true;
        return { body: { matchedCount: 1 } };
      },
    });
    await within(panel).findByText("غير مطابَق");
    await user.click(within(panel).getByRole("button", { name: "مطابقة تلقائية" }));
    await waitFor(() => expect(autoMatched).toBe(true));
    expect(await within(panel).findByText("القيد: je-auto")).toBeInTheDocument();
    expect(within(panel).getByText("100%")).toBeInTheDocument();
  });

  it("finalizes the statement and then locks every matching control", async () => {
    let finalized = false;
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({
        body: detail({ statement: finalized ? { status: "completed", finalizedAt: "2026-08-22T10:00:00.000Z" } : {} }),
      }),
      "POST /bank-statements/stmt-1/finalize": () => {
        finalized = true;
        return { body: statement({ status: "completed", finalizedAt: "2026-08-22T10:00:00.000Z" }) };
      },
    });
    await within(panel).findByText("غير مطابَق");
    await user.click(within(panel).getByRole("button", { name: "إنهاء التسوية" }));
    await waitFor(() => expect(finalized).toBe(true));
    expect(await within(panel).findByText("منتهية")).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByRole("button", { name: "مطابقة تلقائية" })).toBeDisabled());
    expect(within(panel).getByRole("button", { name: "إنهاء التسوية" })).toBeDisabled();
  });

  it("surfaces a rejected match's server error", async () => {
    const { user, panel } = await openStatement({
      "GET /bank-statements/stmt-1": () => ({ body: detail() }),
      "POST /bank-statements/stmt-1/lines/stmt-1:L0/match": () => ({
        status: 409,
        body: { error: "LINE_ALREADY_MATCHED", message: "السطر مطابَق بالفعل." },
      }),
      "GET /bank-statements/stmt-1/candidates": () => ({
        body: [{ entryId: "je-1", entryNo: null, date: "2026-08-01", amount: "1000.000000", description: "قيد يدوي" }],
      }),
    });
    await within(panel).findByText("إيداع نقدي");
    await user.type(within(panel).getByLabelText("طابِق مع حركة خزينة"), "قيد");
    await user.click(await within(panel).findByText("قيد يدوي"));
    await user.click(within(panel).getByRole("button", { name: "مطابقة" }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("السطر مطابَق بالفعل.");
  });
});
