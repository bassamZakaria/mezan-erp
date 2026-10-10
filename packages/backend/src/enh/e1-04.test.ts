import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import type { PeriodCloseCheckDTO, PeriodCloseChecklistDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle } from "../create-backend.js";

type Sqlite = ReturnType<typeof openSqliteConnection>["sqlite"];

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function world() {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-e1-04-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "books.db");
  const backend: BackendHandle = await createBackend({ dbPath });
  cleanups.push(() => backend.close());
  const { sqlite } = openSqliteConnection(dbPath);
  cleanups.push(() => sqlite.close());
  const token = backend.sessions.issue({ userId: "admin", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  async function request(method: string, url: string, body?: unknown): Promise<Response> {
    return backend.app.fetch(new Request(`http://local${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  }
  if ((await ((await request("GET", "/fiscal-periods?year=2026")).json() as Promise<unknown[]>)).length === 0) {
    expect((await request("POST", "/fiscal-periods/generate-year", { year: 2026 })).status).toBe(201);
  }
  async function check(month: string, code: string): Promise<PeriodCloseCheckDTO> {
    const res = await request("GET", `/period-close/fp-2026-${month}/checks`);
    expect(res.status).toBe(200);
    const found = ((await res.json()) as PeriodCloseChecklistDTO).checks.find((c) => c.code === code);
    if (!found) throw new Error(`check ${code} is missing from the checklist`);
    return found;
  }
  return { sqlite, request, check };
}

// Fills every NOT NULL column the caller did not name, so a test states only the columns its check reads — on the REAL table.
function insert(sqlite: Sqlite, table: string, values: Record<string, string | number | null>): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[];
  if (columns.length === 0) throw new Error(`table ${table} does not exist`);
  const row: Record<string, string | number | null> = {};
  for (const column of columns) {
    if (column.name in values) row[column.name] = values[column.name] ?? null;
    else if (column.notnull === 1 && column.dflt_value === null && !(column.pk === 1 && column.type === "INTEGER")) {
      row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : "";
    }
  }
  const unknown = Object.keys(values).filter((name) => !columns.some((column) => column.name === name));
  if (unknown.length > 0) throw new Error(`table ${table} has no column ${unknown.join(", ")}`);
  const names = Object.keys(row);
  sqlite.prepare(`INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(...names.map((name) => row[name]));
}

function journal(sqlite: Sqlite, id: string, entryNo: string | null, date: string, status = "posted"): void {
  insert(sqlite, "journal_entry", { id, entry_no: entryNo, date, status, memo: id, source: "manual", created_at: `${date.slice(0, 10)}T08:00:00.000Z` });
}

const SCALE = 1_000_000;

function post(sqlite: Sqlite, id: string, date: string, lines: readonly (readonly [accountId: string, debit: number, credit: number])[], extra: Record<string, string | number | null> = {}): void {
  insert(sqlite, "journal_entry", { id, entry_no: null, date, status: "posted", memo: id, source: "manual", created_at: `${date}T08:00:00.000Z`, ...extra });
  lines.forEach(([accountId, debit, credit], index) => {
    insert(sqlite, "journal_line", { entry_id: id, line_no: index + 1, account_id: accountId, debit: debit * SCALE, credit: credit * SCALE });
  });
}

async function expectCloseRefused(request: (method: string, url: string, body?: unknown) => Promise<Response>, month: string, code: string): Promise<void> {
  const refused = await request("POST", `/fiscal-periods/fp-2026-${month}/close`, {});
  expect(refused.status).toBe(409);
  const body = (await refused.json()) as { error: string; failedChecks: string[] };
  expect(body.error).toBe("PERIOD_CLOSE_BLOCKED");
  expect(body.failedChecks).toContain(code);
  expect(((await (await request("GET", `/fiscal-periods/fp-2026-${month}`)).json()) as { status: string }).status).toBe("open");
}

function tieStates(found: PeriodCloseCheckDTO): Record<string, string> {
  return Object.fromEntries(found.findings.map((f) => [f.ref, f.state]));
}

describe("period-close checks read the real tables (ENH-E1-04)", () => {
  it("a clean month is clear on every check — each query runs against today's schema", async () => {
    const { request } = await world();
    const body = (await (await request("GET", "/period-close/fp-2026-03/checks")).json()) as PeriodCloseChecklistDTO;
    expect(body.checks).toHaveLength(10);
    expect(body.blocking).toEqual([]);
    expect(body.checks.filter((c) => c.status === "unavailable")).toEqual([]);
  });

  it("reports a real gap in a journal series, and nothing where the missing number is dated in another month", async () => {
    const { sqlite, check } = await world();
    journal(sqlite, "g1", "JE-000001", "2026-06-02");
    journal(sqlite, "g3", "JE-000003", "2026-06-20");
    journal(sqlite, "h7", "RV-0007", "2026-06-03");
    journal(sqlite, "h8", "RV-0008", "2026-07-01");
    journal(sqlite, "h9", "RV-0009", "2026-06-28");

    const june = await check("06", "sequence_gaps");
    expect(june.status).toBe("fail");
    expect(june.findings.map((f) => [f.ref, f.count, f.items])).toEqual([["journal_entry:JE-#", 1, ["JE-000002"]]]);
    expect((await check("07", "sequence_gaps")).status).toBe("pass");
  });

  it("orders a series by NUMBER once it outgrows its padding", async () => {
    const { sqlite, check } = await world();
    journal(sqlite, "p1", "PV-9999", "2026-06-29");
    journal(sqlite, "p2", "PV-10000", "2026-07-01");
    journal(sqlite, "p3", "PV-10001", "2026-06-30");
    expect((await check("06", "sequence_gaps")).status).toBe("pass");

    journal(sqlite, "p5", "PV-10003", "2026-06-30");
    expect((await check("06", "sequence_gaps")).findings.map((f) => f.items)).toEqual([["PV-10002"]]);
  });

  it("counts a draft and a document held for approval in the month their DATE falls in, to the last instant of its last day", async () => {
    const { sqlite, check } = await world();
    journal(sqlite, "d1", null, "2026-06-30", "draft");
    journal(sqlite, "d2", null, "2026-07-01", "draft");
    insert(sqlite, "voucher", { id: "v-held", doc_no: "RV-000900", date: "2026-06-30T21:30:00.000Z", status: "pending", doc_type: "TREASURY_VOUCHER" });

    const drafts = await check("06", "drafts");
    expect(drafts.findings.map((f) => [f.ref, f.count, f.fix])).toEqual([["journal_entry", 1, "journals"]]);
    const pending = await check("06", "pending_approvals");
    expect(pending.status).toBe("fail");
    expect(pending.findings.map((f) => [f.ref, f.count, f.fix])).toEqual([["voucher", 1, "approvals"]]);
    expect((await check("07", "pending_approvals")).status).toBe("pass");
    expect((await check("07", "drafts")).findings.map((f) => f.count)).toEqual([1]);
  });

  it("puts an e-invoice error in the month of the DOCUMENT, not the month the submission failed", async () => {
    const { sqlite, check } = await world();
    insert(sqlite, "sales_invoice", { id: "inv-june", doc_no: "INV-000700", date: "2026-06-28", status: "confirmed" });
    insert(sqlite, "eta_submission", { id: "eta-1", internal_id: "inv-june", document_type: "I", status: "error", created_at: "2026-07-02T09:00:00.000Z", updated_at: "2026-07-02T09:00:00.000Z" });

    const june = await check("06", "eta_errors");
    expect(june.status).toBe("fail");
    expect(june.findings[0]).toMatchObject({ count: 1, items: ["inv-june"], fix: "eta" });
    expect((await check("07", "eta_errors")).status).toBe("pass");
  });

  it("finds a bank statement that straddles two months in BOTH of them, and passes once it is finalized", async () => {
    const { sqlite, check } = await world();
    insert(sqlite, "bank_statement", { id: "bs-straddle", treasury_account_id: "ta-none", statement_number: "ST-05/06", period_start: "2026-05-25", period_end: "2026-06-24", status: "in_progress" });

    for (const month of ["05", "06"]) {
      const found = await check(month, "bank_statements");
      expect(found.status).toBe("fail");
      expect(found.findings.map((f) => [f.ref, f.state])).toEqual([["bs-straddle", "not_finalized"]]);
    }
    expect((await check("07", "bank_statements")).status).toBe("not_applicable");
    expect((await check("04", "bank_statements")).status).toBe("not_applicable");

    sqlite.prepare(`UPDATE bank_statement SET status = 'completed' WHERE id = 'bs-straddle'`).run();
    expect((await check("06", "bank_statements")).status).toBe("pass");
  });

  it("a bank account that moved in the month needs a finalized statement; one with no movement asks for nothing", async () => {
    const { sqlite, request, check } = await world();
    insert(sqlite, "treasury_account", { id: "ta-bank", code: "BNK-T", name: "البنك الأهلي — جاري", type: "bank", currency: "EGP", branch_id: "BR-MAIN", gl_account_id: "1021", status: "active" });
    insert(sqlite, "treasury_account", { id: "ta-cash", code: "CSH-T", name: "خزينة الفرع", type: "cash", currency: "EGP", branch_id: "BR-MAIN", gl_account_id: "1011", status: "active" });
    post(sqlite, "bank-move", "2026-06-10", [["1021", 500, 0], ["2170", 0, 500]]);
    post(sqlite, "cash-move", "2026-06-11", [["1011", 80, 0], ["2170", 0, 80]]);

    const june = await check("06", "bank_statements");
    expect(june.status).toBe("fail");
    expect(june.findings.map((f) => [f.ref, f.label, f.state, f.fix])).toEqual([["account:ta-bank", "البنك الأهلي — جاري", "missing", "bank-reconciliation"]]);
    expect((await check("07", "bank_statements")).status).toBe("not_applicable");
    await expectCloseRefused(request, "06", "bank_statements");

    insert(sqlite, "bank_statement", { id: "bs-june", treasury_account_id: "ta-bank", statement_number: "ST-06", period_start: "2026-06-01", period_end: "2026-06-30", status: "in_progress" });
    expect((await check("06", "bank_statements")).findings.map((f) => [f.ref, f.state])).toEqual([["bs-june", "not_finalized"]]);

    sqlite.prepare(`UPDATE bank_statement SET status = 'completed' WHERE id = 'bs-june'`).run();
    expect((await check("06", "bank_statements")).status).toBe("pass");
  });

  it("a month with an employee under contract and no posted payroll run does not close clean", async () => {
    const { sqlite, request, check } = await world();
    const employee = (id: string, hireDate: string, extra: Record<string, string | number | null> = {}) => {
      insert(sqlite, "hr_employee", { id, code: id, hire_date: hireDate, status: "active", ...extra });
      insert(sqlite, "hr_contract", { id: `ct-${id}`, number: `CT-${id}`, employee_id: id, start_date: hireDate, end_date: null, status: "active" });
    };
    employee("emp-1", "2026-01-01");
    employee("emp-july", "2026-07-01");
    employee("emp-left", "2026-01-01", { status: "terminated", terminated_at: "2026-05-20T10:00:00.000Z" });

    const june = await check("06", "drafts");
    expect(june.status).toBe("fail");
    expect(june.findings.map((f) => [f.kind, f.ref, f.state, f.count, f.fix])).toEqual([["payroll_due", "2026-06", "missing", 1, "payroll"]]);
    expect((await check("07", "drafts")).findings.map((f) => f.count)).toEqual([2]);
    expect((await check("05", "drafts")).findings.map((f) => f.count)).toEqual([2]);
    await expectCloseRefused(request, "06", "drafts");

    insert(sqlite, "hr_payroll_run", { id: "pr-june", number: "PAY-2026-06", year: 2026, month: 6, period_start: "2026-06-01", period_end: "2026-06-30", currency: "EGP", status: "calculated" });
    insert(sqlite, "hr_payslip", { id: "ps-1", number: "PS-1", run_id: "pr-june", employee_id: "emp-1", contract_id: "ct-emp-1", currency: "EGP", period_start: "2026-06-01", period_end: "2026-06-30", lines_json: "[]" });
    expect((await check("06", "drafts")).findings.map((f) => [f.kind, f.state])).toEqual([["drafts", "draft"], ["payroll_due", "draft"]]);

    sqlite.prepare(`UPDATE hr_payroll_run SET status = 'approved' WHERE id = 'pr-june'`).run();
    expect((await check("06", "drafts")).status).toBe("pass");
  });

  it("a recurring entry that was posted and then reversed is not done; a posted one is", async () => {
    const { sqlite, request, check } = await world();
    const template = await request("POST", "/gl/recurring/templates", {
      id: "RJT-T",
      nameAr: "إيجار المقر",
      nameEn: "Office rent",
      memo: "إيجار",
      frequency: "monthly",
      dayOfPeriod: 5,
      yearlyMonth: null,
      startDate: "2026-05-01",
      endDate: null,
      autoReverseNextPeriod: false,
      lines: [
        { accountId: "5910", debit: "100.00", credit: "0.00" },
        { accountId: "2170", debit: "0.00", credit: "100.00" },
      ],
    });
    expect(template.status).toBe(201);
    expect((await check("06", "recurring_journals")).findings.map((f) => [f.ref, f.state])).toEqual([["RJT-T:2026-06", "missing"]]);

    journal(sqlite, "rj-may", "JE-000050", "2026-05-05", "posted");
    journal(sqlite, "rj-june", "JE-000051", "2026-06-05", "reversed");
    for (const [period, entry] of [["2026-05", "rj-may"], ["2026-06", "rj-june"]] as const) {
      insert(sqlite, "recurring_journal_run", { id: `run-${period}`, template_id: "RJT-T", period, journal_entry_id: entry, generated_at: "2026-06-06T00:00:00.000Z", generated_by: "admin" });
    }
    expect((await check("05", "recurring_journals")).status).toBe("pass");
    const june = await check("06", "recurring_journals");
    expect(june.status).toBe("fail");
    expect(june.findings.map((f) => [f.state, f.passed])).toEqual([["reversed", false]]);
  });
  it("a direct posting to a control account fails the tie from its own month on, never an earlier one, and the close is refused", async () => {
    const { sqlite, request, check } = await world();
    post(sqlite, "direct-1200", "2026-07-05", [["1200", 100, 0], ["2170", 0, 100]]);
    post(sqlite, "direct-2100", "2026-08-05", [["5910", 40, 0], ["2100", 0, 40]]);
    post(sqlite, "direct-1105", "2026-09-05", [["1105", 25, 0], ["2170", 0, 25]]);

    const june = await check("06", "subledger_ties");
    expect(june.status).toBe("pass");
    expect(june.findings.every((f) => f.asOfDate === "2026-06-30")).toBe(true);

    const july = await check("07", "subledger_ties");
    expect(july.status).toBe("fail");
    expect(tieStates(july)).toMatchObject({ inventory: "mismatch", ap: "ok", ar: "ok" });
    expect(july.findings.find((f) => f.ref === "inventory")).toMatchObject({ amount: "-100.000000", asOfDate: "2026-07-31" });

    expect(tieStates(await check("08", "subledger_ties"))).toMatchObject({ inventory: "mismatch", ap: "mismatch", ar: "ok" });
    expect(tieStates(await check("09", "subledger_ties"))).toMatchObject({ inventory: "mismatch", ap: "mismatch", ar: "mismatch" });

    await expectCloseRefused(request, "07", "subledger_ties");
  });

  it("a real invoice confirmed in July leaves June tied — the sub-ledger is read as of the month end too", async () => {
    const { request, check } = await world();
    expect((await request("POST", "/items", { id: "SVC-T", code: "SVC-T", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" })).status).toBe(201);
    const customer = { id: "cust-t", code: "cust-t", nameAr: "شركة الأمل للتجارة", paymentTermsDays: 30, currency: "EGP", openingBalance: "0", active: true, creditLimit: "0", taxExempt: false, etaBuyerType: "auto" };
    expect((await request("POST", "/customers", customer)).status).toBe(201);
    const invoice = {
      id: "inv-t-july", date: "2026-07-12", dueDate: "2026-08-11", customerId: "cust-t", customerNameAr: customer.nameAr, warehouseId: "WH-MAIN", branchId: "BR-MAIN",
      arAccountId: "1105", taxAccountId: "2200",
      lines: [{ lineId: "L1", itemId: "SVC-T", itemNameAr: "خدمة", isStock: false, qty: "1", unitPrice: "1150.00", taxRatePercent: 0, revenueAccountId: "4100" }],
    };
    expect((await request("POST", "/sales-invoices", invoice)).status).toBe(201);
    expect((await request("POST", "/sales-invoices/inv-t-july/confirm", {})).status).toBe(200);

    expect(tieStates(await check("06", "subledger_ties"))).toMatchObject({ ar: "ok" });
    expect(tieStates(await check("07", "subledger_ties"))).toMatchObject({ ar: "ok" });
  });

  it("a month that did not tie at its end still fails after a later entry puts the control account back", async () => {
    const { sqlite, check } = await world();
    post(sqlite, "wrong-1200", "2026-07-05", [["1200", 100, 0], ["2170", 0, 100]]);
    post(sqlite, "undo-1200", "2026-08-02", [["2170", 100, 0], ["1200", 0, 100]]);

    expect((await check("07", "subledger_ties")).status).toBe("fail");
    expect((await check("08", "subledger_ties")).status).toBe("pass");
  });

  it("an unbalanced ledger fails the trial balance from the month it happened in, and the close is refused", async () => {
    const { sqlite, request, check } = await world();
    post(sqlite, "one-sided", "2026-06-10", [["5910", 60, 0]]);

    expect((await check("05", "trial_balance")).status).toBe("pass");
    const june = await check("06", "trial_balance");
    expect(june.status).toBe("fail");
    expect(june.findings[0]).toMatchObject({ state: "mismatch", amount: "60.000000", asOfDate: "2026-06-30" });
    await expectCloseRefused(request, "06", "trial_balance");
  });

  it("an asset in service with no depreciation run fails the month, and a posted run that covers it clears it", async () => {
    const { sqlite, request, check } = await world();
    insert(sqlite, "asset", {
      id: "asset-1", code: "FA-T-1", name_ar: "رافعة شوكية", category_id: "cat-none", scope: "general",
      acquisition_date: "2026-01-01", acquisition_cost: 120_000 * SCALE, depreciation_start_date: "2026-01-01",
      depreciation_method: "straight_line", useful_life_months: 60, salvage_value: 0, accumulated_depreciation: 0, status: "active",
    });

    const june = await check("06", "depreciation");
    expect(june.status).toBe("fail");
    expect(june.findings.map((f) => [f.ref, f.state, f.count])).toEqual([["2026-06:general", "missing", 1]]);
    await expectCloseRefused(request, "06", "depreciation");

    insert(sqlite, "depreciation_run", { id: "dr-june", period: "2026-06", status: "posted", lines: JSON.stringify([{ assetId: "asset-1", amount: "2000.00" }]), created_at: "2026-07-01T08:00:00.000Z" });
    expect((await check("06", "depreciation")).status).toBe("pass");
    expect((await check("07", "depreciation")).status).toBe("fail");
  });

  it("a payroll run that was calculated and never approved is an unposted document of its month", async () => {
    const { sqlite, request, check } = await world();
    insert(sqlite, "hr_payroll_run", { id: "pr-june", number: "PAY-2026-06", year: 2026, month: 6, period_start: "2026-06-01", period_end: "2026-06-30", currency: "EGP", status: "calculated" });

    const june = await check("06", "drafts");
    expect(june.status).toBe("fail");
    expect(june.findings.map((f) => [f.ref, f.count, f.fix])).toEqual([["payroll_run", 1, "payroll"]]);
    expect((await check("07", "drafts")).status).toBe("pass");
    await expectCloseRefused(request, "06", "drafts");
  });
});
