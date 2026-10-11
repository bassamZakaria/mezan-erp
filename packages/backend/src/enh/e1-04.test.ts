import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ALL_SCOPE, MODULE_CATALOG, createEntitlements } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { PeriodCloseCheckStatusDTO, type PeriodCloseCheckDTO, type PeriodCloseChecklistDTO } from "@mezan/contracts";
import { createBackend, type BackendHandle } from "../create-backend.js";

type Sqlite = ReturnType<typeof openSqliteConnection>["sqlite"];

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function world(activeModules: readonly string[] | null = null) {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-e1-04-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "books.db");
  const backend: BackendHandle = await createBackend({
    dbPath,
    ...(activeModules ? { resolveEntitlements: () => createEntitlements({ plan: "TEST", activeModules: [...activeModules], features: {}, seats: 5, expiresAt: null }) } : {}),
  });
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
    const { checks } = (await res.json()) as PeriodCloseChecklistDTO;
    expect(checks.filter((c) => c.status === PeriodCloseCheckStatusDTO.Unavailable).map((c) => c.code)).toEqual([]);
    const found = checks.find((c) => c.code === code);
    if (!found) throw new Error(`check ${code} is missing from the checklist`);
    return found;
  }
  function requestAs(userId: string, permissions: readonly string[]) {
    const userToken = backend.sessions.issue({ userId, permissions: [...permissions], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    return async (method: string, url: string, body?: unknown): Promise<Response> =>
      backend.app.fetch(
        new Request(`http://local${url}`, {
          method,
          headers: { authorization: `Bearer ${userToken}`, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
  }
  return { sqlite, request, check, requestAs };
}

// Fills every NOT NULL column the caller did not name, so a test states only the columns its check reads — on the REAL table.
function insert(sqlite: Sqlite, table: string, values: Record<string, string | number | null>): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[];
  if (columns.length === 0) throw new Error(`table ${table} does not exist`);
  const row: Record<string, string | number | null> = {};
  for (const column of columns) {
    if (column.name in values) row[column.name] = values[column.name] ?? null;
    else if (column.notnull === 1 && column.dflt_value === null && !(column.pk === 1 && column.type === "INTEGER")) {
      row[column.name] = /INT|REAL|NUM/i.test(column.type) ? 0 : column.name.endsWith("_json") ? "[]" : "";
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

type Columns = Record<string, string | number | null>;

function post(sqlite: Sqlite, id: string, date: string, lines: readonly (readonly [accountId: string, debit: number, credit: number, extra?: Columns])[], extra: Columns = {}): void {
  insert(sqlite, "journal_entry", { id, entry_no: null, date, status: "posted", memo: id, source: "manual", created_at: `${date}T08:00:00.000Z`, ...extra });
  lines.forEach(([accountId, debit, credit, lineExtra], index) => {
    insert(sqlite, "journal_line", { entry_id: id, line_no: index + 1, account_id: accountId, debit: debit * SCALE, credit: credit * SCALE, ...lineExtra });
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

  it("a number skipped across a month boundary is reported in the month that follows it, and in no other", async () => {
    const { sqlite, check } = await world();
    journal(sqlite, "b9", "JE-000009", "2026-01-28");
    journal(sqlite, "b10", "JE-000010", "2026-01-31");
    journal(sqlite, "b13", "JE-000013", "2026-02-02");
    journal(sqlite, "b14", "JE-000014", "2026-02-20");
    journal(sqlite, "b15", "JE-000015", "2026-03-03");

    expect((await check("01", "sequence_gaps")).status).toBe("pass");
    const february = await check("02", "sequence_gaps");
    expect(february.status).toBe("fail");
    expect(february.findings.map((f) => [f.ref, f.count, f.items])).toEqual([["journal_entry:JE-#", 2, ["JE-000011", "JE-000012"]]]);
    expect((await check("03", "sequence_gaps")).status).toBe("pass");

    journal(sqlite, "b11", "JE-000011", "2026-03-05");
    journal(sqlite, "b12", "JE-000012", "2026-01-15");
    expect((await check("02", "sequence_gaps")).status).toBe("pass");
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

  it("a finalized statement for three days does not satisfy the month, and one finalized over unmatched lines is a failing finding", async () => {
    const { sqlite, request, check } = await world();
    insert(sqlite, "treasury_account", { id: "ta-bank", code: "BNK-T", name: "البنك الأهلي — جاري", type: "bank", currency: "EGP", branch_id: "BR-MAIN", gl_account_id: "1021", status: "active" });
    post(sqlite, "bank-move", "2026-07-02", [["1021", 500, 0], ["2170", 0, 500]]);
    insert(sqlite, "bank_statement", { id: "bs-3d", treasury_account_id: "ta-bank", statement_number: "ST-07A", period_start: "2026-07-01", period_end: "2026-07-03", status: "completed" });

    const short = await check("07", "bank_statements");
    expect(short.status).toBe("fail");
    expect(short.findings.filter((f) => !f.passed).map((f) => [f.ref, f.state, f.asOfDate])).toEqual([["account:ta-bank", "not_covered", "2026-07-04"]]);
    await expectCloseRefused(request, "07", "bank_statements");
    expect((sqlite.prepare(`SELECT status FROM fiscal_period WHERE id = 'fp-2026-07'`).get() as { status: string }).status).toBe("open");

    insert(sqlite, "bank_statement", { id: "bs-rest", treasury_account_id: "ta-bank", statement_number: "ST-07B", period_start: "2026-07-04", period_end: "2026-07-31", status: "completed", unmatched_at_finalize: 2, finalize_override_reason: "فرق عمولة بنكية لم يُسجَّل بعد" });
    const forced = await check("07", "bank_statements");
    expect(forced.status).toBe("fail");
    expect(forced.findings.filter((f) => !f.passed).map((f) => [f.ref, f.state])).toEqual([["bs-rest", "forced_finalization"]]);
    await expectCloseRefused(request, "07", "bank_statements");
  });

  it("a month with staff in service during it and no posted payroll run does not close clean — a May leaver is still owed May", async () => {
    const { sqlite, request, check } = await world();
    const employee = (id: string, hireDate: string, extra: Record<string, string | number | null> = {}) => {
      insert(sqlite, "hr_employee", { id, code: id, hire_date: hireDate, status: "active", ...extra });
      insert(sqlite, "hr_contract", { id: `ct-${id}`, number: `CT-${id}`, employee_id: id, type: "indefinite", pay_basis: "monthly", pay_frequency: "monthly", currency: "EGP", start_date: hireDate, end_date: null, status: "active" });
    };
    const payslip = (employeeId: string) =>
      insert(sqlite, "hr_payslip", { id: `ps-${employeeId}`, number: `PS-${employeeId}`, run_id: "pr-june", employee_id: employeeId, contract_id: `ct-${employeeId}`, currency: "EGP", period_start: "2026-06-01", period_end: "2026-06-30", lines_json: "[]" });
    const dueIn = async (month: string) => (await check(month, "drafts")).findings.filter((f) => f.kind === "payroll_due").map((f) => f.count);
    employee("emp-1", "2026-01-01");
    employee("emp-suspended", "2026-01-01", { status: "suspended" });
    employee("emp-july", "2026-07-01");
    employee("emp-left", "2026-01-01", { status: "terminated", terminated_at: "2026-05-20T10:00:00.000Z" });

    const june = await check("06", "drafts");
    expect(june.status).toBe("fail");
    expect(june.findings.map((f) => [f.kind, f.ref, f.state, f.count, f.fix])).toEqual([["payroll_due", "2026-06", "missing", 2, "payroll"]]);
    expect(await dueIn("07")).toEqual([3]);
    expect(await dueIn("05")).toEqual([3]);
    expect(await dueIn("04")).toEqual([3]);
    await expectCloseRefused(request, "06", "drafts");

    insert(sqlite, "hr_payroll_run", { id: "pr-june", number: "PAY-2026-06", year: 2026, month: 6, period_start: "2026-06-01", period_end: "2026-06-30", currency: "EGP", status: "calculated" });
    payslip("emp-1");
    expect((await check("06", "drafts")).findings.map((f) => [f.kind, f.state, f.count])).toEqual([["drafts", "draft", 1], ["payroll_due", "draft", 2]]);

    sqlite.prepare(`UPDATE hr_payroll_run SET status = 'approved' WHERE id = 'pr-june'`).run();
    expect(await dueIn("06")).toEqual([1]);
    payslip("emp-suspended");
    expect((await check("06", "drafts")).status).toBe("pass");
  });

  it("payroll is due for whoever a run for the month would pay: a later leaver is covered by the run that paid them, a mid-month leaver is owed their final pay", async () => {
    const { sqlite, check } = await world();
    const employee = (id: string, extra: Record<string, string | number | null> = {}, contract: Record<string, string | number | null> = {}) => {
      insert(sqlite, "hr_employee", { id, code: id, hire_date: "2026-01-01", status: "active", ...extra });
      insert(sqlite, "hr_contract", { id: `ct-${id}`, number: `CT-${id}`, employee_id: id, type: "indefinite", pay_basis: "monthly", pay_frequency: "monthly", currency: "EGP", start_date: "2026-01-01", end_date: null, status: "active", ...contract });
    };
    const run = (month: number, status: string, employeeIds: readonly string[]) => {
      const key = String(month).padStart(2, "0");
      insert(sqlite, "hr_payroll_run", { id: `pr-${key}`, number: `PAY-2026-${key}`, year: 2026, month, period_start: `2026-${key}-01`, period_end: `2026-${key}-28`, currency: "EGP", status });
      for (const id of employeeIds) {
        insert(sqlite, "hr_payslip", { id: `ps-${key}-${id}`, number: `PS-${key}-${id}`, run_id: `pr-${key}`, employee_id: id, contract_id: `ct-${id}`, currency: "EGP", period_start: `2026-${key}-01`, period_end: `2026-${key}-28` });
      }
    };
    const dueIn = async (month: string) => (await check(month, "drafts")).findings.filter((f) => f.kind === "payroll_due").map((f) => [f.state, f.count]);
    employee("emp-stays");
    employee("emp-left-aug", { status: "terminated", terminated_at: "2026-08-20T19:21:15.000Z" });
    employee("emp-left-mid-july", { status: "terminated", terminated_at: "2026-07-12" });
    employee("emp-daily", {}, { pay_basis: "daily" });
    employee("emp-undated", { status: "terminated", terminated_at: null });

    run(6, "disbursed", ["emp-stays", "emp-left-aug", "emp-left-mid-july"]);
    expect(await dueIn("06")).toEqual([["missing", 1]]);
    insert(sqlite, "hr_payslip", { id: "ps-06-daily", number: "PS-06-DAILY", run_id: "pr-06", employee_id: "emp-daily", contract_id: "ct-emp-daily", currency: "EGP", period_start: "2026-06-01", period_end: "2026-06-28" });
    expect(await dueIn("06")).toEqual([]);

    run(7, "approved", ["emp-stays", "emp-left-aug", "emp-daily"]);
    expect(await dueIn("07")).toEqual([["missing", 1]]);
    insert(sqlite, "hr_payslip", { id: "ps-07-final", number: "PS-07-FINAL", run_id: "pr-07", employee_id: "emp-left-mid-july", contract_id: "ct-emp-left-mid-july", currency: "EGP", period_start: "2026-07-01", period_end: "2026-07-12" });
    expect(await dueIn("07")).toEqual([]);

    expect(await dueIn("08")).toEqual([["missing", 3]]);
    expect(await dueIn("09")).toEqual([["missing", 2]]);
  });

  it("a run for a month pays a leaver to their last day and someone who left later in full — on the payslips and in the entry the approval posts", async () => {
    const { sqlite, request, check } = await world();
    const hire = async (id: string, salary: string) => {
      expect((await request("POST", "/hr/employees", { id, firstName: "موظف", lastName: id, branchId: "BR-MAIN", hireDate: "2026-01-01" })).status).toBe(201);
      expect((await request("POST", "/hr/contracts", { id: `ct-${id}`, employeeId: id, type: "indefinite", startDate: "2026-01-01", monthlySalary: salary, currency: "EGP" })).status).toBe(201);
    };
    await hire("emp-stays", "6000");
    await hire("emp-mid-june", "9000");
    await hire("emp-left-july", "3000");
    expect((await request("POST", "/hr/employees/emp-mid-june/terminate", { effectiveDate: "2026-06-12" })).status).toBe(200);
    expect((await request("POST", "/hr/employees/emp-left-july/terminate", { effectiveDate: "2026-07-20" })).status).toBe(200);

    const run = (await (await request("POST", "/hr/payroll/runs", { id: "pr-june", year: 2026, month: 6 })).json()) as { id: string };
    expect((await request("POST", `/hr/payroll/runs/${run.id}/calculate`, {})).status).toBe(200);
    const payslips = sqlite.prepare(`SELECT employee_id AS employee, paid_days AS days, net_pay AS net FROM hr_payslip WHERE run_id = ? ORDER BY employee_id`).safeIntegers().all(run.id);
    expect(payslips).toEqual([
      { employee: "emp-left-july", days: 30n, net: 3_000_000_000n },
      { employee: "emp-mid-june", days: 12n, net: 3_600_000_000n },
      { employee: "emp-stays", days: 30n, net: 6_000_000_000n },
    ]);
    expect((await check("06", "drafts")).findings.filter((f) => f.kind === "payroll_due").map((f) => [f.state, f.count])).toEqual([["draft", 3]]);

    const approved = (await (await request("POST", `/hr/payroll/runs/${run.id}/approve`, {})).json()) as { status: string; journalEntryId: string };
    expect(approved.status).toBe("approved");
    const entry = sqlite
      .prepare(`SELECT je.date AS date, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit FROM journal_entry je JOIN journal_line jl ON jl.entry_id = je.id WHERE je.id = ? GROUP BY je.date`)
      .safeIntegers()
      .get(approved.journalEntryId);
    expect(entry).toEqual({ date: "2026-06-30", debit: 12_600_000_000n, credit: 12_600_000_000n });
    expect((await check("06", "drafts")).findings.filter((f) => f.kind === "payroll_due")).toEqual([]);
    expect((await check("07", "drafts")).findings.filter((f) => f.kind === "payroll_due").map((f) => [f.state, f.count])).toEqual([["missing", 2]]);
  });

  it("a daily-paid worker is owed by the month exactly as a run would pay them, because the check and the run price with the same bindings", async () => {
    const { sqlite, request, check } = await world();
    const due = async () => (await check("06", "drafts")).findings.filter((f) => f.kind === "payroll_due").map((f) => [f.state, f.count]);
    expect((await request("POST", "/hr/employees", { id: "emp-monthly", firstName: "موظف", lastName: "شهري", branchId: "BR-MAIN", hireDate: "2026-01-01" })).status).toBe(201);
    expect((await request("POST", "/hr/contracts", { id: "ct-monthly", employeeId: "emp-monthly", type: "indefinite", startDate: "2026-01-01", monthlySalary: "6000", currency: "EGP" })).status).toBe(201);
    expect((await request("POST", "/hr/employees", { id: "emp-daily", firstName: "عامل", lastName: "يومية", branchId: "BR-MAIN", hireDate: "2026-01-01" })).status).toBe(201);
    const daily = await request("POST", "/hr/contracts", { id: "ct-daily", employeeId: "emp-daily", type: "indefinite", startDate: "2026-01-01", monthlySalary: "0", payBasis: "daily", dailyRate: "200", currency: "EGP" });
    expect(`${daily.status} ${daily.status === 201 ? "" : await daily.text()}`.trim()).toBe("201");

    expect(await due()).toEqual([["missing", 2]]);

    expect((await request("POST", "/hr/payroll/runs", { id: "pr-june", year: 2026, month: 6 })).status).toBe(201);
    expect((await request("POST", "/hr/payroll/runs/pr-june/calculate", {})).status).toBe(200);
    expect(sqlite.prepare(`SELECT employee_id AS employee FROM hr_payslip WHERE run_id = 'pr-june' ORDER BY employee_id`).all()).toEqual([{ employee: "emp-daily" }, { employee: "emp-monthly" }]);
    expect((await request("POST", "/hr/payroll/runs/pr-june/approve", {})).status).toBe(200);
    expect(await due()).toEqual([]);
  });

  it("a tenant without the HR module is not asked for a payroll run", async () => {
    const withoutHr = await world(MODULE_CATALOG.filter((module) => module !== "hr"));
    insert(withoutHr.sqlite, "hr_employee", { id: "emp-1", code: "emp-1", hire_date: "2026-01-01", status: "active" });
    insert(withoutHr.sqlite, "hr_contract", { id: "ct-1", number: "CT-1", employee_id: "emp-1", type: "indefinite", pay_basis: "monthly", pay_frequency: "monthly", currency: "EGP", start_date: "2026-01-01", end_date: null, status: "active" });
    expect((await withoutHr.check("06", "drafts")).findings.filter((f) => f.kind === "payroll_due")).toEqual([]);

    const withHr = await world([...MODULE_CATALOG]);
    insert(withHr.sqlite, "hr_employee", { id: "emp-1", code: "emp-1", hire_date: "2026-01-01", status: "active" });
    insert(withHr.sqlite, "hr_contract", { id: "ct-1", number: "CT-1", employee_id: "emp-1", type: "indefinite", pay_basis: "monthly", pay_frequency: "monthly", currency: "EGP", start_date: "2026-01-01", end_date: null, status: "active" });
    expect((await withHr.check("06", "drafts")).findings.filter((f) => f.kind === "payroll_due").map((f) => f.count)).toEqual([1]);
  });

  const UNPOSTED_SOURCES = [
    { kind: "progress_certificate", table: "contracting_certificate", date: "execution_date", open: ["draft", "measured", "certified"], done: "approved", fix: "certificates", extra: { doc_no: "CERT" } },
    { kind: "subcontract_certificate", table: "subcontract_certificate", date: "execution_date", open: ["draft", "measured", "certified"], done: "approved", fix: "subcontract-certificates", extra: { doc_no: "SUBCERT" }, parent: { table: "subcontract", column: "subcontract_id" } },
    { kind: "physical_count", table: "physical_count", date: "date", open: ["IN_PROGRESS", "COMPLETED"], done: "ADJUSTMENT_GENERATED", fix: "physical-counts", extra: {} },
    { kind: "site_issue", table: "site_issue", date: "date", open: ["draft"], done: "issued", fix: "site-issues", extra: {} },
    { kind: "site_receipt", table: "site_receipt", date: "date", open: ["draft"], done: "confirmed", fix: "site-issues", extra: {} },
    { kind: "material_consumption", table: "material_consumption", date: "date", open: ["draft"], done: "confirmed", fix: "material-consumption", extra: {} },
    { kind: "equipment_log", table: "equipment_log", date: "date", open: ["draft"], done: "confirmed", fix: "equipment-logs", extra: {} },
  ] as const;

  it.each(UNPOSTED_SOURCES)("counts an unposted $kind in the month of its own date, and not once it is posted", async (source) => {
    const { sqlite, check } = await world();
    const parent = "parent" in source ? source.parent : null;
    if (parent) insert(sqlite, parent.table, { id: "parent-1", doc_no: "PARENT-1" });
    const row = (id: string, status: string, date: string) => {
      const extra = Object.fromEntries(Object.entries(source.extra).map(([column, value]) => [column, `${value}-${id}`]));
      insert(sqlite, source.table, { id, status, [source.date]: date, ...extra, ...(parent ? { [parent.column]: "parent-1" } : {}) });
    };
    source.open.forEach((status, index) => row(`open-${index}`, status, "2026-06-30"));
    row("posted", source.done, "2026-06-15");
    row("next-month", source.open[0], "2026-07-01");

    const june = await check("06", "drafts");
    expect(june.status).toBe("fail");
    expect(june.findings.map((f) => [f.ref, f.count, f.fix])).toEqual([[source.kind, source.open.length, source.fix]]);
    expect((await check("07", "drafts")).findings.map((f) => [f.ref, f.count])).toEqual([[source.kind, 1]]);
    expect((await check("05", "drafts")).status).toBe("pass");
  });

  it("a work order in progress is not an unposted document: each stage posts as it happens", async () => {
    const { sqlite, check } = await world();
    insert(sqlite, "work_order", { id: "wo-1", number: "WO-000001", scheduled_start_date: "2026-06-10", status: "in_progress", stage: "materials_issued" });
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

  it("a revaluation run goes stale when a foreign-currency entry is posted into the month after it ran", async () => {
    const { sqlite, check } = await world();
    const usd = { currency: "USD", fx_rate: "50" };
    const run = (ranAt: string) => insert(sqlite, "fx_revaluation_run", { as_of_date: "2026-06-30", currency: "*", ran_by: "admin", ran_at: ranAt });
    post(sqlite, "usd-1", "2026-06-10", [["1105", 5000, 0, usd], ["4100", 0, 5000]], { posted_at: "2026-07-01T08:00:00.000Z" });

    expect((await check("06", "fx_revaluation")).findings.map((f) => [f.ref, f.state])).toEqual([["USD", "missing"]]);
    run("2026-07-02T09:00:00.000Z");
    expect((await check("06", "fx_revaluation")).status).toBe("pass");

    post(sqlite, "usd-late", "2026-06-20", [["1105", 1000, 0, usd], ["4100", 0, 1000]], { posted_at: "2026-07-03T11:00:00.000Z" });
    const stale = await check("06", "fx_revaluation");
    expect(stale.status).toBe("fail");
    expect(stale.findings.map((f) => [f.ref, f.passed])).toEqual([["USD", false]]);

    post(sqlite, "usd-july", "2026-07-04", [["1105", 700, 0, usd], ["4100", 0, 700]], { posted_at: "2026-07-04T08:00:00.000Z" });
    run("2026-07-03T12:00:00.000Z");
    expect((await check("06", "fx_revaluation")).status).toBe("pass");
  });

  it("a revaluation is read from the entry it posted, with or without a run row; a run that posted nothing counts only where there was nothing it could not see", async () => {
    const { sqlite, check } = await world();
    const usd = { currency: "USD", fx_rate: "50" };
    const state = async (month: string) => (await check(month, "fx_revaluation")).findings.map((f) => [f.ref, f.state]);

    post(sqlite, "usd-may", "2026-05-10", [["1105", 5000, 0, usd], ["4100", 0, 5000]], { posted_at: "2026-05-10T08:00:00.000Z" });
    expect(await state("05")).toEqual([["USD", "missing"]]);
    post(
      sqlite,
      "reval-may",
      "2026-05-31",
      [["1105", 100, 0, { currency: "USD", fx_rate: "51", memo: "إعادة تقييم عملات أجنبية" }], ["4100", 0, 100]],
      { posted_at: "2026-06-01T09:00:00.000Z", source_doc_type: "FX_REVALUATION" },
    );
    expect(await state("05")).toEqual([["USD", "ok"]]);

    insert(sqlite, "fx_revaluation_run", { as_of_date: "2026-06-30", currency: "*", entry_id: null, ran_by: "admin", ran_at: "2026-07-01T09:00:00.000Z" });
    expect(await state("06")).toEqual([["USD", "ok"]]);

    insert(sqlite, "treasury_account", { id: "ta-usd", code: "BNK-USD", name: "البنك الأهلي — دولار", type: "bank", currency: "USD", branch_id: "BR-MAIN", gl_account_id: "1021", status: "active" });
    post(sqlite, "usd-bank", "2026-06-12", [["1021", 48000, 0], ["2170", 0, 48000]], { posted_at: "2026-06-12T08:00:00.000Z" });
    expect(await state("06")).toEqual([["USD", "missing"]]);
    expect(await state("05")).toEqual([["USD", "ok"]]);
  });

  it("a revaluation undone within the month no longer covers it; one that auto-reverses the next day still does", async () => {
    const { sqlite, check } = await world();
    const usd = { currency: "USD", fx_rate: "50" };
    const restated = { currency: "USD", fx_rate: "51", memo: "إعادة تقييم عملات أجنبية" };
    const state = async (month: string) => (await check(month, "fx_revaluation")).findings.map((f) => [f.ref, f.state]);
    const revaluation = (id: string, date: string, reversalId: string, reversalDate: string, stamp: string): void => {
      post(sqlite, id, date, [["1105", 100, 0, restated], ["4100", 0, 100]], { posted_at: stamp, source_doc_type: "FX_REVALUATION" });
      post(sqlite, reversalId, reversalDate, [["4100", 100, 0], ["1105", 0, 100, restated]], { posted_at: stamp, source_doc_type: "FX_REVALUATION", reverses_entry_id: id });
      sqlite.prepare(`UPDATE journal_entry SET status = 'reversed', reversed_by_entry_id = ? WHERE id = ?`).run(reversalId, id);
    };

    post(sqlite, "usd-feb", "2026-02-10", [["1105", 5000, 0, usd], ["4100", 0, 5000]], { posted_at: "2026-02-10T08:00:00.000Z" });
    revaluation("reval-mar", "2026-03-31", "reval-mar-undone", "2026-03-31", "2026-04-01T09:00:00.000Z");
    insert(sqlite, "fx_revaluation_run", { as_of_date: "2026-03-31", currency: "USD", entry_id: "reval-mar", ran_by: "admin", ran_at: "2026-04-01T09:00:00.000Z" });
    revaluation("reval-apr", "2026-04-30", "reval-apr-auto", "2026-05-01", "2026-05-01T09:00:00.000Z");

    expect(await state("03")).toEqual([["USD", "missing"]]);
    expect(await state("04")).toEqual([["USD", "ok"]]);
  });

  it("an asset that was in service all month and disposed of the month after is still due for the month", async () => {
    const { sqlite, check } = await world();
    insert(sqlite, "asset", {
      id: "asset-sold", code: "FA-T-2", name_ar: "سيارة توزيع", category_id: "cat-none", scope: "general",
      acquisition_date: "2026-01-01", acquisition_cost: 120_000 * SCALE, depreciation_start_date: "2026-01-01",
      depreciation_method: "straight_line", useful_life_months: 60, salvage_value: 0, accumulated_depreciation: 0, status: "disposed",
    });
    post(sqlite, "disposal", "2026-05-10", [["5910", 120_000, 0], ["1500", 0, 120_000]], { source: "system", source_doc_type: "ASSET_DISPOSAL", source_doc_id: "asset-sold" });

    const april = await check("04", "depreciation");
    expect(april.status).toBe("fail");
    expect(april.findings.map((f) => [f.ref, f.state, f.count])).toEqual([["2026-04:general", "missing", 1]]);
    expect((await check("05", "depreciation")).status).toBe("not_applicable");
    expect((await check("06", "depreciation")).status).toBe("not_applicable");
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

  it("a month closed before the checklist existed can be locked over a failing check with a reason; one whose close is in the audit trail still needs a second person", async () => {
    const { sqlite, requestAs } = await world();
    const PERMISSIONS = ["accounting.period.view", "accounting.period.close", "accounting.period.lock", "accounting.period.override_close"];
    const closer = requestAs("U-CLOSER", PERMISSIONS);
    const reason = { overrideReason: "قفل نهائي باعتماد المدير المالي بعد المراجعة" };
    const lockEvents = (month: string) =>
      sqlite.prepare(`SELECT actor, json_extract(details, '$.reason') AS reason FROM audit_event WHERE entity_type = 'FISCAL_PERIOD' AND entity_id = ? AND action = 'LOCK'`).all(`fp-2026-${month}`);
    const statusOf = (month: string) => (sqlite.prepare(`SELECT status FROM fiscal_period WHERE id = ?`).get(`fp-2026-${month}`) as { status: string }).status;
    for (const month of ["02", "03"]) {
      journal(sqlite, `draft-${month}`, null, `2026-${month}-10`, "draft");
      sqlite.prepare(`UPDATE fiscal_period SET status = 'closed' WHERE id = ?`).run(`fp-2026-${month}`);
    }
    insert(sqlite, "audit_event", { stream: "sensitive", module: "accounting", entity_type: "FISCAL_PERIOD", entity_id: "fp-2026-03", action: "CLOSE", actor: "U-CLOSER", timestamp: "2026-04-02T09:00:00.000Z", severity: "WARNING" });

    expect((await closer("POST", "/fiscal-periods/fp-2026-02/lock", {})).status).toBe(409);
    expect(statusOf("02")).toBe("closed");
    expect((await closer("POST", "/fiscal-periods/fp-2026-02/lock", reason)).status).toBe(200);
    expect(statusOf("02")).toBe("locked");
    expect(lockEvents("02")).toEqual([{ actor: "U-CLOSER", reason: reason.overrideReason }]);

    const sameUser = await closer("POST", "/fiscal-periods/fp-2026-03/lock", reason);
    expect(((await sameUser.json()) as { error: string }).error).toBe("PERIOD_LOCK_OVERRIDE_SAME_USER");
    expect(statusOf("03")).toBe("closed");
    expect((await requestAs("U-CONTROLLER", PERMISSIONS)("POST", "/fiscal-periods/fp-2026-03/lock", reason)).status).toBe(200);
    expect(statusOf("03")).toBe("locked");
    expect(lockEvents("03")).toEqual([{ actor: "U-CONTROLLER", reason: reason.overrideReason }]);
  });
});

