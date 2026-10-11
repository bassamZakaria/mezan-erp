import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSqliteTreasuryAccountRepository } from "./treasury-account-repository.js";

const INSTALLED_SHAPE = `
CREATE TABLE treasury_account (
  id                    TEXT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  name_en               TEXT,
  type                  TEXT NOT NULL,
  currency              TEXT NOT NULL,
  bank_account_number   TEXT,
  branch_id             TEXT NOT NULL,
  gl_account_id         TEXT,
  opening_balance       INTEGER NOT NULL,
  opening_balance_date  TEXT,
  guarantee_facility_limit INTEGER,
  status                TEXT NOT NULL
);
CREATE INDEX treasury_account_by_branch ON treasury_account(branch_id);
CREATE TABLE treasury_account_log (account_id TEXT NOT NULL, code TEXT NOT NULL);
CREATE TRIGGER treasury_account_logged AFTER INSERT ON treasury_account BEGIN
  INSERT INTO treasury_account_log (account_id, code) VALUES (NEW.id, NEW.code);
END;
CREATE TABLE voucher_stub (id TEXT PRIMARY KEY, treasury_account_id TEXT NOT NULL REFERENCES treasury_account(id));
`;

const ROWS = [
  ["TR-BRANCH", "CASH-1", "صندوق الفرع", null, "cash", "EGP", null, "BR-MAIN", "1300-1", 338_000_000, "2026-01-01", null, "active"],
  ["TR-COMPANY", "BANK-1", "حساب الشركة", "Company account", "bank", "EGP", "EG380019000500000000263180002", "", "1310", 9_007_199_254_740_991, null, 5_000_000_000, "active"],
  ["TR-COMPANY-2", "BANK-2", "حساب الضمانات", null, "bank", "USD", null, "", null, 0, null, null, "inactive"],
] as const;

