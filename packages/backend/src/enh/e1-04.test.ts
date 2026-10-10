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
});
