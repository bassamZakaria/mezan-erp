import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectSodConflicts } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend } from "./create-backend.js";

const OLD_SHAPE: Readonly<Record<string, readonly string[]>> = {
  TREASURY_CASHIER: ["treasury.account.view", "treasury.cash_voucher.view", "treasury.cash_voucher.create", "treasury.cash_voucher.confirm", "cheques.view"],
  BRANCH_MANAGER: ["sales.invoice.view", "treasury.cash_voucher.view", "treasury.cash_voucher.create", "treasury.cash_voucher.confirm", "hr.leave.approve"],
  FINANCE_MANAGER: ["accounting.journal.view", "accounting.journal.post", "accounting.period.view", "accounting.period.close"],
  HR_OFFICER: ["hr.leave.view", "hr.leave.create", "hr.leave.approve"],
  ACCOUNTANT: ["accounting.journal.view", "accounting.journal.create"],
  MY_CASHIER: ["treasury.cash_voucher.view", "treasury.cash_voucher.create", "treasury.cash_voucher.confirm"],
};

function writeOldShape(dbPath: string): void {
  const { sqlite } = openSqliteConnection(dbPath);
  sqlite.exec("DROP TABLE IF EXISTS upgrade_step");
  const insert = sqlite.prepare("INSERT INTO role (id, code, name, description, permissions, is_system, created_at) VALUES (?, ?, ?, '', ?, 0, '2026-01-01T00:00:00.000Z')");
  for (const [code, permissions] of Object.entries(OLD_SHAPE)) insert.run(`ROLE-${code}`, code, code, JSON.stringify(permissions));
  sqlite.close();
}

function stored(dbPath: string): Record<string, string[]> {
  const { sqlite } = openSqliteConnection(dbPath);
  const rows = sqlite.prepare("SELECT code, permissions FROM role ORDER BY code").all() as { code: string; permissions: string }[];
  sqlite.close();
  return Object.fromEntries(rows.map((row) => [row.code, JSON.parse(row.permissions) as string[]]));
}

describe("upgrade — a tenant seeded before the duty split", () => {
  it("has its seeded roles corrected on the next start, once, and its own roles left alone", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-roles-")), "books.db");
    (await createBackend({ dbPath })).close();
    writeOldShape(dbPath);
    expect(detectSodConflicts(stored(dbPath)["TREASURY_CASHIER"]!).length).toBeGreaterThan(0);

    (await createBackend({ dbPath })).close();
    const upgraded = stored(dbPath);

    expect(upgraded["TREASURY_CASHIER"]).toEqual(["treasury.account.view", "treasury.cash_voucher.view", "treasury.cash_voucher.create", "cheques.view", "dashboard.view"]);
    expect(upgraded["BRANCH_MANAGER"]).toEqual(["sales.invoice.view", "treasury.cash_voucher.view", "treasury.cash_voucher.confirm", "hr.leave.approve", "dashboard.view"]);
    expect(upgraded["ACCOUNTANT"]).toContain("accounting.journal.post");
    for (const code of ["TREASURY_CASHIER", "BRANCH_MANAGER", "FINANCE_MANAGER", "HR_OFFICER", "ACCOUNTANT"]) {
      expect(detectSodConflicts(upgraded[code]!), code).toEqual([]);
      expect(upgraded[code], code).toContain("dashboard.view");
    }
    expect(upgraded["MY_CASHIER"]).toEqual(OLD_SHAPE["MY_CASHIER"]);
    expect(upgraded["SYSTEM_ADMIN"]).toEqual(["*"]);

    const { sqlite } = openSqliteConnection(dbPath);
    sqlite.prepare("UPDATE role SET permissions = ? WHERE code = 'TREASURY_CASHIER'").run(JSON.stringify(OLD_SHAPE["TREASURY_CASHIER"]));
    sqlite.close();
    (await createBackend({ dbPath })).close();
    expect(stored(dbPath)["TREASURY_CASHIER"]).toEqual(OLD_SHAPE["TREASURY_CASHIER"]);
  }, 120_000);
});

const BEFORE_BOTH_UPGRADES: Readonly<Record<string, readonly string[]>> = {
  FINANCE_MANAGER: ["accounting.journal.view", "accounting.journal.post", "accounting.period.view", "accounting.period.close", "accounting.period.reopen"],
  ACCOUNTANT: ["accounting.journal.view", "accounting.journal.create"],
  TREASURY_CASHIER: ["treasury.cash_voucher.view", "treasury.cash_voucher.create", "treasury.cash_voucher.confirm", "cheques.view", "cheques.bounce"],
  MY_TREASURER: ["cheques.view", "cheques.bounce", "accounting.journal.post"],
};

function writeBooksOlderThanBothUpgrades(dbPath: string): void {
  const { sqlite } = openSqliteConnection(dbPath);
  sqlite.exec("DROP TABLE IF EXISTS upgrade_step");
  sqlite.exec("DELETE FROM permission_grant_marker");
  const insert = sqlite.prepare("INSERT INTO role (id, code, name, description, permissions, is_system, created_at) VALUES (?, ?, ?, '', ?, 0, '2026-01-01T00:00:00.000Z')");
  for (const [code, permissions] of Object.entries(BEFORE_BOTH_UPGRADES)) insert.run(`ROLE-${code}`, code, code, JSON.stringify(permissions));
  sqlite.close();
}