function installed(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(INSTALLED_SHAPE);
  const insert = sqlite.prepare("INSERT INTO treasury_account VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const row of ROWS) insert.run(...row);
  sqlite.prepare("INSERT INTO voucher_stub VALUES ('V-1', 'TR-COMPANY')").run();
  return sqlite;
}

const branchColumn = (sqlite: Database.Database) =>
  (sqlite.prepare("PRAGMA table_info(treasury_account)").all() as { name: string; notnull: number }[]).find((column) => column.name === "branch_id");
const stored = (sqlite: Database.Database) => sqlite.prepare("SELECT * FROM treasury_account ORDER BY id").all() as Record<string, unknown>[];

describe("treasury_account.branch_id — a company-level account is a real NULL, not an empty string", () => {
  it("rebuilds an installed table: the column turns nullable, '' becomes NULL, and nothing else moves", async () => {
    const sqlite = installed();
    const before = stored(sqlite);
    const repo = createSqliteTreasuryAccountRepository(sqlite);

    expect(branchColumn(sqlite)?.notnull).toBe(0);
    const after = stored(sqlite);
    expect(after).toHaveLength(before.length);
    expect(after).toEqual(before.map((row) => ({ ...row, branch_id: row["branch_id"] === "" ? null : row["branch_id"] })));
    expect(after.filter((row) => row["branch_id"] === null).map((row) => row["id"])).toEqual(["TR-COMPANY", "TR-COMPANY-2"]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM treasury_account WHERE branch_id = ''").get()).toEqual({ n: 0 });

    expect(sqlite.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'treasury_account%' ORDER BY name").all().map((row) => (row as { name: string }).name)).toEqual([
      "treasury_account",
      "treasury_account_by_branch",
      "treasury_account_log",
      "treasury_account_logged",
    ]);

    expect((await repo.findById("TR-COMPANY"))?.branchId).toBeNull();
    expect((await repo.findById("TR-COMPANY"))?.openingBalance.toScaledNumber()).toBe(9_007_199_254_740_991);
    expect((await repo.findById("TR-BRANCH"))?.branchId).toBe("BR-MAIN");
  });

  it("keeps the unique code, the foreign key onto it and the trigger working after the rebuild", () => {
    const sqlite = installed();
    createSqliteTreasuryAccountRepository(sqlite);
    const insert = sqlite.prepare("INSERT INTO treasury_account VALUES (?, ?, 'حساب', NULL, 'cash', 'EGP', NULL, NULL, NULL, 0, NULL, NULL, 'active')");
    expect(() => insert.run("TR-NEW", "BANK-1")).toThrow(/UNIQUE/);
    insert.run("TR-NEW", "CASH-9");
    expect(sqlite.prepare("SELECT code FROM treasury_account_log WHERE account_id = 'TR-NEW'").get()).toEqual({ code: "CASH-9" });
    expect(() => sqlite.prepare("INSERT INTO voucher_stub VALUES ('V-2', 'TR-GONE')").run()).toThrow(/FOREIGN KEY/);
    expect(() => sqlite.prepare("DELETE FROM treasury_account WHERE id = 'TR-COMPANY'").run()).toThrow(/FOREIGN KEY/);
  });

  it("is a no-op the second time, and on a database created at this version", () => {
    const sqlite = installed();
    createSqliteTreasuryAccountRepository(sqlite);
    const once = stored(sqlite);
    const schema = () => sqlite.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'treasury_account' ORDER BY name").all();
    const shape = schema();
    createSqliteTreasuryAccountRepository(sqlite);
    expect(stored(sqlite)).toEqual(once);
    expect(schema()).toEqual(shape);

    const fresh = new Database(":memory:");
    createSqliteTreasuryAccountRepository(fresh);
    expect(branchColumn(fresh)?.notnull).toBe(0);
  });

  it("writes a company-level account as NULL", async () => {
    const sqlite = new Database(":memory:");
    const repo = createSqliteTreasuryAccountRepository(sqlite);
    const template = await (async () => {
      const seeded = installed();
      const account = await createSqliteTreasuryAccountRepository(seeded).findById("TR-COMPANY");
      return account!;
    })();
    await repo.create({ ...template, id: "TR-X", code: "X-1" });
    expect(sqlite.prepare("SELECT branch_id FROM treasury_account WHERE id = 'TR-X'").get()).toEqual({ branch_id: null });
    await repo.update({ ...template, id: "TR-X", code: "X-1", branchId: "BR-ALEX" });
    await repo.update({ ...template, id: "TR-X", code: "X-1", branchId: null });
    expect(sqlite.prepare("SELECT branch_id FROM treasury_account WHERE id = 'TR-X'").get()).toEqual({ branch_id: null });
  });

  it("leaves the installed table exactly as it was when the rebuild fails after the old table is dropped", () => {
    const sqlite = installed();
    sqlite.exec("CREATE UNIQUE INDEX treasury_account_labelled ON treasury_account(COALESCE(branch_id || code, 'x'))");
    const schema = () => sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE tbl_name IN ('treasury_account', 'treasury_account_log', 'voucher_stub') ORDER BY name").all();
    const before = { rows: stored(sqlite), schema: schema() };
    expect(() => createSqliteTreasuryAccountRepository(sqlite)).toThrow(/UNIQUE/);
    expect(branchColumn(sqlite)?.notnull).toBe(1);
    expect({ rows: stored(sqlite), schema: schema() }).toEqual(before);
    expect(sqlite.prepare("SELECT name FROM sqlite_temp_master").all()).toEqual([]);
    expect(sqlite.pragma("foreign_key_check")).toEqual([]);
  });

  it("does not stop on a reference that was already broken before it ran", () => {
    const sqlite = installed();
    sqlite.pragma("foreign_keys = OFF");
    sqlite.prepare("INSERT INTO voucher_stub VALUES ('V-DANGLING', 'TR-NEVER-EXISTED')").run();
    sqlite.pragma("foreign_keys = ON");
    createSqliteTreasuryAccountRepository(sqlite);
    expect(branchColumn(sqlite)?.notnull).toBe(0);
    expect(stored(sqlite)).toHaveLength(ROWS.length);
    expect(sqlite.pragma("foreign_key_check")).toHaveLength(1);
  });
});
