import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES, ALL_SCOPE, createEntitlements, LAN_MULTI_TILL_FEATURE, MODULE_CATALOG } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import { createBackend, type BackendHandle } from "./create-backend.js";

const ARABIC = /[؀-ۿ]/;
const TODAY = new Date().toISOString().slice(0, 10);
const BOOT_TIMEOUT_MS = 240_000;
const ALEX_DRAWER = "TR-DEMO-CASH-ALEX";
const MAIN_CASH_LEDGER = "1300-1";
const HEAD_OFFICE_FIELDS = { glAccountId: "1310", currency: "USD", type: "bank", openingBalance: "999.00", status: "inactive" } as const;

interface Res {
  readonly status: number;
  readonly body: any;
}
type Caller = (method: string, path: string, body?: unknown) => Promise<Res>;

let handle: BackendHandle;
let sqlite: ReturnType<typeof openSqliteConnection>["sqlite"];
let admin: Caller;
let alex: Caller;
let bothBranches: Caller;

function callerFor(token: string): Caller {
  return async (method, path, body) => {
    const res = await handle.app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    try {
      return { status: res.status, body: text ? JSON.parse(text) : null };
    } catch {
      return { status: res.status, body: text };
    }
  };
}

const one = <T = any>(sql: string, ...params: unknown[]) => sqlite.prepare(sql).get(...params) as T | undefined;
const accountRow = (id: string) => JSON.stringify(one("SELECT * FROM treasury_account WHERE id = ?", id));
const accountCount = () => one<{ n: number }>("SELECT count(*) AS n FROM treasury_account")!.n;
const journalLines = (id: string) => one<{ n: number }>("SELECT count(*) AS n FROM journal_line WHERE entry_id = ?", id)!.n;

const drawer = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  code: id,
  name: `درج ${id}`,
  type: "cash",
  currency: "EGP",
  branchId: "BR-MAIN",
  glAccountId: MAIN_CASH_LEDGER,
  ...overrides,
});

const voucher = (id: string, treasuryAccountId: string, voucherType: "other_expense" | "other_income", amount: string) => ({
  id,
  date: TODAY,
  memo: "سند اختبار رصيد الدرج",
  voucherType,
  amount,
  branchId: "BR-MAIN",
  paymentMethod: "cash",
  treasuryAccountId,
  counterpartyGlAccountId: voucherType === "other_expense" ? "5200" : "4900",
});

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-treasury-")), "books.db");
  const resolveEntitlements = () =>
    createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: { [LAN_MULTI_TILL_FEATURE]: true }, seats: 50, expiresAt: null });
  handle = await createBackend({ dbPath, seedDemoData: true, lan: { resolveEntitlements }, resolveEntitlements });
  sqlite = openSqliteConnection(dbPath).sqlite;
  admin = callerFor(handle.sessions.issue({ userId: "USER-ADMIN", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }));
  bothBranches = callerFor(handle.sessions.issue({ userId: "USER-TR-BOTH", permissions: [...ALL_PERMISSION_CODES], roleCode: null, branchScope: ["BR-MAIN", "BR-ALEX"], warehouseScope: ALL_SCOPE }));
  alex = callerFor(handle.sessions.issue({ userId: "USER-TR-ALEX", permissions: [...ALL_PERMISSION_CODES], roleCode: null, branchScope: ["BR-ALEX"], warehouseScope: ALL_SCOPE }));
}, BOOT_TIMEOUT_MS);

afterAll(() => {
  sqlite?.close();
  handle?.close();
});

describe("which ledger account a drawer posts to is head office's to decide", () => {
  it("a branch-restricted session cannot open a treasury account", async () => {
    const before = accountCount();
    const res = await alex("POST", "/treasury-accounts", drawer("TR-T-ALEX-NEW", { branchId: "BR-ALEX", glAccountId: "1310" }));
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("HEAD_OFFICE_CREATES_ONLY");
    expect(res.body?.message).toMatch(ARABIC);
    expect(accountCount()).toBe(before);
  });

  it.each(Object.entries(HEAD_OFFICE_FIELDS))("a branch-restricted session cannot change its drawer's %s", async (field, value) => {
    const before = accountRow(ALEX_DRAWER);
    const res = await alex("PATCH", `/treasury-accounts/${ALEX_DRAWER}`, { [field]: value });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body?.error).toBe("SHARED_FIELD_RESTRICTED");
    expect(res.body?.fields).toEqual([field]);
    expect(res.body?.message).toMatch(ARABIC);
    expect(accountRow(ALEX_DRAWER)).toBe(before);
  });

  it("a session holding two branches cannot move a drawer from one to the other", async () => {
    const before = accountRow(ALEX_DRAWER);
    const res = await bothBranches("PATCH", `/treasury-accounts/${ALEX_DRAWER}`, { branchId: "BR-MAIN" });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body?.error).toBe("SHARED_FIELD_RESTRICTED");
    expect(accountRow(ALEX_DRAWER)).toBe(before);
  });

  it("a branch-restricted session may still rename its own drawer", async () => {
    const res = await alex("PATCH", `/treasury-accounts/${ALEX_DRAWER}`, { name: "خزينة الإسكندرية — الدور الأرضي" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(one<{ name: string }>("SELECT name FROM treasury_account WHERE id = ?", ALEX_DRAWER)?.name).toBe("خزينة الإسكندرية — الدور الأرضي");
  });
});