describe("upgrade — a tenant older than the reversal permissions and the duty split", () => {
  it("is granted each reversal by what it could already do, then has its seeded roles separated with the reversal following the duty it belongs to", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-roles-both-")), "books.db");
    (await createBackend({ dbPath })).close();
    writeBooksOlderThanBothUpgrades(dbPath);

    (await createBackend({ dbPath })).close();
    const upgraded = stored(dbPath);

    expect(upgraded["MY_TREASURER"]).toEqual(["cheques.view", "cheques.bounce", "accounting.journal.post", "accounting.revaluation.reverse", "cheques.reverse"]);
    expect(upgraded["TREASURY_CASHIER"]).toEqual(["treasury.cash_voucher.view", "treasury.cash_voucher.create", "cheques.view", "cheques.bounce", "cheques.reverse", "dashboard.view"]);
    expect(upgraded["FINANCE_MANAGER"]).toEqual(["accounting.journal.view", "accounting.period.view", "accounting.period.close", "accounting.period.reopen", "accounting.year_end_close.reverse", "dashboard.view"]);
    expect(upgraded["ACCOUNTANT"]).toEqual([
      "accounting.journal.view",
      "accounting.journal.create",
      "accounting.journal.post",
      "accounting.revaluation.reverse",
      "dashboard.view",
      "treasury.reconciliation.view",
      "treasury.reconciliation.match",
      "treasury.reconciliation.post_entry",
    ]);
    for (const code of ["FINANCE_MANAGER", "ACCOUNTANT", "TREASURY_CASHIER"]) expect(detectSodConflicts(upgraded[code]!), code).toEqual([]);

    (await createBackend({ dbPath })).close();
    expect(stored(dbPath)).toEqual(upgraded);

    const { sqlite } = openSqliteConnection(dbPath);
    sqlite.prepare("UPDATE role SET permissions = ? WHERE code = 'MY_TREASURER'").run(JSON.stringify(["cheques.view", "cheques.bounce"]));
    sqlite.close();
    (await createBackend({ dbPath })).close();
    expect(stored(dbPath)["MY_TREASURER"]).toEqual(["cheques.view", "cheques.bounce"]);
  }, 120_000);
});

describe("upgrade — a tenant that separated duties before reconciliation was taken from the cashier", () => {
  it("moves bank reconciliation from the seeded cashier to the seeded accountant once, tells the administrators, and leaves a custom role alone", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-roles-recon-")), "books.db");
    (await createBackend({ dbPath })).close();
    const { sqlite } = openSqliteConnection(dbPath);
    sqlite.prepare("DELETE FROM upgrade_step WHERE id = 'seeded_role_reconciliation_split'").run();
    const insert = sqlite.prepare("INSERT INTO role (id, code, name, description, permissions, is_system, created_at) VALUES (?, ?, ?, '', ?, 0, '2026-01-01T00:00:00.000Z')");
    const cashier = ["treasury.cash_voucher.view", "treasury.cash_voucher.create", "treasury.reconciliation.view", "treasury.reconciliation.import", "treasury.reconciliation.match", "dashboard.view"];
    const accountant = ["accounting.journal.view", "accounting.journal.create", "accounting.journal.post", "dashboard.view"];
    insert.run("ROLE-TREASURY_CASHIER", "TREASURY_CASHIER", "أمين الخزنة", JSON.stringify(cashier));
    insert.run("ROLE-ACCOUNTANT", "ACCOUNTANT", "محاسب", JSON.stringify(accountant));
    insert.run("ROLE-MY_TELLER", "MY_TELLER", "صرّاف", JSON.stringify(cashier));
    const noticesBefore = (sqlite.prepare("SELECT count(*) AS n FROM notification WHERE event_code = 'SEEDED_ROLE_DUTIES_SEPARATED'").get() as { n: number }).n;
    sqlite.close();
    expect(detectSodConflicts(cashier).length).toBeGreaterThan(0);

    (await createBackend({ dbPath })).close();
    const upgraded = stored(dbPath);

    expect(upgraded["TREASURY_CASHIER"]).toEqual(["treasury.cash_voucher.view", "treasury.cash_voucher.create", "treasury.reconciliation.view", "treasury.reconciliation.import", "dashboard.view"]);
    expect(upgraded["ACCOUNTANT"]).toEqual([...accountant, "treasury.reconciliation.view", "treasury.reconciliation.match", "treasury.reconciliation.post_entry"]);
    expect(upgraded["MY_TELLER"]).toEqual(cashier);
    for (const code of ["TREASURY_CASHIER", "ACCOUNTANT"]) expect(detectSodConflicts(upgraded[code]!), code).toEqual([]);
    const after = openSqliteConnection(dbPath).sqlite;
    const notices = after.prepare("SELECT body FROM notification WHERE event_code = 'SEEDED_ROLE_DUTIES_SEPARATED' ORDER BY created_at DESC").all() as { body: string }[];
    expect(notices.length).toBeGreaterThan(noticesBefore);
    expect(notices[0]?.body).toContain("treasury.reconciliation.match");
    expect(notices[0]?.body).toContain("TREASURY_CASHIER");
    after.close();

    (await createBackend({ dbPath })).close();
    expect(stored(dbPath)).toEqual(upgraded);
  }, 120_000);
});