describe("a treasury account is mapped only to a cash or bank ledger account", () => {
  it.each([
    ["an account that does not exist", "9999-NOPE"],
    ["a revenue account", "4100"],
    ["an asset that is not cash or bank", "1105"],
    ["a header account", "1300"],
  ])("refuses to open one on %s", async (_label, glAccountId) => {
    const before = accountCount();
    const res = await admin("POST", "/treasury-accounts", drawer("TR-T-BAD", { glAccountId }));
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body?.error).toBe("TREASURY_LEDGER_ACCOUNT_INVALID");
    expect(res.body?.message).toMatch(ARABIC);
    expect(accountCount()).toBe(before);
  });

  it("refuses an inactive ledger account", async () => {
    sqlite.prepare("UPDATE account SET status = 'inactive' WHERE id = '1340'").run();
    const res = await admin("POST", "/treasury-accounts", drawer("TR-T-INACTIVE", { glAccountId: "1340" }));
    sqlite.prepare("UPDATE account SET status = 'active' WHERE id = '1340'").run();
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(one("SELECT id FROM treasury_account WHERE id = 'TR-T-INACTIVE'")).toBeUndefined();
  });

  it("refuses a ledger account already mapped to a treasury account of another currency", async () => {
    const res = await admin("POST", "/treasury-accounts", drawer("TR-T-USD", { currency: "USD" }));
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body?.error).toBe("TREASURY_LEDGER_ACCOUNT_INVALID");
    expect(one("SELECT id FROM treasury_account WHERE id = 'TR-T-USD'")).toBeUndefined();
  });

  it("refuses the same on an edit and leaves the stored account as it was", async () => {
    const before = accountRow(ALEX_DRAWER);
    for (const glAccountId of ["9999-NOPE", "4100"]) {
      const res = await admin("PATCH", `/treasury-accounts/${ALEX_DRAWER}`, { glAccountId });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
    }
    const currency = await admin("PATCH", "/treasury-accounts/TR-DEMO-CASH", { currency: "USD" });
    expect(currency.status, JSON.stringify(currency.body)).toBe(422);
    expect(accountRow(ALEX_DRAWER)).toBe(before);
  });

  it("opens one on a cash ledger account", async () => {
    const res = await admin("POST", "/treasury-accounts", drawer("TR-T-GOOD"));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

describe("a drawer pays out only the cash it holds itself", () => {
  it("an empty drawer cannot pay from the cash of another drawer on the same ledger account", async () => {
    expect((await admin("POST", "/treasury-accounts", drawer("TR-T-EMPTY"))).status).toBe(201);
    const shared = one<{ net: number }>("SELECT sum(debit) - sum(credit) AS net FROM journal_line WHERE account_id = ?", MAIN_CASH_LEDGER)!.net;
    expect(shared, "the shared ledger account must hold more than the payment for this to prove anything").toBeGreaterThan(5_000_000_000);

    expect((await admin("POST", "/vouchers", voucher("TR-T-V-OUT", "TR-T-EMPTY", "other_expense", "5000.00"))).status).toBe(201);
    const confirm = await admin("POST", "/vouchers/TR-T-V-OUT/confirm", {});
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(422);
    expect(confirm.body?.error).toBe("CASH_BALANCE_NEGATIVE");
    expect(confirm.body?.message).toMatch(ARABIC);
    expect(one<{ status: string }>("SELECT status FROM voucher WHERE id = 'TR-T-V-OUT'")?.status).toBe("draft");
    expect(journalLines("TR-T-V-OUT")).toBe(0);
  });

  it("it pays out what it has itself received, and no more", async () => {
    expect((await admin("POST", "/vouchers", voucher("TR-T-V-IN", "TR-T-EMPTY", "other_income", "300.00"))).status).toBe(201);
    expect((await admin("POST", "/vouchers/TR-T-V-IN/confirm", {})).status).toBe(200);
    expect(one<{ t: string }>("SELECT treasury_account_id AS t FROM journal_line WHERE entry_id = 'TR-T-V-IN' AND account_id = ?", MAIN_CASH_LEDGER)?.t).toBe("TR-T-EMPTY");

    expect((await admin("POST", "/vouchers", voucher("TR-T-V-200", "TR-T-EMPTY", "other_expense", "200.00"))).status).toBe(201);
    expect((await admin("POST", "/vouchers/TR-T-V-200/confirm", {})).status).toBe(200);
    expect((await admin("POST", "/vouchers", voucher("TR-T-V-200B", "TR-T-EMPTY", "other_expense", "200.00"))).status).toBe(201);
    const over = await admin("POST", "/vouchers/TR-T-V-200B/confirm", {});
    expect(over.status, JSON.stringify(over.body)).toBe(422);
    expect(over.body?.error).toBe("CASH_BALANCE_NEGATIVE");
  });

  it("the drawer that holds the cash still pays from it", async () => {
    expect((await admin("POST", "/vouchers", voucher("TR-T-V-MAIN", "TR-DEMO-CASH", "other_expense", "100.00"))).status).toBe(201);
    const confirm = await admin("POST", "/vouchers/TR-T-V-MAIN/confirm", {});
    expect(confirm.status, JSON.stringify(confirm.body)).toBe(200);
  });

  it("a reversal hands the cash back to the drawer it left", async () => {
    const reversed = await admin("POST", "/vouchers/TR-T-V-200/reverse", { reversalId: "TR-T-V-200-R", date: TODAY });
    expect(reversed.status, JSON.stringify(reversed.body).slice(0, 200)).toBe(201);
    const again = await admin("POST", "/vouchers/TR-T-V-200B/confirm", {});
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  });
});
