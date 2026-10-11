import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES, ALL_SCOPE, createEntitlements, LAN_MULTI_TILL_FEATURE, MODULE_CATALOG, RecordErrorCode } from "@mezan/domain";
import { openSqliteConnection } from "@mezan/persistence";
import * as contracts from "@mezan/contracts";
import { createBackend, type BackendHandle } from "./create-backend.js";
import { sampleOf, type SampledSchema } from "./test-helpers/zod-sample.js";

/**
 * D111 — the branch grant is an authorization boundary. Every case drives the
 * real routes of a seeded backend as a NON-admin user who holds every
 * permission and one branch (BR-ALEX), against the other branch's (BR-MAIN)
 * stored rows, and reads the outcome back from SQLite.
 */
const MAIN = "BR-MAIN";
const ALEX = "BR-ALEX";
const MAIN_WAREHOUSE = "WH-MAIN";
const ALEX_WAREHOUSE = "WH-ALEX";
const UNATTRIBUTED = "__unattributed__";
const VIEW_UNATTRIBUTED = "accounting.reports.view_unattributed";
const ARABIC = /[؀-ۿ]/;
const TODAY = new Date().toISOString().slice(0, 10);
const BOOT_TIMEOUT_MS = 240_000;

interface Res {
  readonly status: number;
  readonly body: any;
}

type Caller = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<Res>;

let handle: BackendHandle;
let sqlite: ReturnType<typeof openSqliteConnection>["sqlite"];
let admin: Caller;
let alex: Caller;
let alexWithUnattributed: Caller;
let mainOnly: Caller;
let alexStar: Caller;
let bothBranches: Caller;
let bothBranchesWithUnattributed: Caller;

function callerFor(token: string): Caller {
  return async (method, path, body, headers = {}) => {
    const res = await handle.app.fetch(
      new Request(`http://local${path}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
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

function one<T = any>(sql: string, ...params: unknown[]): T | undefined {
  return sqlite.prepare(sql).get(...params) as T | undefined;
}

function all<T = any>(sql: string, ...params: unknown[]): T[] {
  return sqlite.prepare(sql).all(...params) as T[];
}

function rowsOf(body: any): any[] {
  if (Array.isArray(body)) return body;
  for (const key of ["items", "rows", "data", "entries", "events", "records", "list", "branches"]) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

function expectRefusedInArabic(res: Res) {
  expect([403, 404], `status ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toContain(res.status);
  expect(["NOT_FOUND", "BRANCH_OUT_OF_SCOPE"]).toContain(res.body?.error);
  expect(res.body?.message).toMatch(ARABIC);
  expect(JSON.stringify(res.body)).not.toContain(MAIN);
}

beforeAll(async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "mezan-d111-")), "books.db");
  const resolveEntitlements = () =>
    createEntitlements({ plan: "DEMO", activeModules: MODULE_CATALOG, features: { [LAN_MULTI_TILL_FEATURE]: true }, seats: 50, expiresAt: null });
  handle = await createBackend({ dbPath, seedDemoData: true, lan: { resolveEntitlements }, resolveEntitlements });
  sqlite = openSqliteConnection(dbPath).sqlite;
  const everythingButUnattributed = ALL_PERMISSION_CODES.filter((code) => code !== VIEW_UNATTRIBUTED);
  const session = (userId: string, permissions: readonly string[], branchScope: typeof ALL_SCOPE | string[]) =>
    callerFor(handle.sessions.issue({ userId, permissions, roleCode: null, branchScope, warehouseScope: ALL_SCOPE }));
  admin = session("USER-ADMIN", ["*"], ALL_SCOPE);
  alex = session("USER-D111-ALEX", everythingButUnattributed, [ALEX]);
  alexWithUnattributed = session("USER-D111-ALEX-U", [...everythingButUnattributed, VIEW_UNATTRIBUTED], [ALEX]);
  mainOnly = session("USER-D111-MAIN", everythingButUnattributed, [MAIN]);
  alexStar = session("USER-D111-ALEX-STAR", ["*"], [ALEX]);
  bothBranches = session("USER-D111-BOTH", everythingButUnattributed, [MAIN, ALEX]);
  bothBranchesWithUnattributed = session("USER-D111-BOTH-U", [...everythingButUnattributed, VIEW_UNATTRIBUTED], [MAIN, ALEX]);
}, BOOT_TIMEOUT_MS);

afterAll(() => {
  sqlite?.close();
  handle?.close();
});

const journal = (id: string, branchId: string | null) => ({
  id,
  date: TODAY,
  memo: "قيد اختبار حدود الفرع",
  source: "manual",
  lines: [
    { accountId: "5200", debit: "10.00", credit: "0", ...(branchId ? { branchId } : {}) },
    { accountId: "2190", debit: "0", credit: "10.00", ...(branchId ? { branchId } : {}) },
  ],
});

const salesInvoice = (id: string, branchId: string, warehouseId: string) => ({
  id,
  date: TODAY,
  dueDate: TODAY,
  customerId: "CUST-DEMO-2",
  customerNameAr: "مؤسسة النور للمقاولات",
  warehouseId,
  branchId,
  currency: "EGP",
  arAccountId: "1105",
  taxAccountId: "2200",
  lines: [
    {
      lineId: `${id}-L1`,
      itemId: "ITEM-DEMO-1",
      itemNameAr: "خدمة اختبار",
      isStock: false,
      qty: "1",
      unitPrice: "100",
      taxRatePercent: 14,
      revenueAccountId: "4100",
      cogsAccountId: "5100",
      inventoryAccountId: "1200",
    },
  ],
});

const purchaseInvoice = (id: string, branchId: string, warehouseId: string) => ({
  id,
  supplierId: "SUPP-DEMO-1",
  date: TODAY,
  branchId,
  warehouseId,
  currency: "EGP",
  lines: [{ itemId: "ITEM-DEMO-1", qty: "1", unitCost: "140", kind: "inventory", taxRatePercent: 14 }],
});

const voucher = (id: string, branchId: string, treasuryAccountId: string, treasuryGlAccountId: string) => ({
  id,
  date: TODAY,
  memo: "تحصيل اختبار حدود الفرع",
  voucherType: "customer_collection",
  amount: "25.00",
  branchId,
  paymentMethod: "cash",
  treasuryAccountId,
  treasuryGlAccountId,
  counterpartyGlAccountId: "1105",
  customerId: "CUST-DEMO-2",
});

describe("D111 round 1 · the GL register is cut to the granted branches", () => {
  it("lists no journal line of another branch, nor an unattributed one without the permission", async () => {
    const res = await alex("GET", "/gl/journal-entries?pageSize=200");
    expect(res.status).toBe(200);
    const lines = rowsOf(res.body).flatMap((entry: any) => entry.lines);
    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(lines.map((line: any) => line.branchId ?? null))).toEqual(new Set([ALEX]));
  });

  it("shows the unattributed lines once the session holds «غير مخصص», and still nothing of the other branch", async () => {
    const res = await alexWithUnattributed("GET", "/gl/journal-entries?pageSize=200");
    const branches = new Set(rowsOf(res.body).flatMap((entry: any) => entry.lines).map((line: any) => line.branchId ?? null));
    expect(branches.has(null)).toBe(true);
    expect(branches.has(MAIN)).toBe(false);
  });

  it("answers 404 for another branch's entry by id and by number, and 200 to its own branch", async () => {
    const foreign = one<{ id: string; entryNo: string }>(
      "SELECT e.id AS id, e.entry_no AS entryNo FROM journal_entry e JOIN journal_line l ON l.entry_id = e.id WHERE e.status = 'posted' AND e.entry_no IS NOT NULL GROUP BY e.id HAVING COUNT(*) = SUM(CASE WHEN l.branch_id = ? THEN 1 ELSE 0 END) LIMIT 1",
      MAIN,
    )!;
    expect((await alex("GET", `/gl/journal-entries/${encodeURIComponent(foreign.id)}`)).status).toBe(404);
    expect((await alex("GET", `/gl/journal-entries/${encodeURIComponent(foreign.entryNo)}`)).status).toBe(404);
    expect((await mainOnly("GET", `/gl/journal-entries/${encodeURIComponent(foreign.id)}`)).status).toBe(200);
  });

  it("answers 404 for an unattributed entry by id without the permission, 200 with it", async () => {
    const posted = await admin("POST", "/gl/journal-entries", journal("D111-JE-COMPANY", null));
    expect(posted.status).toBe(201);
    expect((await alex("GET", "/gl/journal-entries/D111-JE-COMPANY")).status).toBe(404);
    expect((await alexWithUnattributed("GET", "/gl/journal-entries/D111-JE-COMPANY")).status).toBe(200);
  });

  it("cuts an account's ledger to the caller's lines", async () => {
    const res = await alex("GET", "/gl/accounts/1105/ledger");
    expect(res.status).toBe(200);
    expect(res.body.lines.length).toBeGreaterThan(0);
    const entryIds = [...new Set<string>(res.body.lines.map((line: any) => line.entryId))];
    const foreign = all(
      `SELECT DISTINCT branch_id AS branchId FROM journal_line WHERE account_id = '1105' AND entry_id IN (${entryIds.map(() => "?").join(",")})`,
      ...entryIds,
    ).map((row) => row.branchId);
    expect(res.body.lines.every((line: any) => (line.branchId ?? ALEX) === ALEX)).toBe(true);
    expect(foreign).toContain(ALEX);
    const whole = await admin("GET", "/gl/accounts/1105/ledger");
    expect(whole.body.lines.length).toBeGreaterThan(res.body.lines.length);
  });
});

describe("D111 round 1 · a stored entry of another branch cannot be written", () => {
  const statusOf = (id: string) => one<{ status: string }>("SELECT status FROM journal_entry WHERE id = ?", id)?.status;

  it("refuses to reverse another branch's posted entry and leaves it posted", async () => {
    const posted = await admin("POST", "/gl/journal-entries", journal("D111-JE-MAIN", MAIN));
    expect(posted.status).toBe(201);
    const res = await alex("POST", "/gl/journal-entries/D111-JE-MAIN/reverse", {});
    expectRefusedInArabic(res);
    expect(statusOf("D111-JE-MAIN")).toBe("posted");
    expect(one("SELECT COUNT(*) AS n FROM journal_entry WHERE reverses_entry_id = ?", "D111-JE-MAIN")?.n ?? 0).toBe(0);
  });

  it("refuses to post, replace or delete another branch's draft", async () => {
    const draft = await admin("POST", "/gl/journal-entries/draft", journal("D111-JE-MAIN-DRAFT", MAIN));
    expect(draft.status).toBe(201);
    expectRefusedInArabic(await alex("POST", "/gl/journal-entries/D111-JE-MAIN-DRAFT/post", {}));
    expectRefusedInArabic(await alex("PUT", "/gl/journal-entries/D111-JE-MAIN-DRAFT", journal("D111-JE-MAIN-DRAFT", ALEX)));
    expectRefusedInArabic(await alex("DELETE", "/gl/journal-entries/D111-JE-MAIN-DRAFT"));
    expect(statusOf("D111-JE-MAIN-DRAFT")).toBe("draft");
    expect(all("SELECT branch_id AS b FROM journal_line WHERE entry_id = ?", "D111-JE-MAIN-DRAFT").every((row) => row.b === MAIN)).toBe(true);
  });

  it("refuses a write on an entry it holds only in part, with a 403 that names the reason", async () => {
    const mixed = {
      ...journal("D111-JE-MIXED", null),
      lines: [
        { accountId: "5200", debit: "10.00", credit: "0", branchId: ALEX },
        { accountId: "2190", debit: "0", credit: "10.00", branchId: MAIN },
      ],
    };
    expect((await admin("POST", "/gl/journal-entries", mixed)).status).toBe(201);
    const read = await alex("GET", "/gl/journal-entries/D111-JE-MIXED");
    expect(read.status).toBe(200);
    expect(read.body.lines.map((line: any) => line.branchId)).toEqual([ALEX]);
    const res = await alex("POST", "/gl/journal-entries/D111-JE-MIXED/reverse", {});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("BRANCH_OUT_OF_SCOPE");
    expect(res.body.message).toMatch(ARABIC);
    expect(statusOf("D111-JE-MIXED")).toBe("posted");
  });

  it("refuses to reverse an unattributed entry it may not read, and allows it once «غير مخصص» is held", async () => {
    expect((await admin("POST", "/gl/journal-entries", journal("D111-JE-COMPANY-2", null))).status).toBe(201);
    expectRefusedInArabic(await alex("POST", "/gl/journal-entries/D111-JE-COMPANY-2/reverse", {}));
    expect(statusOf("D111-JE-COMPANY-2")).toBe("posted");
    const allowed = await alexWithUnattributed("POST", "/gl/journal-entries/D111-JE-COMPANY-2/reverse", {});
    expect(allowed.status, JSON.stringify(allowed.body).slice(0, 200)).toBeLessThan(300);
  });

  it("lets the branch's own user reverse the branch's own entry", async () => {
    expect((await alex("POST", "/gl/journal-entries", journal("D111-JE-ALEX", ALEX))).status).toBe(201);
    const res = await alex("POST", "/gl/journal-entries/D111-JE-ALEX/reverse", {});
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBeLessThan(300);
  });
});

describe("D111 round 1 · a request body cannot smuggle another branch", () => {
  const exists = (table: string, id: string) => (one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, id)?.n ?? 0) > 0;

  it("refuses a document that names another branch at the top level", async () => {
    const res = await alex("POST", "/sales-invoices", salesInvoice("D111-SMUGGLE-1", MAIN, ALEX_WAREHOUSE));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("BRANCH_OUT_OF_SCOPE");
    expect(res.body.message).toMatch(ARABIC);
    expect(exists("sales_invoice", "D111-SMUGGLE-1")).toBe(false);
  });

  it("refuses one that names it only on a nested line", async () => {
    const body = { ...journal("D111-SMUGGLE-2", null), lines: [{ accountId: "5200", debit: "10.00", credit: "0", branchId: ALEX }, { accountId: "2190", debit: "0", credit: "10.00", branchId: MAIN }] };
    const res = await alex("POST", "/gl/journal-entries/draft", body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("BRANCH_OUT_OF_SCOPE");
    expect(exists("journal_entry", "D111-SMUGGLE-2")).toBe(false);
  });

  it("refuses one that reaches the branch through a warehouse of it", async () => {
    const res = await alex("POST", "/sales-invoices", salesInvoice("D111-SMUGGLE-3", ALEX, MAIN_WAREHOUSE));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("BRANCH_OUT_OF_SCOPE");
    expect(exists("sales_invoice", "D111-SMUGGLE-3")).toBe(false);
  });

  it("refuses the same body sent under a content type that is not JSON", async () => {
    const res = await alex("POST", "/sales-invoices", JSON.stringify(salesInvoice("D111-SMUGGLE-4", MAIN, ALEX_WAREHOUSE)), {
      "content-type": "text/plain",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("BRANCH_OUT_OF_SCOPE");
    expect(exists("sales_invoice", "D111-SMUGGLE-4")).toBe(false);
  });

  it("refuses a work order that would draw its materials from another branch's warehouse", async () => {
    const res = await alex("POST", "/manufacturing/work-orders", { id: "D111-WO-FOREIGN", sourceWarehouseId: MAIN_WAREHOUSE });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("BRANCH_OUT_OF_SCOPE");
    expect(exists("work_order", "D111-WO-FOREIGN")).toBe(false);
  });

  it("refuses a stock transfer whose destination is another branch's warehouse", async () => {
    const res = await alex("POST", "/inventory/stock-transfers/draft", {
      id: "D111-TRF-OUT",
      date: TODAY,
      lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: ALEX_WAREHOUSE, toWarehouseId: MAIN_WAREHOUSE, qty: "1" }],
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(403);
    expect(res.body.error).toBe("BRANCH_OUT_OF_SCOPE");
    expect(exists("stock_transfer_document", "D111-TRF-OUT")).toBe(false);
  });

  it("accepts the branch's own document", async () => {
    const res = await alex("POST", "/sales-invoices", salesInvoice("D111-OWN-INV", ALEX, ALEX_WAREHOUSE));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(201);
    const confirmed = await alex("POST", "/sales-invoices/D111-OWN-INV/confirm", {});
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 200)).toBe(200);
    expect(one("SELECT branch_id AS b FROM sales_invoice WHERE id = ?", "D111-OWN-INV")?.b).toBe(ALEX);
  });
});

describe("D111 round 1 · /branches/lookup and the unattributed permission", () => {
  it("offers a branch-granted session its own branches and nothing else", async () => {
    const res = await alex("GET", "/branches/lookup");
    expect(res.status).toBe(200);
    expect(res.body.branches.map((branch: any) => branch.id)).toEqual([ALEX]);
    expect(Object.keys(res.body.branches[0]).sort()).toEqual(["active", "id", "isMain", "name"]);
    expect(res.body.restricted).toBe(true);
    expect(res.body.unattributed).toBe(false);
  });

  it("reports the unattributed bucket as readable once the permission is held", async () => {
    const res = await alexWithUnattributed("GET", "/branches/lookup");
    expect(res.body.branches.map((branch: any) => branch.id)).toEqual([ALEX]);
    expect(res.body).toMatchObject({ restricted: true, unattributed: true });
  });

  it("offers every branch to an all-branches session, the main one first", async () => {
    const res = await admin("GET", "/branches/lookup");
    expect(res.body.branches.map((branch: any) => branch.id)).toEqual([MAIN, ALEX]);
    expect(res.body).toMatchObject({ restricted: false, unattributed: true });
  });

  it("refuses a caller with no session", async () => {
    const res = await handle.app.fetch(new Request("http://local/branches/lookup"));
    expect(res.status).toBe(401);
  });

  const netByAccount = async (caller: Caller, branchId: string) => {
    const res = await caller("GET", `/financial-reports/trial-balance?asOfDate=${TODAY}&branchId=${encodeURIComponent(branchId)}`);
    expect(res.status).toBe(200);
    return new Map<string, string>(
      rowsOf(res.body)
        .map((row: any) => [String(row.accountId), `${row.debit}|${row.credit}`] as const)
        .filter(([, net]) => !/^0(\.0+)?\|0(\.0+)?$/.test(net)),
    );
  };

  it("a branch-granted trial balance is the branch alone without the permission, the branch plus «غير مخصص» with it", async () => {
    const branchAlone = await netByAccount(admin, ALEX);
    const unattributedAlone = await netByAccount(admin, UNATTRIBUTED);
    expect(branchAlone.size).toBeGreaterThan(0);
    expect(unattributedAlone.size).toBeGreaterThan(0);

    expect(await netByAccount(alex, "")).toEqual(branchAlone);
    for (const outside of [UNATTRIBUTED, MAIN]) {
      const refused = await alex("GET", `/financial-reports/trial-balance?branchId=${outside}`);
      expect(refused.status, outside).toBe(403);
      expect(refused.body.error, outside).toBe("BRANCH_OUT_OF_SCOPE");
      expect(refused.body.message).toMatch(ARABIC);
    }

    expect(await netByAccount(alexWithUnattributed, UNATTRIBUTED)).toEqual(unattributedAlone);
    expect((await netByAccount(alexWithUnattributed, "")).size).toBeGreaterThan(branchAlone.size);
    expect((await alexWithUnattributed("GET", `/financial-reports/trial-balance?branchId=${MAIN}`)).status).toBe(403);
  });
});

interface StoredDocumentCase {
  readonly label: string;
  /** Raises the other branch's document, as the admin, when the seed holds none in the state the case needs. */
  readonly arrange?: () => Promise<Res>;
  readonly read: string;
  readonly writes: readonly (readonly [method: string, path: string, body?: unknown])[];
  /** A fingerprint of the stored row; unchanged after every refused write. */
  readonly state: () => unknown;
}

const row = (table: string, id: string, columns = "status") => () => one(`SELECT ${columns} FROM ${table} WHERE id = ?`, id);

const STORED_DOCUMENT_CASES: readonly StoredDocumentCase[] = [
  {
    label: "sales invoice (draft)",
    arrange: () => admin("POST", "/sales-invoices", salesInvoice("D111-MAIN-INV", MAIN, MAIN_WAREHOUSE)),
    read: "/sales-invoices/D111-MAIN-INV",
    writes: [
      ["POST", "/sales-invoices/D111-MAIN-INV/confirm", {}],
      ["POST", "/sales-invoices/D111-MAIN-INV/cancel", {}],
    ],
    state: row("sales_invoice", "D111-MAIN-INV", "status, journal_entry_id"),
  },
  {
    label: "sales invoice (confirmed)",
    read: "/sales-invoices/INV-DEMO-1",
    writes: [
      ["POST", "/sales-invoices/INV-DEMO-1/void", { reason: "اختبار" }],
      ["POST", "/sales-invoices/INV-DEMO-1/payments", { amount: "1.00", date: TODAY, treasuryAccountId: "TR-DEMO-CASH" }],
    ],
    state: row("sales_invoice", "INV-DEMO-1", "status, amount_paid, reversed_by_invoice_id"),
  },
  {
    label: "sales quote",
    read: "/sales-quotes/SQ-DEMO-4",
    writes: [
      ["POST", "/sales-quotes/SQ-DEMO-4/send", {}],
      ["POST", "/sales-quotes/SQ-DEMO-4/accept", {}],
      ["POST", "/sales-quotes/SQ-DEMO-4/reject", {}],
      ["POST", "/sales-quotes/SQ-DEMO-4/cancel", {}],
      ["POST", "/sales-quotes/SQ-DEMO-4/convert-to-invoice", { id: "D111-FROM-QUOTE" }],
    ],
    state: row("sales_quote", "SQ-DEMO-4", "status, converted_invoice_id"),
  },
  {
    label: "sales return",
    read: "/sales-returns/SRT-DEMO-2",
    writes: [
      ["POST", "/sales-returns/SRT-DEMO-2/confirm", {}],
      ["POST", "/sales-returns/SRT-DEMO-2/cancel", {}],
      ["POST", "/sales-returns/SRT-DEMO-1/refund", { treasuryAccountId: "TR-DEMO-CASH" }],
    ],
    state: () => all("SELECT id, status, journal_entry_id FROM framework_document WHERE id IN ('SRT-DEMO-1','SRT-DEMO-2') ORDER BY id"),
  },
  {
    label: "purchase order",
    read: "/purchases/orders/PO-DEMO-1",
    writes: [
      ["POST", "/purchases/orders/PO-DEMO-1/confirm", {}],
      ["POST", "/purchases/orders/PO-DEMO-1/cancel", {}],
    ],
    state: row("purchase_order", "PO-DEMO-1"),
  },
  {
    label: "goods receipt",
    read: "/purchases/receipts/GRN-DEMO-3",
    writes: [
      ["POST", "/purchases/receipts/GRN-DEMO-3/confirm", {}],
      ["POST", "/purchases/receipts/GRN-DEMO-3/cancel", {}],
    ],
    state: row("goods_receipt", "GRN-DEMO-3"),
  },
  {
    label: "purchase invoice (draft)",
    arrange: () => admin("POST", "/purchases/invoices", purchaseInvoice("D111-MAIN-PI", MAIN, MAIN_WAREHOUSE)),
    read: "/purchases/invoices/D111-MAIN-PI",
    writes: [
      ["POST", "/purchases/invoices/D111-MAIN-PI/confirm", {}],
      ["POST", "/purchases/invoices/D111-MAIN-PI/cancel", {}],
      ["POST", "/purchases/invoices/D111-MAIN-PI/payments", { amount: "1.00", date: TODAY, treasuryAccountId: "TR-DEMO-CASH" }],
    ],
    state: row("purchase_invoice", "D111-MAIN-PI"),
  },
  {
    label: "purchase invoice fulfilment",
    read: "/purchases/invoices/PI-DEMO-1/fulfilment",
    writes: [],
    state: row("purchase_invoice", "PI-DEMO-1"),
  },
  {
    label: "purchase return",
    read: "/purchase-returns/PRT-DEMO-2",
    writes: [
      ["POST", "/purchase-returns/PRT-DEMO-2/confirm", {}],
      ["POST", "/purchase-returns/PRT-DEMO-2/cancel", {}],
    ],
    state: row("framework_document", "PRT-DEMO-2", "status, journal_entry_id"),
  },
  {
    label: "landed cost",
    read: "/landed-costs/LC-DEMO-2",
    writes: [
      ["POST", "/landed-costs/LC-DEMO-2/confirm", {}],
      ["POST", "/landed-costs/LC-DEMO-2/cancel", {}],
    ],
    state: row("framework_document", "LC-DEMO-2", "status, journal_entry_id"),
  },
  {
    label: "treasury voucher (draft)",
    arrange: () => admin("POST", "/vouchers", voucher("D111-MAIN-VCH", MAIN, "TR-DEMO-CASH", "1300-1")),
    read: "/vouchers/D111-MAIN-VCH",
    writes: [
      ["POST", "/vouchers/D111-MAIN-VCH/confirm", {}],
      ["POST", "/vouchers/D111-MAIN-VCH/cancel", {}],
      ["POST", "/vouchers/D111-MAIN-VCH/reverse", {}],
      ["POST", "/vouchers/D111-MAIN-VCH/allocations", { allocations: [] }],
    ],
    state: row("voucher", "D111-MAIN-VCH", "status, journal_entry_id, reversed_by_doc_id"),
  },
  {
    label: "treasury voucher allocations",
    read: "/vouchers/D111-MAIN-VCH/allocations",
    writes: [],
    state: row("voucher", "D111-MAIN-VCH"),
  },
  {
    label: "cheque",
    read: "/cheques/CHQ-DEMO-1",
    writes: [
      ["POST", "/cheques/CHQ-DEMO-1/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK" }],
      ["POST", "/cheques/CHQ-DEMO-1/collect", {}],
      ["POST", "/cheques/CHQ-DEMO-1/bounce", {}],
      ["POST", "/cheques/CHQ-DEMO-1/replace", { id: "D111-CHQ-REPLACEMENT", chequeNumber: "D111-1", dueDate: TODAY, issueDate: TODAY }],
      ["POST", "/cheques/CHQ-DEMO-1/allocations", { allocations: [] }],
    ],
    state: row("cheque", "CHQ-DEMO-1", "status, replaced_by_cheque_id"),
  },
  {
    label: "cheque allocations",
    read: "/cheques/CHQ-DEMO-1/allocations",
    writes: [],
    state: row("cheque", "CHQ-DEMO-1"),
  },
  {
    label: "work order",
    read: "/manufacturing/work-orders/WO-DEMO-1",
    writes: [
      ["POST", "/manufacturing/work-orders/WO-DEMO-1/start", {}],
      ["POST", "/manufacturing/work-orders/WO-DEMO-1/cancel", {}],
    ],
    state: row("work_order", "WO-DEMO-1"),
  },
  {
    label: "stock adjustment",
    arrange: () =>
      admin("POST", "/inventory/stock-adjustments/draft", {
        id: "D111-MAIN-ADJ",
        date: TODAY,
        lines: [{ itemId: "ITEM-DEMO-1", warehouseId: MAIN_WAREHOUSE, reason: "OTHER", direction: "IN", qty: "1", unitCost: "140" }],
      }),
    read: "/inventory/stock-adjustments/D111-MAIN-ADJ",
    writes: [["POST", "/inventory/stock-adjustments/D111-MAIN-ADJ/confirm", {}]],
    state: row("stock_adjustment_document", "D111-MAIN-ADJ", "status, journal_entry_id"),
  },
  {
    label: "stock transfer",
    read: "/inventory/stock-transfers/TRF-DEMO-3",
    writes: [["POST", "/inventory/stock-transfers/TRF-DEMO-3/confirm", {}]],
    state: row("stock_transfer_document", "TRF-DEMO-3"),
  },
  {
    label: "physical count",
    read: "/inventory/physical-counts/PC-DEMO-3",
    writes: [
      ["POST", "/inventory/physical-counts/PC-DEMO-3/counts", { counts: [] }],
      ["POST", "/inventory/physical-counts/PC-DEMO-3/complete", {}],
      ["POST", "/inventory/physical-counts/PC-DEMO-3/cancel", {}],
      ["POST", "/inventory/physical-counts/PC-DEMO-3/generate-adjustment", {}],
    ],
    state: row("physical_count", "PC-DEMO-3", "status, lines_json, generated_adjustment_id"),
  },
];

describe("D111 · an id-addressed route checks the stored document's branch, not only the list", () => {
  for (const testCase of STORED_DOCUMENT_CASES) {
    it(`${testCase.label}: another branch's document is absent by id and refuses every action`, async () => {
      if (testCase.arrange) {
        const arranged = await testCase.arrange();
        expect([200, 201, 409], `arrange ${arranged.status} ${JSON.stringify(arranged.body).slice(0, 300)}`).toContain(arranged.status);
      }
      const before = testCase.state();
      expect(before, "the case's document must exist in the seeded books").toBeTruthy();

      const own = await mainOnly("GET", testCase.read);
      expect(own.status, `the branch's own user must be able to read it — ${JSON.stringify(own.body).slice(0, 200)}`).toBe(200);

      const read = await alex("GET", testCase.read);
      expect(read.status, JSON.stringify(read.body).slice(0, 200)).toBe(404);
      expect(JSON.stringify(read.body)).not.toContain(MAIN);

      for (const [method, path, body] of testCase.writes) {
        const res = await alex(method, path, body);
        expect([403, 404], `${method} ${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toContain(res.status);
        expectRefusedInArabic(res);
        expect(testCase.state(), `${method} ${path} must leave the stored row untouched`).toEqual(before);
      }
    });
  }

  it("fixed asset and depreciation run: another branch's are absent by id and refuse every action", async () => {
    const assetState = row("asset", "ASSET-DEMO-2", "status, internal_hourly_rate");
    const before = assetState();
    expect((await mainOnly("GET", "/assets/ASSET-DEMO-2")).status).toBe(200);
    expect((await alex("GET", "/assets/ASSET-DEMO-2")).status).toBe(404);
    expectRefusedInArabic(await alex("PATCH", "/assets/ASSET-DEMO-2/internal-hourly-rate", { internalHourlyRate: "1.00", effectiveFrom: TODAY }));
    expectRefusedInArabic(await alex("POST", "/assets/ASSET-DEMO-2/dispose", { date: TODAY, proceeds: "0" }));
    expect(assetState()).toEqual(before);

    const draft = one<{ id: string }>("SELECT id FROM depreciation_run WHERE branch_id = ? AND status = 'draft' LIMIT 1", MAIN)!;
    const posted = one<{ id: string }>("SELECT id FROM depreciation_run WHERE branch_id = ? AND status = 'posted' LIMIT 1", MAIN)!;
    expect((await alex("GET", `/assets/depreciation/runs/${draft.id}`)).status).toBe(404);
    expectRefusedInArabic(await alex("POST", `/assets/depreciation/runs/${draft.id}/post`, {}));
    expectRefusedInArabic(await alex("POST", `/assets/depreciation/runs/${posted.id}/reverse`, {}));
    expect(all("SELECT id, status FROM depreciation_run WHERE id IN (?, ?) ORDER BY id", draft.id, posted.id).map((r) => r.status).sort()).toEqual(["draft", "posted"]);
  });

  it("allocation: another branch's voucher allocation cannot be reversed by id", async () => {
    const allocation = one<{ id: string }>(
      "SELECT a.id AS id FROM voucher_allocation a JOIN voucher v ON v.id = a.voucher_id WHERE a.status = 'active' AND v.branch_id = ? LIMIT 1",
      MAIN,
    )!;
    expectRefusedInArabic(await alex("POST", `/allocations/${encodeURIComponent(allocation.id)}/reverse`, {}));
    expect(one("SELECT status FROM voucher_allocation WHERE id = ?", allocation.id)?.status).toBe("active");
  });

  it("the same actions pass for the branch's own user (the guard is the branch, not the route)", async () => {
    const confirm = await mainOnly("POST", "/sales-invoices/D111-MAIN-INV/confirm", {});
    expect(confirm.status, JSON.stringify(confirm.body).slice(0, 200)).toBe(200);
    const order = await mainOnly("POST", "/purchases/orders/PO-DEMO-1/confirm", {});
    expect(order.status, JSON.stringify(order.body).slice(0, 200)).toBe(200);
    const voucherConfirm = await mainOnly("POST", "/vouchers/D111-MAIN-VCH/confirm", {});
    expect(voucherConfirm.status, JSON.stringify(voucherConfirm.body).slice(0, 200)).toBe(200);
  });

  it("a stock, receipt or landed-cost list shows nothing drawn from another branch's warehouses", async () => {
    const lists: readonly (readonly [path: string, foreignId: string])[] = [
      ["/inventory/stock-adjustments", "D111-MAIN-ADJ"],
      ["/inventory/stock-transfers", "TRF-DEMO-3"],
      ["/inventory/physical-counts", "PC-DEMO-3"],
      ["/landed-costs", "LC-DEMO-2"],
      ["/purchases/receipts", "GRN-DEMO-3"],
    ];
    for (const [path, foreignId] of lists) {
      const mine = await alex("GET", `${path}?pageSize=200`);
      expect(mine.status, path).toBe(200);
      expect(rowsOf(mine.body).map((entry: any) => entry.id), path).not.toContain(foreignId);
      const theirs = await mainOnly("GET", `${path}?pageSize=200`);
      expect(rowsOf(theirs.body).map((entry: any) => entry.id), `${path} must list it to the branch's own user`).toContain(foreignId);
    }
    const outbound = await admin("POST", "/inventory/stock-transfers/draft", {
      id: "D111-TRF-OUT-BY-HQ",
      date: TODAY,
      lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: ALEX_WAREHOUSE, toWarehouseId: MAIN_WAREHOUSE, qty: "1" }],
    });
    expect(outbound.status).toBe(201);
    const transfers = rowsOf((await alex("GET", "/inventory/stock-transfers?pageSize=200")).body).map((entry: any) => entry.id);
    expect(transfers).toContain("D111-TRF-OUT-BY-HQ");
  });

  it("received-not-invoiced (GRNI): naming another branch's warehouse returns none of its receipts, counts or value", async () => {
    const query = `invoiced=false&warehouseId=${MAIN_WAREHOUSE}`;
    const theirs = await mainOnly("GET", `/purchases/receipts/stats?${query}`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.count).toBeGreaterThan(0);

    const rows = await alex("GET", `/purchases/receipts?${query}`);
    expect(rows.status).toBe(200);
    expect(rowsOf(rows.body)).toEqual([]);
    const stats = await alex("GET", `/purchases/receipts/stats?${query}`);
    expect(stats.body).toMatchObject({ count: 0, confirmed: 0, uninvoiced: 0 });
    expect(Number(stats.body.value)).toBe(0);
    const counts = await alex("GET", `/purchases/receipts/counts?${query}`);
    expect(Object.values(counts.body as Record<string, number>).every((n) => n === 0)).toBe(true);

    const unfiltered = await alex("GET", "/purchases/receipts/stats?invoiced=false");
    expect(unfiltered.body.count).toBe(0);
  });

  it("a transfer is confirmed by the branch stock leaves, never by the one it arrives in", async () => {
    const inbound = await admin("POST", "/inventory/stock-transfers/draft", {
      id: "D111-TRF-IN",
      date: TODAY,
      lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: MAIN_WAREHOUSE, toWarehouseId: ALEX_WAREHOUSE, qty: "1" }],
    });
    expect(inbound.status).toBe(201);
    expect((await alex("GET", "/inventory/stock-transfers/D111-TRF-IN")).status).toBe(200);
    expectRefusedInArabic(await alex("POST", "/inventory/stock-transfers/D111-TRF-IN/confirm", {}));
    expect(one("SELECT status FROM stock_transfer_document WHERE id = ?", "D111-TRF-IN")?.status).toBe("draft");
  });
});

describe("D111 · what hangs off a document is no more readable than the document", () => {
  const attachmentOf = (entityType: string) =>
    one<{ id: string; entityId: string }>("SELECT id, entity_id AS entityId FROM attachment WHERE entity_type = ? LIMIT 1", entityType)!;

  it("attachments of another branch's documents are absent by id, by content, in the list, and cannot be added or deleted", async () => {
    for (const entityType of ["sales-invoice", "sales-quote", "sales-return", "purchase-order"]) {
      const attachment = attachmentOf(entityType);
      expect((await mainOnly("GET", `/attachments/${attachment.id}`)).status, entityType).toBe(200);
      expect((await mainOnly("GET", `/attachments/${attachment.id}/content`)).body.contentBase64, entityType).toBeTruthy();

      const meta = await alex("GET", `/attachments/${attachment.id}`);
      expect(meta.status, entityType).toBe(404);
      const content = await alex("GET", `/attachments/${attachment.id}/content`);
      expect(content.status, entityType).toBe(404);
      expect(content.body.contentBase64).toBeUndefined();
      expect(rowsOf((await alex("GET", `/attachments?entityType=${entityType}&entityId=${attachment.entityId}`)).body)).toEqual([]);
      expect(rowsOf((await alex("GET", `/attachments?entityType=${entityType}`)).body).map((r: any) => r.id)).not.toContain(attachment.id);
      expect(rowsOf((await alex("GET", "/attachments")).body).map((r: any) => r.id)).not.toContain(attachment.id);

      expectRefusedInArabic(await alex("DELETE", `/attachments/${attachment.id}`));
      expectRefusedInArabic(
        await alex("POST", "/attachments", {
          id: `D111-ATT-${entityType}`,
          entityType,
          entityId: attachment.entityId,
          fileName: "probe.txt",
          mimeType: "text/plain",
          contentBase64: Buffer.from("probe").toString("base64"),
        }),
      );
      expect(one("SELECT COUNT(*) AS n FROM attachment WHERE id IN (?, ?)", attachment.id, `D111-ATT-${entityType}`)?.n).toBe(1);
    }
  });

  it("the audit log shows a branch-granted reader only rows stamped with its branches, whatever it asks for", async () => {
    const stamped = (branchId: string) => one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_event WHERE branch_id = ?", branchId)!.n;
    expect(stamped(ALEX)).toBeGreaterThan(0);
    expect(stamped(MAIN)).toBeGreaterThan(0);

    const mine = await alex("GET", "/audit?limit=200");
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(stamped(ALEX));
    expect(new Set(mine.body.events.map((event: any) => event.branchId))).toEqual(new Set([ALEX]));

    const asked = await alex("GET", `/audit?limit=200&branchId=${MAIN}`);
    expect(asked.status).toBe(403);
    expect(asked.body.error).toBe("BRANCH_OUT_OF_SCOPE");
    expect(asked.body.events).toBeUndefined();
    const byEntity = await alex("GET", "/audit?limit=200&entityId=INV-DEMO-1");
    expect(byEntity.body).toMatchObject({ events: [], total: 0 });

    const whole = await admin("GET", "/audit?limit=1");
    expect(whole.body.total).toBe(one<{ n: number }>("SELECT COUNT(*) AS n FROM audit_event")!.n);
  });

  it("the company-wide control reports over the audit trail are refused to a branch-granted reader", async () => {
    for (const report of ["exceptions", "post-posting-changes", "after-hours", "new-accounts", "sod"]) {
      const res = await alex("GET", `/security-reports/${report}`);
      expect(res.status, report).toBe(403);
      expect(res.body.error, report).toBe("COMPANY_WIDE_REPORT");
      expect(res.body.message).toMatch(ARABIC);
      expect((await admin("GET", `/security-reports/${report}`)).status, report).toBe(200);
    }
  });

  it("attachments of master data and of the branch's own documents stay readable", async () => {
    const item = attachmentOf("item");
    expect((await alex("GET", `/attachments/${item.id}`)).status).toBe(200);
    const own = await alex("POST", "/attachments", {
      id: "D111-ATT-OWN",
      entityType: "sales-invoice",
      entityId: "INV-DEMO-ALEX-1",
      fileName: "own.txt",
      mimeType: "text/plain",
      contentBase64: Buffer.from("own").toString("base64"),
    });
    expect(own.status, JSON.stringify(own.body).slice(0, 200)).toBe(201);
    expect((await alex("GET", "/attachments/D111-ATT-OWN/content")).status).toBe(200);
    expect((await mainOnly("GET", "/attachments/D111-ATT-OWN/content")).status).toBe(404);
  });
});

describe("D111 · a branch-filtered statement says when its balance includes unattributed postings", () => {
  const PERIOD = `periodFrom=2020-01-01&periodTo=${TODAY}`;
  const unattributedNet = (accountId: string) =>
    one<{ net: number; n: number }>(
      "SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net, COUNT(*) AS n FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id WHERE l.account_id = ? AND l.branch_id IS NULL AND e.status IN ('posted', 'reversed') AND e.date <= ?",
      accountId,
      TODAY,
    )!;
  const scaled = (money: string) => BigInt(money.replace(".", ""));

  it("account ledger: names the unattributed amount inside a branch-granted balance, exactly", async () => {
    const accountId = one<{ id: string }>(
      "SELECT l.account_id AS id FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id WHERE l.branch_id IS NULL AND e.status = 'posted' AND l.account_id IN (SELECT account_id FROM journal_line WHERE branch_id = ?) GROUP BY l.account_id HAVING SUM(l.debit - l.credit) <> 0 LIMIT 1",
      ALEX,
    )!.id;
    const expected = unattributedNet(accountId);
    expect(expected.n).toBeGreaterThan(0);

    const res = await alexWithUnattributed("GET", `/financial-reports/account-ledger?accountId=${accountId}&${PERIOD}`);
    expect(res.status).toBe(200);
    expect(res.body.branchCaveat).toMatchObject({ code: "INCLUDES_UNATTRIBUTED" });
    expect(res.body.branchCaveat.message).toMatch(ARABIC);
    expect(scaled(res.body.branchCaveat.unattributedNet)).toBe(BigInt(expected.net));

    const withoutPermission = await alex("GET", `/financial-reports/account-ledger?accountId=${accountId}&${PERIOD}`);
    expect(withoutPermission.body.branchCaveat).toBeNull();
    const oneBranch = await alexWithUnattributed("GET", `/financial-reports/account-ledger?accountId=${accountId}&${PERIOD}&branchId=${ALEX}`);
    expect(oneBranch.body.branchCaveat).toBeNull();
    const wholeCompany = await admin("GET", `/financial-reports/account-ledger?accountId=${accountId}&${PERIOD}`);
    expect(wholeCompany.body.branchCaveat).toBeNull();
    const narrowedInShell = await admin("GET", `/financial-reports/account-ledger?accountId=${accountId}&${PERIOD}`, undefined, { "x-branch-scope": ALEX });
    expect(narrowedInShell.body.branchCaveat).toMatchObject({ code: "INCLUDES_UNATTRIBUTED" });
  });

  for (const [kind, listPath] of [["customers", "/customers"], ["suppliers", "/suppliers"]] as const) {
    it(`${kind} statement: a branch-filtered view names the unattributed opening and journal items it carries`, async () => {
      const inMain = { "x-branch-scope": MAIN };
      const control = kind === "customers" ? { accountId: "1105", partyId: "CUST-DEMO-1" } : { accountId: "2100", partyId: "SUPP-DEMO-1" };
      const posted = await admin("POST", "/gl/journal-entries", {
        id: `D111-JE-PARTY-${kind}`,
        date: TODAY,
        memo: "تسوية على حساب الطرف بلا فرع",
        source: "manual",
        lines: [
          { accountId: control.accountId, debit: "50.00", credit: "0", partyId: control.partyId },
          { accountId: "2190", debit: "0", credit: "50.00" },
        ],
      });
      expect(posted.status, JSON.stringify(posted.body).slice(0, 300)).toBe(201);
      let found: { id: string; net: bigint } | null = null;
      for (const party of rowsOf((await admin("GET", `${listPath}?pageSize=200`)).body)) {
        const statement = await admin("GET", `/reports/statements/${kind}/${party.id}`, undefined, inMain);
        if (statement.status !== 200) continue;
        const loose = statement.body.lines.filter((line: any) => ["opening", "journal", "imported"].includes(line.kind));
        if (loose.length === 0) continue;
        found = { id: party.id, net: loose.reduce((net: bigint, line: any) => net + scaled(line.increase) - scaled(line.decrease), 0n) };
        expect(statement.body.branchCaveat).toMatchObject({ code: "INCLUDES_UNATTRIBUTED" });
        expect(statement.body.branchCaveat.message).toMatch(ARABIC);
        expect(scaled(statement.body.branchCaveat.unattributedNet)).toBe(found.net);
        break;
      }
      expect(found, `the seed must hold a ${kind} party with an opening balance, or this proves nothing`).not.toBeNull();
      const whole = await admin("GET", `/reports/statements/${kind}/${found!.id}`);
      expect(whole.status).toBe(200);
      expect(whole.body.branchCaveat).toBeNull();
    });
  }
});

describe("D111 round 2 · the grant holds on every family, for a non-admin and for a `*` admin with a narrow grant", () => {
  const restricted = (): readonly (readonly [label: string, caller: Caller])[] => [
    ["non-admin", alex],
    ["* admin granted one branch", alexStar],
  ];
  const fingerprint = (sql: string, ...params: unknown[]) => JSON.stringify(all(sql, ...params));
  const scaled = (money: string) => BigInt(money.replace(".", ""));
  const exists = (table: string, id: string) => (one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, id)?.n ?? 0) > 0;

  it("finding 1 · a warehouse or treasury account of another branch cannot be read by id or captured, and one's own cannot be moved out", async () => {
    const state = () => fingerprint("SELECT id, branch_id FROM warehouse UNION ALL SELECT id, branch_id FROM treasury_account ORDER BY 1");
    const before = state();
    for (const [label, caller] of restricted()) {
      expectRefusedInArabic(await caller("PUT", `/warehouses/${MAIN_WAREHOUSE}`, { branchId: ALEX }));
      expectRefusedInArabic(await caller("PATCH", "/treasury-accounts/TR-DEMO-CASH", { branchId: ALEX }));
      expect((await caller("GET", `/warehouses/${MAIN_WAREHOUSE}`)).status, label).toBe(404);
      expect((await caller("GET", "/treasury-accounts/TR-DEMO-CASH")).status, label).toBe(404);
      const movedOut = await caller("PUT", `/warehouses/${ALEX_WAREHOUSE}`, { branchId: MAIN });
      expect(movedOut.status, label).toBe(403);
      expect(movedOut.body.error).toBe("BRANCH_OUT_OF_SCOPE");
      expect((await caller("PATCH", "/treasury-accounts/TR-DEMO-CASH-ALEX", { branchId: MAIN })).status, label).toBe(403);
      expect(state(), label).toBe(before);
    }
    expect((await mainOnly("GET", `/warehouses/${MAIN_WAREHOUSE}`)).status).toBe(200);
  });

  it("finding 2 · another branch's payroll run cannot be approved or disbursed, and no money leaves its bank", async () => {
    const state = () =>
      fingerprint("SELECT id, status, disbursement_voucher_id FROM hr_payroll_run ORDER BY id") +
      fingerprint("SELECT COUNT(*) AS n FROM voucher") +
      fingerprint("SELECT COUNT(*) AS n FROM journal_entry");
    const before = state();
    for (const [label, caller] of restricted()) {
      for (const run of ["PR-DEMO-2", "PR-DEMO-3"]) {
        for (const action of ["approve", "disburse", "calculate", "cancel"]) {
          expectRefusedInArabic(await caller("POST", `/hr/payroll/runs/${run}/${action}`, { treasuryAccountId: "TR-DEMO-BANK" }));
        }
        expect((await caller("GET", `/hr/payroll/runs/${run}`)).status, label).toBe(404);
      }
      expect(state(), label).toBe(before);
    }
  });

  it("finding 3 · a voucher cannot be paid out of another branch's drawer, nor out of a drawer that is not the document's branch", async () => {
    const drawer = () => fingerprint("SELECT COUNT(*) AS n FROM voucher WHERE treasury_account_id = 'TR-DEMO-CASH'") + fingerprint("SELECT COUNT(*) AS n FROM journal_entry");
    const before = drawer();
    for (const [label, caller] of restricted()) {
      const res = await caller("POST", "/vouchers", voucher(`D111-R2-V-${label.length}`, ALEX, "TR-DEMO-CASH", "1300-1"));
      expect(res.status, label).toBe(403);
      expect(res.body.message).toMatch(ARABIC);
      expect(exists("voucher", `D111-R2-V-${label.length}`)).toBe(false);
    }
    const mismatched = await bothBranches("POST", "/vouchers", voucher("D111-R2-V-MISMATCH", ALEX, "TR-DEMO-CASH", "1300-1"));
    expect(mismatched.status).toBe(403);
    expect(mismatched.body.error).toBe("TREASURY_BRANCH_MISMATCH");
    expect(mismatched.body.message).toMatch(ARABIC);
    expect(exists("voucher", "D111-R2-V-MISMATCH")).toBe(false);

    expect(drawer()).toBe(before);

    const sameBranch = await admin("POST", "/vouchers", voucher("D111-R2-V-ADMIN-OK", ALEX, "TR-DEMO-CASH-ALEX", "1300-1"));
    expect(sameBranch.status, JSON.stringify(sameBranch.body).slice(0, 200)).toBe(201);
  });

  it("finding 4 · the legacy inventory routes move and show nothing of another branch", async () => {
    const stock = () => fingerprint("SELECT COUNT(*) AS n, COALESCE(SUM(CAST(qty AS REAL)), 0) AS q FROM stock_movement WHERE warehouse_id = ?", MAIN_WAREHOUSE);
    const before = stock();
    for (const [label, caller] of restricted()) {
      const moved = await caller("POST", "/inventory/transfers", {
        transferId: `D111-R2-LEGACY-${label.length}`,
        fromWarehouseId: MAIN_WAREHOUSE,
        toWarehouseId: ALEX_WAREHOUSE,
        occurredAt: TODAY,
        lines: [{ itemId: "ITEM-DEMO-1", qty: "1" }],
      });
      expect(moved.status, label).toBe(403);
      const adjusted = await caller("POST", "/inventory/adjustments", {
        adjustmentId: `D111-R2-LEGACY-ADJ-${label.length}`,
        warehouseId: MAIN_WAREHOUSE,
        occurredAt: TODAY,
        reason: "DAMAGE",
        lines: [{ itemId: "ITEM-DEMO-1", direction: "OUT", qty: "1" }],
      });
      expect(adjusted.status, label).toBe(403);
      expect(stock(), label).toBe(before);

      for (const path of ["/inventory/adjustments", "/inventory/transfers", "/inventory/stock-balance", "/inventory/valuation"]) {
        const res = await caller("GET", path);
        expect(res.status, `${label} ${path}`).toBe(200);
        const text = JSON.stringify(res.body);
        expect(text, `${label} ${path}`).not.toContain(MAIN_WAREHOUSE);
        expect(text, `${label} ${path}`).not.toContain(MAIN);
      }
      for (const path of ["/inventory/movements", "/inventory/availability", "/inventory/balance", "/inventory/stock-balance"]) {
        const asked = await caller("GET", `${path}?itemId=ITEM-DEMO-1&warehouseId=${MAIN_WAREHOUSE}`);
        expect(asked.status, `${label} ${path}`).toBe(403);
        expect(asked.body.message).toMatch(ARABIC);
      }
      const foreignAdjustment = rowsOf((await admin("GET", "/inventory/adjustments")).body).find((row: any) => row.warehouseId === MAIN_WAREHOUSE);
      const foreignTransfer = rowsOf((await admin("GET", "/inventory/transfers")).body).find(
        (row: any) => row.fromWarehouseId !== ALEX_WAREHOUSE && row.toWarehouseId !== ALEX_WAREHOUSE,
      );
      expect(foreignAdjustment && foreignTransfer, "the seed must hold both").toBeTruthy();
      expect((await caller("GET", `/inventory/adjustments/${foreignAdjustment.id}`)).status, label).toBe(404);
      expect((await caller("GET", `/inventory/transfers/${foreignTransfer.id}`)).status, label).toBe(404);
    }
    const valuation = await alex("GET", "/inventory/valuation");
    const mine = one<{ v: number }>(
      "SELECT COUNT(*) AS v FROM wac_snapshot WHERE warehouse_id = ?",
      ALEX_WAREHOUSE,
    );
    expect(rowsOf(valuation.body).length).toBeLessThanOrEqual(mine?.v ?? 0);
    expect(rowsOf((await mainOnly("GET", "/inventory/adjustments")).body).length).toBeGreaterThan(0);
  });

  it("finding 5 · another branch's receipt cannot be invoiced, its invoice cannot be allocated onto, and the open-invoice list is the grant's", async () => {
    const receipt = one<{ id: string }>("SELECT id FROM goods_receipt WHERE warehouse_id = ? AND status = 'confirmed' LIMIT 1", MAIN_WAREHOUSE)!.id;
    const foreignInvoice = one<{ id: string }>("SELECT id FROM sales_invoice WHERE branch_id = ? AND status = 'confirmed' AND customer_id = 'CUST-DEMO-2' LIMIT 1", MAIN)!.id;
    const state = () =>
      fingerprint("SELECT COUNT(*) AS n FROM purchase_invoice") +
      fingerprint("SELECT id, status, amount_paid FROM sales_invoice WHERE id = ?", foreignInvoice) +
      fingerprint("SELECT allocated FROM open_invoice WHERE id = ?", foreignInvoice) +
      fingerprint("SELECT COUNT(*) AS n FROM voucher_allocation");
    const before = state();
    for (const [label, caller] of restricted()) {
      const invoiced = await caller("POST", "/purchases/invoices", { id: `D111-R2-PI-${label.length}`, receiptId: receipt });
      expectRefusedInArabic(invoiced);
      expect(JSON.stringify(invoiced.body), label).not.toContain("lines");
      expectRefusedInArabic(await caller("POST", "/vouchers/VCH-DEMO-ALEX-1/allocations", { invoiceId: foreignInvoice, amount: "1.00" }));
      expectRefusedInArabic(
        await caller("POST", "/vouchers/collections", {
          id: `D111-R2-COLL-${label.length}`,
          customerId: "CUST-DEMO-2",
          treasuryAccountId: "TR-DEMO-CASH-ALEX",
          amount: "1.00",
          date: TODAY,
          allocations: [{ invoiceId: foreignInvoice, amount: "1.00" }],
        }),
      );
      expect(state(), label).toBe(before);

      const open = await caller("GET", "/open-invoices");
      expect(open.status, label).toBe(200);
      const ids: string[] = rowsOf(open.body).map((row: any) => row.id);
      expect(ids, label).not.toContain(foreignInvoice);
      for (const id of ids) {
        const owner = one<{ b: string | null }>(
          "SELECT COALESCE(branch_id, (SELECT branch_id FROM warehouse w WHERE w.id = warehouse_id)) AS b FROM sales_invoice WHERE id = ? UNION ALL SELECT COALESCE(branch_id, (SELECT branch_id FROM warehouse w WHERE w.id = warehouse_id)) FROM purchase_invoice WHERE id = ?",
          id,
          id,
        );
        expect(owner?.b, `${label} ${id}`).toBe(ALEX);
      }
    }
    expect(rowsOf((await admin("GET", "/open-invoices")).body).map((row: any) => row.id)).toContain(foreignInvoice);
  });

  it("finding 6 · the dashboard is folded from the caller's own branch lines", async () => {
    const cashOf = (where: string) =>
      one<{ net: number }>(
        `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id JOIN account a ON a.id = l.account_id WHERE e.status IN ('posted', 'reversed') AND a.type = 'asset' AND a.code LIKE '13%' AND a.is_header = 0 AND ${where}`,
      )!.net;
    const whole = await admin("GET", "/dashboard/summary");
    expect(scaled(whole.body.gl.cash)).toBe(BigInt(cashOf("1 = 1")));
    for (const [label, caller] of restricted()) {
      const res = await caller("GET", "/dashboard/summary");
      expect(res.status, label).toBe(200);
      const expected = label === "non-admin" ? cashOf(`l.branch_id = '${ALEX}'`) : cashOf(`(l.branch_id = '${ALEX}' OR l.branch_id IS NULL)`);
      expect(scaled(res.body.gl.cash), label).toBe(BigInt(expected));
      expect(res.body.gl.revenue, label).not.toBe(whole.body.gl.revenue);
      expect(res.body.counts.journalEntries, label).toBeLessThan(whole.body.counts.journalEntries);
      expect(res.body.recentActivity.length, label).toBeGreaterThan(0);
      for (const activity of res.body.recentActivity) {
        expect((await caller("GET", `/gl/journal-entries/${activity.id}`)).status, `${label} ${activity.id}`).toBe(200);
      }
    }
    const pendingEverywhere = (await admin("GET", "/workflow/requests/pending-count")).body.count;
    expect(pendingEverywhere).toBeGreaterThan(0);
    expect((await alexStar("GET", "/workflow/requests/pending-count")).body.count).toBe(rowsOf((await alexStar("GET", "/workflow/requests/pending")).body).length);
    expect((await alexStar("GET", "/workflow/requests/pending-count")).body.count).toBeLessThan(pendingEverywhere);
    for (const [label, caller] of restricted()) {
      const listed = rowsOf((await caller("GET", "/assets")).body).length;
      const stats = await caller("GET", "/assets/stats");
      expect(stats.status, label).toBe(200);
      expect(stats.body.count, label).toBe(listed);
      expect(stats.body.count, label).toBeLessThan((await admin("GET", "/assets/stats")).body.count);
    }
    const cockpit = await alex("GET", "/dashboard/cockpit");
    expect(JSON.stringify(cockpit.body)).not.toContain(MAIN);
  });

  it("finding 8 · documents with no by-id check before now refuse another branch's row", async () => {
    const attacks: readonly (readonly [method: string, path: string, body: unknown, stateSql: string])[] = [
      ["POST", "/rfqs/RFQ-DEMO-2/cancel", {}, "SELECT status FROM purchase_rfq WHERE id = 'RFQ-DEMO-2'"],
      ["POST", "/rfqs/RFQ-DEMO-2/close", {}, "SELECT status FROM purchase_rfq WHERE id = 'RFQ-DEMO-2'"],
      ["POST", "/crm/opportunities/OPP-DEMO-7/move-stage", { stageId: "STAGE-CONTACTED" }, "SELECT stage_id FROM crm_opportunity WHERE id = 'OPP-DEMO-7'"],
      ["POST", "/installments/plans/IPLAN-DEMO-1/cancel", {}, "SELECT status FROM framework_document WHERE id = 'IPLAN-DEMO-1'"],
      ["POST", "/hr/employees/EMP-DEMO-1/terminate", { date: TODAY, reason: "x" }, "SELECT * FROM hr_employee WHERE id = 'EMP-DEMO-1'"],
      ["PUT", "/hr/employees/EMP-DEMO-1", { nameAr: "مخترق" }, "SELECT * FROM hr_employee WHERE id = 'EMP-DEMO-1'"],
      ["POST", "/hr/advances/ADV-DEMO-3/disburse", { treasuryAccountId: "TR-DEMO-CASH-ALEX" }, "SELECT status FROM hr_employee_advance WHERE id = 'ADV-DEMO-3'"],
      ["POST", "/hr/leave-requests/LR-DEMO-2/approve", {}, "SELECT status FROM hr_leave_request WHERE id = 'LR-DEMO-2'"],
      ["POST", "/hr/attendance", { employeeId: "EMP-DEMO-1", date: TODAY, status: "absent" }, "SELECT COUNT(*) AS n FROM hr_attendance WHERE employee_id = 'EMP-DEMO-1'"],
    ];
    for (const [label, caller] of restricted()) {
      for (const [method, path, body, stateSql] of attacks) {
        const before = fingerprint(stateSql);
        expectRefusedInArabic(await caller(method, path, body));
        expect(fingerprint(stateSql), `${label} ${path}`).toBe(before);
      }
      for (const path of ["/rfqs/RFQ-DEMO-2", "/crm/opportunities/OPP-DEMO-7", "/hr/employees/EMP-DEMO-1", "/hr/advances/ADV-DEMO-3", "/installments/plans/IPLAN-DEMO-1"]) {
        expect((await caller("GET", path)).status, `${label} ${path}`).toBe(404);
      }
    }
    expect((await mainOnly("GET", "/rfqs/RFQ-DEMO-2")).status).toBe(200);
    expect((await mainOnly("GET", "/hr/employees/EMP-DEMO-1")).status).toBe(200);
  });

  it("finding 9 · a list shows a branch-restricted session nothing another branch's user can see, and the company-wide families refuse it", async () => {
    const lists = [
      "/workflow/requests",
      "/eta/submissions",
      "/field/vans",
      "/field/van-trips",
      "/hr/employees",
      "/hr/payroll/runs",
      "/hr/payroll/payslips",
      "/hr/attendance",
      "/hr/advances",
      "/hr/leave-requests",
      "/installments/plans",
      "/crm/opportunities",
      "/rfqs",
      "/pos/terminals",
    ];
    for (const path of lists) {
      const theirs: string[] = rowsOf((await mainOnly("GET", path)).body).map((row: any) => row.id);
      expect(theirs.length, `${path} must list rows to the other branch's own user`).toBeGreaterThan(0);
      for (const [label, caller] of restricted()) {
        const res = await caller("GET", path);
        expect(res.status, `${label} ${path}`).toBe(200);
        const mine: string[] = rowsOf(res.body).map((row: any) => row.id);
        expect(mine.filter((id) => theirs.includes(id)), `${label} ${path}`).toEqual([]);
      }
    }
    for (const path of ["/gl/recurring/templates", "/gl/recurring/runs"]) {
      expect(rowsOf((await alex("GET", path)).body), path).toEqual([]);
      expect(rowsOf((await alexWithUnattributed("GET", path)).body).length, path).toBeGreaterThan(0);
    }
    const companyRun = one<{ id: string }>("SELECT id FROM writedown_run WHERE warehouse_id IS NULL AND lines LIKE '%WH-MAIN%' LIMIT 1")!.id;
    for (const caller of [alex, alexWithUnattributed, alexStar]) {
      expect(rowsOf((await caller("GET", "/inventory/writedown-runs")).body).map((row: any) => row.id)).not.toContain(companyRun);
    }
    expect(rowsOf((await mainOnly("GET", "/inventory/writedown-runs")).body).map((row: any) => row.id)).toContain(companyRun);
    for (const path of ["/contracting/contracts", "/contracting/certificates", "/contracting/site/issues", "/projects", "/crm/leads", "/eta/receipts/summary"]) {
      for (const [label, caller] of restricted()) {
        const res = await caller("GET", path);
        expect(res.status, `${label} ${path}`).toBe(403);
        expect(res.body.error).toBe("COMPANY_WIDE_REPORT");
        expect(res.body.message).toMatch(ARABIC);
      }
      expect((await admin("GET", path)).status, path).toBe(200);
    }
    const withholding = await alex("GET", "/reports/tax/withholding");
    for (const row of rowsOf(withholding.body)) {
      expect(one<{ b: string }>("SELECT branch_id AS b FROM voucher WHERE id = ?", row.voucherId)?.b, row.voucherId).toBe(ALEX);
    }
  });

  it("finding 10 · a party statement shows no other branch's money, closes on the lines shown, and says it is limited", async () => {
    for (const [kind, partyId, table] of [["customers", "CUST-DEMO-1", "voucher"], ["suppliers", "SUPP-DEMO-1", "voucher"]] as const) {
      const whole = await admin("GET", `/reports/statements/${kind}/${partyId}`);
      expect(whole.status).toBe(200);
      expect(whole.body.lines.some((line: any) => line.key.startsWith("vch-") || line.key.startsWith("chq-")), `${kind}: the whole statement must hold receipts`).toBe(true);
      const res = await alex("GET", `/reports/statements/${kind}/${partyId}`);
      expect(res.status, kind).toBe(200);
      for (const line of res.body.lines) {
        if (line.key.startsWith("vch-")) {
          expect(one<{ b: string }>(`SELECT branch_id AS b FROM ${table} WHERE id = ?`, line.key.slice(4))?.b, line.key).toBe(ALEX);
        }
        if (line.key.startsWith("chq-")) {
          const chequeId = line.key.replace(/^chq-(back-)?/, "");
          expect(one<{ b: string }>("SELECT branch_id AS b FROM cheque WHERE id = ?", chequeId)?.b, line.key).toBe(ALEX);
        }
      }
      const shown = res.body.lines.reduce((net: bigint, line: any) => net + scaled(line.increase) - scaled(line.decrease), 0n);
      expect(scaled(res.body.closing), kind).toBe(shown);
      expect(res.body.branchCaveat, kind).not.toBeNull();
      expect(res.body.branchCaveat.message).toMatch(ARABIC);
      expect(res.body.closing, kind).not.toBe(whole.body.closing);
    }
  });

  it("finding 11 · a document raised with no branch lands in the session's only branch, and its author can open it", async () => {
    const posted = await alex("POST", "/gl/journal-entries", journal("D111-R2-JE-DEFAULT", null));
    expect(posted.status, JSON.stringify(posted.body).slice(0, 200)).toBe(201);
    expect(all("SELECT DISTINCT branch_id AS b FROM journal_line WHERE entry_id = ?", "D111-R2-JE-DEFAULT")).toEqual([{ b: ALEX }]);
    expect((await alex("GET", "/gl/journal-entries/D111-R2-JE-DEFAULT")).status).toBe(200);

    const draft = await alex("POST", "/gl/journal-entries/draft", journal("D111-R2-JE-DRAFT", null));
    expect(draft.status, JSON.stringify(draft.body).slice(0, 200)).toBe(201);
    expect(all("SELECT DISTINCT branch_id AS b FROM journal_line WHERE entry_id = ?", "D111-R2-JE-DRAFT")).toEqual([{ b: ALEX }]);

    const several = await bothBranches("POST", "/gl/journal-entries", journal("D111-R2-JE-SEVERAL", null));
    expect(several.status).toBe(400);
    expect(several.body.error).toBe("BRANCH_REQUIRED");
    expect(several.body.message).toMatch(ARABIC);
    expect(exists("journal_entry", "D111-R2-JE-SEVERAL")).toBe(false);

    const unattributed = await bothBranchesWithUnattributed("POST", "/gl/journal-entries", journal("D111-R2-JE-UNATTRIBUTED", null));
    expect(unattributed.status, JSON.stringify(unattributed.body).slice(0, 200)).toBe(201);
    expect(all("SELECT DISTINCT branch_id AS b FROM journal_line WHERE entry_id = ?", "D111-R2-JE-UNATTRIBUTED")).toEqual([{ b: null }]);

    const { branchId: _omitted, ...headerless } = voucher("D111-R2-V-DEFAULT", ALEX, "TR-DEMO-CASH-ALEX", "1300-1");
    const raised = await alex("POST", "/vouchers", headerless);
    expect(raised.status, JSON.stringify(raised.body).slice(0, 200)).toBe(201);
    expect(one<{ b: string }>("SELECT branch_id AS b FROM voucher WHERE id = ?", "D111-R2-V-DEFAULT")?.b).toBe(ALEX);
    expect((await alex("GET", "/vouchers/D111-R2-V-DEFAULT")).status).toBe(200);
    expect((await bothBranches("POST", "/vouchers", { ...headerless, id: "D111-R2-V-SEVERAL" })).body.error).toBe("BRANCH_REQUIRED");
    expect(exists("voucher", "D111-R2-V-SEVERAL")).toBe(false);
  });

  it("finding 12 · an id nothing holds and an id another branch holds answer the same body", async () => {
    const pairs: readonly (readonly [foreign: string, unknown: string])[] = [
      ["/rfqs/RFQ-DEMO-2", "/rfqs/D111-NO-SUCH"],
      ["/bank-statements/BSTMT-DEMO-1", "/bank-statements/D111-NO-SUCH"],
      ["/bank-statements/BSTMT-DEMO-1/review", "/bank-statements/D111-NO-SUCH/review"],
      ["/sales-invoices/INV-DEMO-2", "/sales-invoices/D111-NO-SUCH"],
      ["/hr/payroll/runs/PR-DEMO-2", "/hr/payroll/runs/D111-NO-SUCH"],
      ["/treasury-accounts/TR-DEMO-CASH", "/treasury-accounts/D111-NO-SUCH"],
      ["/gl/journal-entries/D111-JE-MAIN", "/gl/journal-entries/D111-NO-SUCH"],
    ];
    for (const [foreign, unknown] of pairs) {
      const a = await alex("GET", foreign);
      const b = await alex("GET", unknown);
      expect(a.status, foreign).toBe(404);
      expect(b.status, unknown).toBe(404);
      expect(a.body, foreign).toEqual(b.body);
      expect(JSON.stringify(a.body)).not.toContain("OUT_OF_BRANCH_SCOPE");
    }
    const finalize = await alex("POST", "/bank-statements/BSTMT-DEMO-1/finalize", {});
    expect(finalize.body).toEqual((await alex("POST", "/bank-statements/D111-NO-SUCH/finalize", {})).body);
  });

  it("finding 13 · no orphan draft out of another branch's warehouse, a query naming a foreign branch is refused, and the company-wide regime is closed", async () => {
    const drafts = () => one<{ n: number }>("SELECT COUNT(*) AS n FROM stock_transfer_document")!.n;
    const before = drafts();
    const orphan = await alex("POST", "/inventory/stock-transfers/draft", {
      id: "D111-R2-ORPHAN",
      date: TODAY,
      lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: MAIN_WAREHOUSE, toWarehouseId: ALEX_WAREHOUSE, qty: "1" }],
    });
    expect(orphan.status).toBe(403);
    expect(orphan.body.message).toMatch(ARABIC);
    expect(drafts()).toBe(before);

    for (const path of [
      `/reports/sales/by-period?branchId=${MAIN}`,
      `/reports/aging/customers?branchId=${MAIN}`,
      `/financial-reports/income-statement?branchId=${MAIN}`,
      `/sales-invoices?branchId=${MAIN}`,
      `/financial-reports/balance-sheet?branchId=${UNATTRIBUTED}`,
    ]) {
      const res = await alex("GET", path);
      expect(res.status, path).toBe(403);
      expect(res.body.error, path).toBe("BRANCH_OUT_OF_SCOPE");
      expect(res.body.message).toMatch(ARABIC);
    }
    expect((await alex("GET", `/reports/sales/by-period?branchId=${ALEX}`)).status).toBe(200);

    for (const [method, path] of [["GET", "/tax/simplified-regime"], ["GET", "/tax/simplified-regime/comparison"], ["PUT", "/tax/simplified-regime"]] as const) {
      const res = await alex(method, path, method === "PUT" ? {} : undefined);
      expect(res.status, path).toBe(403);
      expect(res.body.error).toBe("COMPANY_WIDE_REPORT");
      expect(res.body.message).toMatch(ARABIC);
    }
  });

  it("finding 13 · changing or deleting a role ends the sessions of the users who hold it", async () => {
    const role = await admin("POST", "/roles", { code: "D111_R2_ROLE", name: "دور اختبار", permissions: ["sales.invoice.view"] });
    expect(role.status, JSON.stringify(role.body).slice(0, 200)).toBe(201);
    const holder = one<{ id: string }>("SELECT id FROM user WHERE status = 'active' AND is_company_admin = 0 LIMIT 1")!.id;
    sqlite.prepare("UPDATE user SET role_id = ? WHERE id = ?").run(role.body.id, holder);
    const live = callerFor(handle.sessions.issue({ userId: holder, permissions: ["sales.invoice.view"], roleCode: "D111_R2_ROLE", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }));
    expect((await live("GET", "/sales-invoices")).status).toBe(200);

    const sameAuthority = await admin("PUT", `/roles/${role.body.id}`, { code: "D111_R2_ROLE", name: "دور اختبار معدّل", permissions: ["sales.invoice.view"] });
    expect(sameAuthority.status, JSON.stringify(sameAuthority.body).slice(0, 200)).toBe(200);
    expect((await live("GET", "/sales-invoices")).status).toBe(200);

    const narrowed = await admin("PUT", `/roles/${role.body.id}`, { code: "D111_R2_ROLE", name: "دور اختبار معدّل", permissions: ["sales.quote.view"] });
    expect(narrowed.status, JSON.stringify(narrowed.body).slice(0, 200)).toBe(200);
    expect((await live("GET", "/sales-invoices")).status).toBe(401);
  });

  it("finding 14 · a document with no branch and no warehouse is «غير مخصص»: absent without the permission, present with it", async () => {
    const id = "OPP-DEMO-1";
    const stage = () => one<{ stage_id: string }>("SELECT stage_id FROM crm_opportunity WHERE id = ?", id)!.stage_id;
    const original = stage();
    sqlite.prepare("UPDATE crm_opportunity SET branch_id = NULL WHERE id = ?").run(id);
    try {
      for (const caller of [alex, mainOnly]) {
        expect((await caller("GET", `/crm/opportunities/${id}`)).status).toBe(404);
        expectRefusedInArabic(await caller("POST", `/crm/opportunities/${id}/move-stage`, { stageId: "STAGE-CONTACTED" }));
        expect(rowsOf((await caller("GET", "/crm/opportunities")).body).map((row: any) => row.id)).not.toContain(id);
      }
      expect(stage()).toBe(original);
      expect((await alexWithUnattributed("GET", `/crm/opportunities/${id}`)).status).toBe(200);
      expect(rowsOf((await alexWithUnattributed("GET", "/crm/opportunities")).body).map((row: any) => row.id)).toContain(id);
      expect((await admin("GET", `/crm/opportunities/${id}`)).status).toBe(200);
    } finally {
      sqlite.prepare("UPDATE crm_opportunity SET branch_id = ? WHERE id = ?").run(MAIN, id);
    }
  });

  it("finding 15 · the seed's finance manager holds the unattributed permission", () => {
    const role = one<{ permissions: string }>("SELECT permissions FROM role WHERE code = 'FINANCE_MANAGER'");
    expect(role?.permissions ?? "").toContain(VIEW_UNATTRIBUTED);
  });

  it("finding 16 · cost centres, POS terminals, van trips, nested lines and a body under a multipart content type are held to the grant", async () => {
    const terminal = one<{ id: string }>("SELECT id FROM pos_terminal WHERE branch_id = ? LIMIT 1", MAIN)!.id;
    const trip = one<{ id: string }>("SELECT id FROM van_trip WHERE branch_id = ? AND status = 'ongoing' LIMIT 1", MAIN)!.id;
    const state = () =>
      fingerprint("SELECT id, branch_id, name_ar FROM cost_center ORDER BY id") +
      fingerprint("SELECT id, branch_id, warehouse_id, drawer_treasury_account_id FROM pos_terminal ORDER BY id") +
      fingerprint("SELECT id, status FROM van_trip ORDER BY id") +
      fingerprint("SELECT COUNT(*) AS n FROM sales_invoice") +
      fingerprint("SELECT COUNT(*) AS n FROM voucher");
    const before = state();
    for (const [label, caller] of restricted()) {
      expectRefusedInArabic(await caller("PATCH", "/cost-centers/CC-DEMO-1", { nameAr: "مخترق" }));
      expect((await caller("POST", "/cost-centers", { id: `D111-R2-CC-${label.length}`, code: `D${label.length}`, nameAr: "مركز", branchId: MAIN })).status, label).toBe(403);
      expect((await caller("GET", `/pos/terminals/${terminal}`)).status, label).toBe(404);
      expectRefusedInArabic(await caller("PUT", `/pos/terminals/${terminal}`, { name: "مخترق" }));
      expect((await caller("POST", "/pos/terminals", { code: `D111-${label.length}`, name: "نقطة", kind: "counter", branchId: MAIN, warehouseId: MAIN_WAREHOUSE })).status, label).toBe(403);
      expect((await caller("POST", "/pos/terminals", { code: `D111-${label.length}`, name: "نقطة", kind: "counter", branchId: ALEX, warehouseId: ALEX_WAREHOUSE, drawerTreasuryAccountId: "TR-POS-DRAWER-1" })).status, label).toBe(403);
      expect((await caller("GET", `/field/van-trips/${trip}`)).status, label).toBe(404);
      expectRefusedInArabic(await caller("POST", `/field/van-trips/${trip}/settle`, {}));
      expectRefusedInArabic(await caller("POST", `/field/van-trips/${trip}/cash-movements`, { amount: "1.00", direction: "in" }));
      expectRefusedInArabic(await caller("POST", "/field/van-trips", { vanId: "VAN-DEMO-1", date: TODAY }));

      const nested = salesInvoice(`D111-R2-NESTED-${label.length}`, ALEX, ALEX_WAREHOUSE);
      const smuggled = { ...nested, lines: nested.lines.map((line) => ({ ...line, warehouseId: MAIN_WAREHOUSE })) };
      expect((await caller("POST", "/sales-invoices", smuggled)).status, label).toBe(403);
      const multipart = await caller("POST", "/vouchers", JSON.stringify(voucher(`D111-R2-MP-${label.length}`, ALEX, "TR-DEMO-CASH", "1300-1")), {
        "content-type": "multipart/form-data; boundary=x",
      });
      expect(multipart.status, label).toBe(403);
      expect(state(), label).toBe(before);
    }
  });

  it("finding 16 · a LAN till holds its own seat and stream; the device register is the company's", async () => {
    const seat = await alex("POST", "/lan/sessions", { deviceId: "D111-R2-TILL", deviceLabel: "خزينة الإسكندرية" });
    expect(seat.status, JSON.stringify(seat.body).slice(0, 200)).toBeLessThan(300);
    expect((await alex("GET", "/lan/status")).status).toBe(200);
    for (const [method, path] of [["GET", "/lan/sessions"], ["DELETE", `/lan/sessions/${seat.body.sessionId ?? "x"}`]] as const) {
      const res = await alex(method, path);
      expect(res.status, path).toBe(403);
      expect(res.body.error).toBe("COMPANY_WIDE_REPORT");
    }
    expect((await admin("GET", "/lan/sessions")).status).toBe(200);
  });

  it("an unrestricted admin is untouched by any of it", async () => {
    expect((await admin("GET", `/warehouses/${MAIN_WAREHOUSE}`)).status).toBe(200);
    expect((await admin("GET", "/projects")).status).toBe(200);
    expect((await admin("GET", `/reports/sales/by-period?branchId=${MAIN}`)).status).toBe(200);
    expect((await admin("GET", "/tax/simplified-regime")).status).toBe(200);
  });
});

describe("D111 round 3 · a branch-restricted administrator cannot administer its way out of the branch", () => {
  const BRANCH_ADMIN = "USER-R3-BRANCH-ADMIN";
  const HQ_ACCOUNTANT = "USER-R3-HQ-ACCOUNTANT";
  const ALEX_CLERK = "USER-R3-ALEX-CLERK";
  let branchAdmin: Caller;
  let roleId: string;

  const account = (email: string, extra: Record<string, unknown>) => ({
    nameAr: "حساب اختبار",
    email,
    roleId: null,
    isCompanyAdmin: false,
    branchScope: [ALEX],
    warehouseScope: ALL_SCOPE,
    password: "correct-horse-battery",
    ...extra,
  });
  const stored = (id: string) => one<any>("SELECT is_company_admin, branch_scope, warehouse_scope, pin_hash, password_hash, status, role_id FROM user WHERE id = ?", id);

  beforeAll(async () => {
    roleId = one<{ id: string }>("SELECT role_id AS id FROM user WHERE role_id IS NOT NULL AND status = 'active' LIMIT 1")!.id;
    const insert = sqlite.prepare(
      "INSERT INTO user (id, name_ar, email, password_hash, role_id, is_company_admin, branch_scope, warehouse_scope, status, created_at) VALUES (?, ?, ?, 'x', ?, ?, ?, '\"*\"', ?, ?)",
    );
    insert.run(BRANCH_ADMIN, "مدير فرع الإسكندرية", "r3-branch-admin@cyag.example", null, 1, JSON.stringify([ALEX]), "active", TODAY);
    insert.run(HQ_ACCOUNTANT, "محاسب المركز", "r3-hq-accountant@cyag.example", roleId, 0, '"*"', "active", TODAY);
    insert.run(ALEX_CLERK, "موظف الإسكندرية", "r3-alex-clerk@cyag.example", roleId, 0, JSON.stringify([ALEX]), "inactive", TODAY);
    branchAdmin = callerFor(handle.sessions.issue({ userId: BRANCH_ADMIN, permissions: ["*"], roleCode: null, branchScope: [ALEX], warehouseScope: ALL_SCOPE }));
  });

  function expectEscalationRefused(res: Res) {
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(403);
    expect(res.body.error).toBe("PRIVILEGE_ESCALATION_DENIED");
    expect(res.body.message).toMatch(ARABIC);
  }

  it("cannot create a company administrator over every branch", async () => {
    const res = await branchAdmin("POST", "/users", account("r3-minted@cyag.example", { isCompanyAdmin: true, branchScope: ALL_SCOPE }));
    expectEscalationRefused(res);
    expect(one("SELECT id FROM user WHERE email = 'r3-minted@cyag.example'")).toBeUndefined();
  });

  it("cannot create an account in a branch it does not hold", async () => {
    expectEscalationRefused(await branchAdmin("POST", "/users", account("r3-main@cyag.example", { roleId, branchScope: [MAIN] })));
    expect(one("SELECT id FROM user WHERE email = 'r3-main@cyag.example'")).toBeUndefined();
  });

  it("cannot widen its own account to every branch", async () => {
    const res = await branchAdmin("PUT", `/users/${BRANCH_ADMIN}`, account("r3-branch-admin@cyag.example", { isCompanyAdmin: true, branchScope: ALL_SCOPE, password: undefined }));
    expectEscalationRefused(res);
    expect(JSON.parse(stored(BRANCH_ADMIN).branch_scope)).toEqual([ALEX]);
  });

  it("cannot set the PIN or password of an account that reaches further than it does", async () => {
    const before = stored(HQ_ACCOUNTANT);
    const edit = account("r3-hq-accountant@cyag.example", { roleId, branchScope: ALL_SCOPE, password: undefined });
    expectEscalationRefused(await branchAdmin("PUT", `/users/${HQ_ACCOUNTANT}`, { ...edit, pin: "432100" }));
    expectEscalationRefused(await branchAdmin("PUT", `/users/${HQ_ACCOUNTANT}`, { ...edit, password: "an-attackers-password" }));
    expect(stored(HQ_ACCOUNTANT)).toEqual(before);
  });

  it("cannot change the role of, make an administrator of, deactivate, reactivate or unlock such an account", async () => {
    const before = stored(HQ_ACCOUNTANT);
    const otherRole = one<{ id: string }>("SELECT id FROM role WHERE id <> ? LIMIT 1", roleId)!.id;
    expectEscalationRefused(await branchAdmin("PUT", `/users/${HQ_ACCOUNTANT}`, account("r3-hq-accountant@cyag.example", { roleId: otherRole, branchScope: [ALEX], password: undefined })));
    expectEscalationRefused(await branchAdmin("PUT", `/users/${HQ_ACCOUNTANT}`, account("r3-hq-accountant@cyag.example", { isCompanyAdmin: true, branchScope: [ALEX], password: undefined })));
    for (const action of ["deactivate", "activate", "unlock"]) {
      expectEscalationRefused(await branchAdmin("POST", `/users/${HQ_ACCOUNTANT}/${action}`, {}));
    }
    expect(stored(HQ_ACCOUNTANT)).toEqual(before);
    expectEscalationRefused(await branchAdmin("POST", "/users/USER-ADMIN/deactivate", {}));
    expect(stored("USER-ADMIN").status).toBe("active");
  });

  it("is refused the same way when it is a non-admin holding every permission", async () => {
    const before = stored(HQ_ACCOUNTANT);
    expectEscalationRefused(await alex("PUT", `/users/${HQ_ACCOUNTANT}`, account("r3-hq-accountant@cyag.example", { roleId, branchScope: ALL_SCOPE, password: undefined, pin: "432100" })));
    expectEscalationRefused(await alex("POST", "/users", account("r3-alex-minted@cyag.example", { roleId, branchScope: ALL_SCOPE })));
    expect(stored(HQ_ACCOUNTANT)).toEqual(before);
  });

  it("still administers an account inside its own branch", async () => {
    const created = await branchAdmin("POST", "/users", account("r3-alex-new@cyag.example", { roleId }));
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    expect(JSON.parse(one<any>("SELECT branch_scope FROM user WHERE email = 'r3-alex-new@cyag.example'").branch_scope)).toEqual([ALEX]);
    const activated = await branchAdmin("POST", `/users/${ALEX_CLERK}/activate`, {});
    expect(activated.status, JSON.stringify(activated.body).slice(0, 300)).toBe(200);
    expect(stored(ALEX_CLERK).status).toBe("active");
  });

  it("leaves an unrestricted administrator free to do all of it", async () => {
    const res = await admin("PUT", `/users/${HQ_ACCOUNTANT}`, account("r3-hq-accountant@cyag.example", { roleId, branchScope: ALL_SCOPE, password: undefined, pin: "987600" }));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(stored(HQ_ACCOUNTANT).pin_hash).toBeTruthy();
  });
});

describe("D111 round 3 · an employee's or an attendance record's files are the employee's branch's", () => {
  const upload = (id: string, entityType: string, entityId: string) => ({
    id,
    entityType,
    entityId,
    fileName: "contract.txt",
    mimeType: "text/plain",
    contentBase64: Buffer.from("عقد عمل").toString("base64"),
  });

  it("another branch's employee contract and attendance sheet cannot be read, listed, added to or deleted", async () => {
    const employee = one<{ id: string }>("SELECT id FROM hr_employee WHERE branch_id = ? LIMIT 1", MAIN)!;
    const attendance = one<{ id: string }>("SELECT a.id FROM hr_attendance a JOIN hr_employee e ON e.id = a.employee_id WHERE e.branch_id = ? LIMIT 1", MAIN)!;
    for (const [entityType, entityId] of [["employee", employee.id], ["attendance", attendance.id]] as const) {
      const stored = `R3-ATT-${entityType}`;
      expect((await admin("POST", "/attachments", upload(stored, entityType, entityId))).status, entityType).toBe(201);
      expect((await mainOnly("GET", `/attachments/${stored}`)).status, entityType).toBe(200);

      expect((await alex("GET", `/attachments/${stored}`)).status, entityType).toBe(404);
      const content = await alex("GET", `/attachments/${stored}/content`);
      expect(content.status, entityType).toBe(404);
      expect(content.body.contentBase64).toBeUndefined();
      expect(rowsOf((await alex("GET", `/attachments?entityType=${entityType}&entityId=${entityId}`)).body)).toEqual([]);
      expect(rowsOf((await alex("GET", "/attachments")).body).map((r: any) => r.id)).not.toContain(stored);
      expectRefusedInArabic(await alex("POST", "/attachments", upload(`${stored}-PROBE`, entityType, entityId)));
      expectRefusedInArabic(await alex("DELETE", `/attachments/${stored}`));
      expectRefusedInArabic(await alexStar("DELETE", `/attachments/${stored}`));
      expect(one<{ n: number }>("SELECT COUNT(*) AS n FROM attachment WHERE id IN (?, ?)", stored, `${stored}-PROBE`)!.n, entityType).toBe(1);
    }
  });

  it("the branch's own employee's files stay with the branch", async () => {
    sqlite.prepare("INSERT OR REPLACE INTO hr_employee SELECT 'R3-EMP-ALEX', " + employeeColumnsAfterId() + " FROM hr_employee LIMIT 1").run();
    sqlite.prepare("UPDATE hr_employee SET branch_id = ? WHERE id = 'R3-EMP-ALEX'").run(ALEX);
    expect((await alex("POST", "/attachments", upload("R3-ATT-OWN", "employee", "R3-EMP-ALEX"))).status).toBe(201);
    expect((await alex("GET", "/attachments/R3-ATT-OWN")).status).toBe(200);
    expect((await mainOnly("GET", "/attachments/R3-ATT-OWN")).status).toBe(404);
    expect((await alex("DELETE", "/attachments/R3-ATT-OWN")).status).toBeLessThan(300);
  });

  function employeeColumnsAfterId(): string {
    return all<{ name: string }>("SELECT name FROM pragma_table_info('hr_employee')")
      .map((column) => column.name)
      .filter((name) => name !== "id")
      .map((name) => (name === "code" || name === "employee_no" || name === "national_id" ? `'R3-' || ${name}` : name))
      .join(", ");
  }
});

describe("D111 round 3 · stock crosses a branch line only by a session that holds both sides", () => {
  const transfer = (id: string) => ({ id, date: TODAY, lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: ALEX_WAREHOUSE, toWarehouseId: MAIN_WAREHOUSE, qty: "1" }] });
  const received = () => JSON.stringify(all("SELECT COUNT(*) AS n, COALESCE(SUM(CAST(qty AS REAL)), 0) AS q FROM stock_movement WHERE warehouse_id = ?", MAIN_WAREHOUSE));

  it("a branch user cannot push stock into another branch's warehouse, on the document route or the legacy one", async () => {
    const before = received();
    for (const caller of [alex, alexStar]) {
      const drafted = await caller("POST", "/inventory/stock-transfers/draft", transfer("R3-TRF-PUSH"));
      expect(drafted.status).toBe(403);
      expect(drafted.body.error).toBe("BRANCH_OUT_OF_SCOPE");
      expect(drafted.body.message).toMatch(ARABIC);
      const legacy = await caller("POST", "/inventory/transfers", {
        transferId: "R3-TRF-LEGACY-PUSH",
        fromWarehouseId: ALEX_WAREHOUSE,
        toWarehouseId: MAIN_WAREHOUSE,
        occurredAt: TODAY,
        lines: [{ itemId: "ITEM-DEMO-1", qty: "1" }],
      });
      expect(legacy.status).toBe(403);
      expect(legacy.body.error).toBe("BRANCH_OUT_OF_SCOPE");
    }
    expect(one("SELECT id FROM stock_transfer_document WHERE id = 'R3-TRF-PUSH'")).toBeUndefined();
    expect(received()).toBe(before);
  });

  it("nor confirm a cross-branch draft someone else raised", async () => {
    expect((await admin("POST", "/inventory/stock-transfers/draft", transfer("R3-TRF-HELD"))).status).toBe(201);
    const before = received();
    for (const caller of [alex, alexStar]) expectRefusedInArabic(await caller("POST", "/inventory/stock-transfers/R3-TRF-HELD/confirm", {}));
    expect(one<any>("SELECT status FROM stock_transfer_document WHERE id = 'R3-TRF-HELD'").status).toBe("draft");
    expect(received()).toBe(before);
    expect((await alex("GET", "/inventory/stock-transfers/R3-TRF-HELD")).status).toBe(200);
  });

  it("a session holding both branches, and an unrestricted one, still move stock between them", async () => {
    expect((await bothBranches("POST", "/inventory/stock-transfers/draft", transfer("R3-TRF-BOTH"))).status).toBe(201);
    expect((await admin("POST", "/inventory/stock-transfers/draft", transfer("R3-TRF-ADMIN"))).status).toBe(201);
  });
});

describe("D111 round 3 · a document's warehouse belongs to the document's branch, for every session", () => {
  function expectMismatch(res: Res) {
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(422);
    expect(res.body.error).toBe("WAREHOUSE_BRANCH_MISMATCH");
    expect(res.body.message).toMatch(ARABIC);
  }

  it("refuses a header branch and a warehouse that disagree, for an unrestricted admin and a two-branch user", async () => {
    for (const [label, caller] of [["admin", admin], ["both", bothBranches]] as const) {
      expectMismatch(await caller("POST", "/sales-invoices", salesInvoice(`R3-WB-INV-${label}`, ALEX, MAIN_WAREHOUSE)));
      expectMismatch(await caller("POST", "/purchases/invoices", purchaseInvoice(`R3-WB-PI-${label}`, MAIN, ALEX_WAREHOUSE)));
      expect(one("SELECT id FROM sales_invoice WHERE id = ?", `R3-WB-INV-${label}`)).toBeUndefined();
      expect(one("SELECT id FROM purchase_invoice WHERE id = ?", `R3-WB-PI-${label}`)).toBeUndefined();
    }
  });

  it("refuses a line whose warehouse is outside the header's branch", async () => {
    const body = { ...salesInvoice("R3-WB-LINE", ALEX, ALEX_WAREHOUSE) } as any;
    body.lines = [{ ...body.lines[0], warehouseId: MAIN_WAREHOUSE }];
    expectMismatch(await admin("POST", "/sales-invoices", body));
  });

  it("accepts the pair that agrees, and a transfer, which has two warehouses by nature", async () => {
    expect((await admin("POST", "/sales-invoices", salesInvoice("R3-WB-OK", ALEX, ALEX_WAREHOUSE))).status).toBe(201);
    const moved = await admin("POST", "/inventory/stock-transfers/draft", {
      id: "R3-WB-TRF",
      date: TODAY,
      lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: MAIN_WAREHOUSE, toWarehouseId: ALEX_WAREHOUSE, qty: "1" }],
    });
    expect(moved.status).toBe(201);
  });
});

describe("D111 round 3 · head office pays and collects for a branch; a branch user cannot reach into another branch's cash", () => {
  const HQ_BANK = "TR-R3-HQ-BANK";
  const unbalancedByBranch = (entryId: string) =>
    all("SELECT branch_id, SUM(debit) - SUM(credit) AS d FROM journal_line WHERE entry_id = ? GROUP BY branch_id HAVING d <> 0", entryId);
  const entryOf = (voucherId: string) => one<{ id: string }>("SELECT journal_entry_id AS id FROM voucher WHERE id = ?", voucherId)!.id;

  it("an unrestricted admin pays a branch's expense out of the head-office bank, and the entry balances inside the branch", async () => {
    const paid = await admin("POST", "/vouchers", { ...voucher("R3-HQ-PAYS", ALEX, "TR-DEMO-BANK", "1310"), paymentMethod: "bank" });
    expect(paid.status, JSON.stringify(paid.body).slice(0, 300)).toBe(201);
    const confirmed = await admin("POST", "/vouchers/R3-HQ-PAYS/confirm", {});
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 300)).toBe(200);
    const lines = all<{ branch_id: string }>("SELECT branch_id FROM journal_line WHERE entry_id = ?", entryOf("R3-HQ-PAYS"));
    expect(lines.length).toBeGreaterThan(1);
    expect(new Set(lines.map((line) => line.branch_id))).toEqual(new Set([ALEX]));
    expect(unbalancedByBranch(entryOf("R3-HQ-PAYS"))).toEqual([]);
  });

  it("a bank account can be the company's, held by no branch", async () => {
    const created = await admin("POST", "/treasury-accounts", { id: HQ_BANK, code: "BANK-R3-HQ", name: "حساب المركز الرئيسي", type: "bank", branchId: null, glAccountId: "1310" });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    expect((await admin("GET", `/treasury-accounts/${HQ_BANK}`)).body.branchId).toBeNull();
  });

  it("a branch user sees and uses the company's account and its own branch's, and nothing of another branch's", async () => {
    for (const caller of [alex, alexStar]) {
      const ids = rowsOf((await caller("GET", "/treasury-accounts")).body).map((row: any) => row.id);
      expect(ids).toContain(HQ_BANK);
      expect(ids).toContain("TR-DEMO-CASH-ALEX");
      expect(ids).not.toContain("TR-DEMO-CASH");
      expect((await caller("GET", `/treasury-accounts/${HQ_BANK}`)).status).toBe(200);
    }
    const collected = await alex("POST", "/vouchers", { ...voucher("R3-BRANCH-USES-HQ", ALEX, HQ_BANK, "1310"), paymentMethod: "bank" });
    expect(collected.status, JSON.stringify(collected.body).slice(0, 300)).toBe(201);
    expect((await alex("POST", "/vouchers/R3-BRANCH-USES-HQ/confirm", {})).status).toBe(200);
    expect(unbalancedByBranch(entryOf("R3-BRANCH-USES-HQ"))).toEqual([]);
  });

  it("a branch user cannot change the company's account, nor take it for its branch", async () => {
    for (const caller of [alex, alexStar]) {
      const renamed = await caller("PATCH", `/treasury-accounts/${HQ_BANK}`, { name: "حسابي" });
      expect(renamed.status).toBe(403);
      expect(renamed.body.message).toMatch(ARABIC);
      expect((await caller("PATCH", `/treasury-accounts/${HQ_BANK}`, { branchId: ALEX })).status).toBe(403);
    }
    expect(one<any>("SELECT name, branch_id FROM treasury_account WHERE id = ?", HQ_BANK)).toEqual({ name: "حساب المركز الرئيسي", branch_id: "" });
  });

  it("a user holding two branches still cannot pay one branch's document out of the other's drawer", async () => {
    const res = await bothBranches("POST", "/vouchers", voucher("R3-BOTH-MISMATCH", ALEX, "TR-DEMO-CASH", "1300-1"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("TREASURY_BRANCH_MISMATCH");
  });

  it("an unrestricted admin disburses a branch's payroll centrally, out of the company's account", async () => {
    const run = one<{ id: string; branch_id: string }>("SELECT id, branch_id FROM hr_payroll_run WHERE status = 'approved' LIMIT 1")!;
    const funded = await admin("POST", "/vouchers", { ...voucher("R3-HQ-FUND", MAIN, HQ_BANK, "1310"), amount: "900000.00", paymentMethod: "bank" });
    expect(funded.status, JSON.stringify(funded.body).slice(0, 300)).toBe(201);
    expect((await admin("POST", "/vouchers/R3-HQ-FUND/confirm", {})).status).toBe(200);
    const disbursed = await admin("POST", `/hr/payroll/runs/${run.id}/disburse`, { treasuryAccountId: HQ_BANK, branchId: run.branch_id, date: TODAY });
    expect(disbursed.status, JSON.stringify(disbursed.body).slice(0, 300)).toBe(200);
    expect(one<any>("SELECT status FROM hr_payroll_run WHERE id = ?", run.id).status).toBe("disbursed");
  });

  it("the books still balance for the company and inside every branch", () => {
    expect(all("SELECT entry_id FROM journal_line GROUP BY entry_id HAVING SUM(debit) <> SUM(credit)")).toEqual([]);
    const company = one<{ d: number }>("SELECT SUM(debit) - SUM(credit) AS d FROM journal_line")!.d;
    const perBranch = all<{ d: number }>("SELECT SUM(debit) - SUM(credit) AS d FROM journal_line GROUP BY COALESCE(branch_id, '')");
    expect(company).toBe(0);
    expect(perBranch.reduce((sum, row) => sum + row.d, 0)).toBe(company);
  });
});

describe("D111 round 3 · a record raised with no branch lands in the author's only branch, on every family that lets the branch be left out", () => {
  const cases: readonly (readonly [label: string, path: string, table: string, body: (id: string) => Record<string, unknown>])[] = [
    ["CRM opportunity", "/crm/opportunities", "crm_opportunity", (id) => ({ id, title: "فرصة اختبار", customerId: "CUST-DEMO-2", stageId: "STAGE-CONTACTED" })],
    [
      "fixed asset",
      "/assets",
      "asset",
      (id) => ({ id, code: id, nameAr: "أصل اختبار", categoryId: "ASSET-CAT-DEMO-1", acquisitionDate: TODAY, acquisitionCost: "1000.00" }),
    ],
  ];

  for (const [label, path, table, body] of cases) {
    it(`${label}: lands in the branch, its author opens it, and a two-branch author must say which`, async () => {
      const id = `R3-DEF-${table}`;
      const created = await alex("POST", path, body(id));
      expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
      expect(one<{ b: string }>(`SELECT branch_id AS b FROM ${table} WHERE id = ?`, id)?.b).toBe(ALEX);
      expect((await alex("GET", `${path}/${id}`)).status).toBe(200);
      expect(rowsOf((await alex("GET", path)).body).map((row: any) => row.id)).toContain(id);
      expect((await mainOnly("GET", `${path}/${id}`)).status).toBe(404);

      const several = await bothBranches("POST", path, body(`${id}-SEVERAL`));
      expect(several.status).toBe(400);
      expect(several.body.error).toBe("BRANCH_REQUIRED");
      expect(several.body.message).toMatch(ARABIC);
      expect(one(`SELECT id FROM ${table} WHERE id = ?`, `${id}-SEVERAL`)).toBeUndefined();
    });
  }

  it("shift template: lands in the branch and is listed to its author", async () => {
    const created = await alex("POST", "/shift-templates", { nameAr: "وردية اختبار الفرع", fromTime: "02:00", toTime: "03:00" });
    expect(created.status, JSON.stringify(created.body).slice(0, 300)).toBe(201);
    expect(one<{ b: string }>("SELECT branch_id AS b FROM shift_template WHERE name_ar = 'وردية اختبار الفرع'")?.b).toBe(ALEX);
    expect(rowsOf((await alex("GET", "/shift-templates")).body).map((row: any) => row.nameAr)).toContain("وردية اختبار الفرع");
  });
});

describe("D111 round 3 · a refusal does not tell a branch user whether another branch holds an id", () => {
  it("a referenced document another branch holds and one nobody holds answer the same", async () => {
    const foreignReceipt = one<{ id: string }>("SELECT r.id FROM goods_receipt r JOIN warehouse w ON w.id = r.warehouse_id WHERE w.branch_id = ? LIMIT 1", MAIN)!.id;
    const foreignInvoice = one<{ id: string }>("SELECT id FROM sales_invoice WHERE branch_id = ? AND status = 'confirmed' LIMIT 1", MAIN)!.id;
    const ownVoucher = one<{ id: string }>("SELECT id FROM voucher WHERE branch_id = ? LIMIT 1", ALEX)!.id;
    const probes: readonly (readonly [path: string, body: (id: string) => unknown, foreign: string])[] = [
      ["/purchases/invoices", (id) => ({ ...purchaseInvoice(`R3-ORACLE-${id.length}`, ALEX, ALEX_WAREHOUSE), receiptId: id }), foreignReceipt],
      ["/allocations", (id) => ({ voucherId: ownVoucher, invoiceId: id, amount: "1.00" }), foreignInvoice],
      ["/crm/activities", (id) => ({ type: "call", subject: "متابعة", relatedOpportunityId: id }), one<{ id: string }>("SELECT id FROM crm_opportunity WHERE branch_id = ? LIMIT 1", MAIN)!.id],
    ];
    for (const [path, body, foreign] of probes) {
      for (const caller of [alex, alexStar]) {
        const held = await caller("POST", path, body(foreign));
        const unknown = await caller("POST", path, body("R3-NOBODY-HOLDS-THIS"));
        expect(held.status, path).toBe(404);
        expect({ status: unknown.status, body: unknown.body }, path).toEqual({ status: held.status, body: held.body });
      }
    }
  });

  it("creating under another branch's id answers as a reference nobody holds, under the caller's own as «taken», and neither names the other branch", async () => {
    const foreign = one<{ id: string; doc_no: string }>("SELECT id, doc_no FROM sales_invoice WHERE branch_id = ? AND doc_no IS NOT NULL LIMIT 1", MAIN)!;
    const own = one<{ id: string }>("SELECT id FROM sales_invoice WHERE branch_id = ? LIMIT 1", ALEX)!;
    for (const caller of [alex, alexStar]) {
      const overForeign = await caller("POST", "/sales-invoices", salesInvoice(foreign.id, ALEX, ALEX_WAREHOUSE));
      const overOwn = await caller("POST", "/sales-invoices", salesInvoice(own.id, ALEX, ALEX_WAREHOUSE));
      expect(overForeign.status).toBe(404);
      expect(overForeign.body.error).toBe("NOT_FOUND");
      expect(overForeign.body.message).toMatch(ARABIC);
      expect(overOwn.status).toBe(409);
      expect(overOwn.body.error).toBe(RecordErrorCode.DuplicateId);
      expect(JSON.stringify(overForeign.body)).not.toContain(foreign.id);
      expect(JSON.stringify(overForeign.body)).not.toContain(foreign.doc_no);
      expect(JSON.stringify(overForeign.body)).not.toContain(MAIN);
    }
    expect(one<{ b: string }>("SELECT branch_id AS b FROM sales_invoice WHERE id = ?", foreign.id)!.b).toBe(MAIN);
  });
});

describe("D111 round 3 · shared master data carries no other branch's money or stock", () => {
  const restricted = (): readonly (readonly [label: string, caller: Caller])[] => [
    ["non-admin", alex],
    ["* admin granted one branch", alexStar],
  ];
  const sumOwed = (rows: any[]) => rows.reduce((sum, row) => sum + BigInt(String(row.owed).replace(".", "")), 0n);
  const scaled = (money: string) => BigInt(money.replace(".", ""));

  it("what customers owe and suppliers are owed is the caller's branch ladder, in the stats, the list and the record", async () => {
    const company = {
      customers: (await admin("GET", "/customers/stats")).body.toCollect,
      suppliers: (await admin("GET", "/suppliers/stats")).body.payable,
    };
    expect(company.customers).toBe((await admin("GET", "/reports/aging/customers")).body.grandTotals.total);
    for (const [label, caller] of restricted()) {
      const ladder = {
        customers: (await caller("GET", "/reports/aging/customers")).body.grandTotals.total,
        suppliers: (await caller("GET", "/reports/aging/suppliers")).body.grandTotals.total,
      };
      expect(scaled(ladder.customers), label).toBeLessThan(scaled(company.customers));
      expect((await caller("GET", "/customers/stats")).body.toCollect, label).toBe(ladder.customers);
      expect((await caller("GET", "/suppliers/stats")).body.payable, label).toBe(ladder.suppliers);
      const customers = rowsOf((await caller("GET", "/customers?pageSize=500")).body);
      const suppliers = rowsOf((await caller("GET", "/suppliers?pageSize=500")).body);
      expect(sumOwed(customers), label).toBe(scaled(ladder.customers));
      expect(sumOwed(suppliers), label).toBe(scaled(ladder.suppliers));
      for (const row of customers.filter((customer: any) => scaled(customer.owed) !== 0n).slice(0, 3)) {
        expect((await caller("GET", `/customers/${row.id}`)).body.owed, label).toBe(row.owed);
      }
      const foreignOnly = rowsOf((await admin("GET", "/customers?pageSize=500")).body).find(
        (row: any) => scaled(row.owed) > 0n && scaled(customers.find((mine: any) => mine.id === row.id)?.owed ?? "0.0") === 0n,
      );
      expect(foreignOnly, "the seed holds a customer who owes only another branch").toBeTruthy();
      expect((await caller("GET", `/customers/${foreignOnly.id}`)).body.owed, label).toBe("0.000000");
      expect((await caller("GET", "/customers?overLimit=true")).status, label).toBe(200);
    }
  });

  it("an item's on-hand quantity and the low-stock counts are the caller's warehouses'", async () => {
    const onHandIn = (warehouseIds: readonly string[], itemId: string) =>
      all<{ on_hand: number }>(
        `SELECT on_hand FROM wac_snapshot WHERE item_id = ? AND warehouse_id IN (${warehouseIds.map(() => "?").join(",")})`,
        itemId,
        ...warehouseIds,
      ).length;
    const everywhere = rowsOf((await admin("GET", "/items?pageSize=100")).body);
    const heldOnlyElsewhere = everywhere.find((row: any) => row.onHand !== null && Number(row.onHand) > 0 && onHandIn([ALEX_WAREHOUSE], row.id) === 0);
    expect(heldOnlyElsewhere, "the seed holds an item stocked only outside the branch").toBeTruthy();
    for (const [label, caller] of restricted()) {
      const mine = rowsOf((await caller("GET", "/items?pageSize=100")).body);
      expect(Number(mine.find((row: any) => row.id === heldOnlyElsewhere.id).onHand), label).toBe(0);
      const counts = (await caller("GET", "/items/counts")).body;
      expect(counts.out_of_stock, label).toBe(mine.filter((row: any) => row.stockState === "out").length);
      expect(counts.low_stock, label).toBe(mine.filter((row: any) => row.stockState === "low").length);
      expect(counts.out_of_stock, label).toBeGreaterThan((await admin("GET", "/items/counts")).body.out_of_stock);
    }
  });

  it("a promotion's report counts only the discount the caller's branch granted", async () => {
    const company = (await admin("GET", "/promotions/report")).body as any[];
    expect(company.some((row) => row.usageCount > 0)).toBe(true);
    const grantedInBranch = (promotionId: string) =>
      one<{ n: number }>("SELECT COUNT(*) AS n FROM sales_invoice WHERE promotion_id = ? AND branch_id = ?", promotionId, ALEX)!.n;
    for (const [label, caller] of restricted()) {
      const mine = (await caller("GET", "/promotions/report")).body as any[];
      for (const row of mine) expect(row.usageCount, `${label} ${row.id}`).toBeLessThanOrEqual(grantedInBranch(row.id));
    }
  });
});

describe("D111 round 3 · a branch user does not rewrite what prices every branch", () => {
  const restricted = (): readonly (readonly [label: string, caller: Caller])[] => [
    ["non-admin", alex],
    ["* admin granted one branch", alexStar],
  ];
  const fingerprint = (sql: string, ...params: unknown[]) => JSON.stringify(all(sql, ...params));

  function expectFieldRefused(res: Res, field: string) {
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(403);
    expect(res.body.error).toBe("SHARED_FIELD_RESTRICTED");
    expect(res.body.message).toMatch(ARABIC);
    expect(res.body.fields).toContain(field);
  }

  it("a customer's credit limit, price list, payment terms, tax exemption and active flag are refused; its phone is not", async () => {
    const state = () => fingerprint("SELECT credit_limit, price_list_id, payment_terms_days, tax_exempt, active FROM customer WHERE id = 'CUST-DEMO-2'");
    const before = state();
    for (const [label, caller] of restricted()) {
      for (const [field, value] of [["creditLimit", "999999999"], ["priceListId", null], ["paymentTermsDays", 365], ["taxExempt", true], ["active", false]] as const) {
        expectFieldRefused(await caller("PATCH", "/customers/CUST-DEMO-2", { [field]: value }), field);
      }
      expect(state(), label).toBe(before);
      const unchanged = await caller("PATCH", "/customers/CUST-DEMO-2", { phone: "01000000001", creditLimit: "120000", paymentTermsDays: 45 });
      expect(unchanged.status, `${label} ${JSON.stringify(unchanged.body).slice(0, 200)}`).toBe(200);
      expect(one<any>("SELECT phone FROM customer WHERE id = 'CUST-DEMO-2'").phone).toBe("01000000001");
      expect(state(), label).toBe(before);
    }
  });

  it("a branch user creates a customer, but not one born with a credit limit or a price list", async () => {
    const created = await alex("POST", "/customers", { id: "R3-CUST-OK", nameAr: "عميل الفرع", creditLimit: "0", taxExempt: false, active: true });
    expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(201);
    expectFieldRefused(await alex("POST", "/customers", { id: "R3-CUST-LIMIT", nameAr: "عميل بحد", creditLimit: "5000000" }), "creditLimit");
    expectFieldRefused(await alex("POST", "/customers", { id: "R3-CUST-PL", nameAr: "عميل بقائمة", priceListId: "PL-DEMO-2" }), "priceListId");
    expect(one("SELECT id FROM customer WHERE id IN ('R3-CUST-LIMIT', 'R3-CUST-PL')")).toBeUndefined();
  });

  it("a supplier's payment terms and active flag, and an item's cost, GL accounts and status, are refused", async () => {
    const state = () =>
      fingerprint("SELECT payment_terms_days, active FROM supplier WHERE id = 'SUPP-DEMO-1'") +
      fingerprint("SELECT * FROM item WHERE id = 'ITEM-DEMO-1'");
    const before = state();
    for (const [label, caller] of restricted()) {
      expectFieldRefused(await caller("PATCH", "/suppliers/SUPP-DEMO-1", { paymentTermsDays: 365 }), "paymentTermsDays");
      expectFieldRefused(await caller("PATCH", "/suppliers/SUPP-DEMO-1", { active: false }), "active");
      for (const [field, value] of [["costPrice", "1.00"], ["revenueAccountId", "4900"], ["cogsAccountId", "5200"], ["inventoryAccountId", "1300-1"], ["status", "inactive"]] as const) {
        expectFieldRefused(await caller("PATCH", "/items/ITEM-DEMO-1", { [field]: value }), field);
      }
      expect(state(), label).toBe(before);
    }
    const described = await alex("PATCH", "/items/ITEM-DEMO-1", { description: "وصف من الفرع" });
    expect(described.status, JSON.stringify(described.body).slice(0, 200)).toBe(200);
  });

  it("price lists, promotions, bills of materials and configurable products are read-only, while pricing a line still works", async () => {
    const state = () =>
      fingerprint("SELECT COUNT(*) AS n FROM price_list") + fingerprint("SELECT COUNT(*) AS n FROM promotion") + fingerprint("SELECT id, active FROM price_list ORDER BY id");
    const before = state();
    for (const [label, caller] of restricted()) {
      const writes: readonly (readonly [method: string, path: string])[] = [
        ["POST", "/price-lists"],
        ["PATCH", "/price-lists/PL-DEMO-2"],
        ["POST", "/price-lists/PL-DEMO-2/deactivate"],
        ["POST", "/promotions"],
        ["PATCH", "/promotions/PROMO-DEMO-1"],
        ["POST", "/promotions/PROMO-DEMO-1/deactivate"],
        ["POST", "/manufacturing/boms"],
        ["POST", "/manufacturing/configurable-products"],
      ];
      for (const [method, path] of writes) {
        const res = await caller(method, path, { id: "R3-RO", nameAr: "محاولة" });
        expect(res.status, `${label} ${method} ${path}`).toBe(403);
        expect(res.body.error).toBe("COMPANY_WIDE_REPORT");
        expect(res.body.message).toMatch(ARABIC);
      }
      expect(state(), label).toBe(before);
      expect((await caller("GET", "/price-lists")).status, label).toBe(200);
      expect((await caller("GET", "/promotions")).status, label).toBe(200);
      const priced = await caller("POST", "/price-lists/resolve-price", { itemId: "ITEM-DEMO-1", customerId: "CUST-DEMO-2", qty: "1", date: TODAY });
      expect(priced.status, `${label} ${JSON.stringify(priced.body).slice(0, 200)}`).not.toBe(403);
      const evaluated = await caller("POST", "/promotions/evaluate", { date: TODAY, customerId: "CUST-DEMO-2", lines: [{ itemId: "ITEM-DEMO-1", qty: "1", unitPrice: "180" }] });
      expect(evaluated.status, `${label} ${JSON.stringify(evaluated.body).slice(0, 200)}`).not.toBe(403);
    }
  });

  it("an unrestricted admin edits all of it", async () => {
    const limit = await admin("PATCH", "/customers/CUST-DEMO-2", { creditLimit: "120000" });
    expect(limit.status, JSON.stringify(limit.body).slice(0, 200)).toBe(200);
    expect((await admin("PATCH", "/items/ITEM-DEMO-1", { costPrice: "140" })).status).toBe(200);
  });
});

describe("D111 round 3 · the attendance summary is the branch's own workforce", () => {
  const window = "from=2026-01-01&to=2026-12-31";
  const workedIn = (branchId: string) =>
    one<{ m: number }>(
      "SELECT COALESCE(SUM(a.worked_minutes), 0) AS m FROM hr_attendance a JOIN hr_employee e ON e.id = a.employee_id WHERE e.branch_id = ? AND a.date BETWEEN '2026-01-01' AND '2026-12-31'",
      branchId,
    )!.m;

  it("a branch user gets a summary of its own employees and none of another branch's", async () => {
    const mainEmployee = one<{ id: string }>("SELECT e.id FROM hr_employee e JOIN hr_attendance a ON a.employee_id = e.id WHERE e.branch_id = ? LIMIT 1", MAIN)!.id;
    const company = (await admin("GET", `/hr/attendance/summary?${window}`)).body;
    expect(company.daysPresent).toBeGreaterThan(0);
    const unowned = one<{ m: number }>(
      "SELECT COALESCE(SUM(a.worked_minutes), 0) AS m FROM hr_attendance a LEFT JOIN hr_employee e ON e.id = a.employee_id WHERE COALESCE(e.branch_id, '') = '' AND a.date BETWEEN '2026-01-01' AND '2026-12-31'",
    )!.m;
    for (const [caller, seesUnowned] of [[alex, false], [alexStar, true]] as const) {
      const mine = await caller("GET", `/hr/attendance/summary?${window}`);
      expect(mine.status, JSON.stringify(mine.body).slice(0, 200)).toBe(200);
      expect(mine.body.workedMinutes).toBe(workedIn(ALEX) + (seesUnowned ? unowned : 0));
      expect(mine.body.workedMinutes).toBeLessThan(company.workedMinutes);
      const named = await caller("GET", `/hr/attendance/summary?${window}&employeeId=${mainEmployee}`);
      expect(named.status).toBe(404);
      expect(named.body.message).toMatch(ARABIC);
    }
    const theirs = await mainOnly("GET", `/hr/attendance/summary?${window}`);
    expect(theirs.body.workedMinutes).toBe(workedIn(MAIN));
    expect(workedIn(MAIN) + workedIn(ALEX) + unowned).toBe(company.workedMinutes);
    expect((await mainOnly("GET", `/hr/attendance/summary?${window}&employeeId=${mainEmployee}`)).status).toBe(200);
  });
});

describe("D111 round 3 · a return's branch is read one way: its line's, else its warehouse's, else its source invoice's", () => {
  const cases = [
    ["SALES_RETURN", "/sales-returns", "R3-SRET-BY-WAREHOUSE"],
    ["PURCHASE_RETURN", "/purchase-returns", "R3-PRET-BY-WAREHOUSE"],
  ] as const;

  beforeAll(() => {
    for (const [docType, , id] of cases) {
      const source = one<any>("SELECT * FROM framework_document WHERE doc_type = ? AND status = 'draft' LIMIT 1", docType) ?? one<any>("SELECT * FROM framework_document WHERE doc_type = ? LIMIT 1", docType);
      const lines = (JSON.parse(source.lines_json) as Record<string, unknown>[]).map(({ branchId: _branch, sourceInvoiceId: _source, ...line }) => ({ ...line, warehouseId: ALEX_WAREHOUSE }));
      const columns = Object.keys(source);
      sqlite
        .prepare(`INSERT INTO framework_document (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
        .run(...columns.map((column) => (column === "id" ? id : column === "doc_no" ? null : column === "lines_json" ? JSON.stringify(lines) : column === "journal_entry_id" || column === "workflow_request_id" ? null : source[column])));
    }
  });

  for (const [, path, id] of cases) {
    it(`${path}: the list, the record and the gate agree, for a restricted session and for a narrowed one`, async () => {
      const listed = async (caller: Caller, headers?: Record<string, string>) => rowsOf((await caller("GET", `${path}?pageSize=200`, undefined, headers)).body).map((row: any) => row.id);
      expect(await listed(alex)).toContain(id);
      expect(await listed(mainOnly)).not.toContain(id);
      expect(await listed(admin, { "x-branch-scope": ALEX })).toContain(id);
      expect(await listed(admin, { "x-branch-scope": MAIN })).not.toContain(id);
      expect((await alex("GET", `${path}/${id}`)).status).toBe(200);
      expect((await mainOnly("GET", `${path}/${id}`)).status).toBe(404);
      expect((await admin("GET", `${path}/${id}`, undefined, { "x-branch-scope": ALEX })).status).toBe(200);
      expect((await admin("GET", `${path}/${id}`, undefined, { "x-branch-scope": MAIN })).status).toBe(404);
    });
  }
});

describe("D111 round 3 · a limited list is cut to the caller's rows before it is cut to the limit", () => {
  it("recurring runs: a branch user asking for one run gets its own latest, not an empty page", async () => {
    const template = one<any>("SELECT * FROM recurring_journal_template LIMIT 1");
    const lines = (JSON.parse(template.lines) as Record<string, unknown>[]).map((line) => ({ ...line, branchId: ALEX }));
    const columns = Object.keys(template);
    sqlite
      .prepare(`INSERT INTO recurring_journal_template (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .run(...columns.map((column) => (column === "id" ? "R3-RJT-ALEX" : column === "lines" ? JSON.stringify(lines) : column === "code" || column === "name_ar" ? `${template[column]}-R3` : template[column])));
    sqlite
      .prepare("INSERT INTO recurring_journal_run (id, template_id, period, journal_entry_id, generated_at, generated_by) VALUES ('R3-RUN-ALEX', 'R3-RJT-ALEX', '2020-01', 'R3-NO-ENTRY', '2020-01-31T00:00:00.000Z', 'USER-ADMIN')")
      .run();
    expect(all("SELECT id FROM recurring_journal_run").length).toBeGreaterThan(1);
    const mine = await alex("GET", "/gl/recurring/runs?limit=1");
    expect(mine.status).toBe(200);
    expect(rowsOf(mine.body).map((run: any) => run.id)).toEqual(["R3-RUN-ALEX"]);
    expect(rowsOf((await admin("GET", "/gl/recurring/runs?limit=1")).body)).toHaveLength(1);
  });
});

describe("D111 round 3 · the routes the review did not drive", () => {
  const everythingButUnattributed = () => ALL_PERMISSION_CODES.filter((code) => code !== VIEW_UNATTRIBUTED);
  const NOT_FOUND_BODY = { error: "NOT_FOUND", message: "المستند غير موجود أو يخص فرعًا خارج صلاحيتك." };

  it("bank reconciliation: a statement line cannot be matched against another branch's journal entries", async () => {
    const statement = one<{ id: string }>("SELECT id FROM bank_statement LIMIT 1")!.id;
    const line = one<{ id: string }>("SELECT id FROM statement_line WHERE statement_id = ? LIMIT 1", statement)!.id;
    const foreignEntry = one<{ id: string }>("SELECT entry_id AS id FROM journal_line WHERE branch_id = ? LIMIT 1", ALEX)!.id;
    const matched = () => JSON.stringify(all("SELECT * FROM statement_line WHERE id = ?", line));
    const before = matched();
    const many = await mainOnly("POST", `/bank-statements/${statement}/lines/${line}/match-many`, { entryIds: [foreignEntry] });
    expect(many.status, JSON.stringify(many.body).slice(0, 200)).toBe(404);
    expect(many.body).toMatchObject(NOT_FOUND_BODY);
    const single = await mainOnly("POST", `/bank-statements/${statement}/lines/${line}/match`, { entryId: foreignEntry });
    expect(single.status, JSON.stringify(single.body).slice(0, 200)).toBe(404);
    expect(single.body).toMatchObject(NOT_FOUND_BODY);
    expect(matched()).toBe(before);
  });

  it("an advance's cash repayment: not on another branch's advance, and not into another branch's drawer", async () => {
    const advance = one<{ id: string }>("SELECT a.id FROM hr_employee_advance a JOIN hr_employee e ON e.id = a.employee_id WHERE e.branch_id = ? LIMIT 1", MAIN)!.id;
    const state = () => JSON.stringify(all("SELECT * FROM hr_employee_advance WHERE id = ?", advance)) + one<{ n: number }>("SELECT COUNT(*) AS n FROM voucher")!.n;
    const before = state();
    const repay = (treasuryAccountId: string, branchId: string) => ({ repaymentId: `R3-REPAY-${treasuryAccountId}`, amount: "1.00", treasuryAccountId, branchId, date: TODAY });
    for (const caller of [alex, alexStar]) {
      expectRefusedInArabic(await caller("POST", `/hr/advances/${advance}/repay`, repay("TR-DEMO-CASH-ALEX", ALEX)));
      expect((await caller("GET", `/hr/advances/${advance}/repayable`)).status).toBe(404);
    }
    const intoForeignDrawer = await mainOnly("POST", `/hr/advances/${advance}/repay`, repay("TR-DEMO-CASH-ALEX", MAIN));
    expect(intoForeignDrawer.status).toBe(403);
    expect(intoForeignDrawer.body.error).toBe("BRANCH_OUT_OF_SCOPE");
    const underForeignBranch = await mainOnly("POST", `/hr/advances/${advance}/repay`, repay("TR-DEMO-CASH", ALEX));
    expect(underForeignBranch.status).toBe(403);
    expect(state()).toBe(before);
  });

  it("a session granted one warehouse cannot raise a document on another, whatever branches it holds", async () => {
    const granted = "WH-DEMO-2";
    const sessions: readonly (readonly [label: string, caller: Caller])[] = [
      ["every branch", callerFor(handle.sessions.issue({ userId: "USER-R3-WH-ALL", permissions: everythingButUnattributed(), roleCode: null, branchScope: ALL_SCOPE, warehouseScope: [granted] }))],
      ["one branch", callerFor(handle.sessions.issue({ userId: "USER-R3-WH-MAIN", permissions: everythingButUnattributed(), roleCode: null, branchScope: [MAIN], warehouseScope: [granted] }))],
      ["* admin", callerFor(handle.sessions.issue({ userId: "USER-R3-WH-STAR", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: [granted] }))],
    ];
    for (const [label, caller] of sessions) {
      const id = `R3-WH-${label.length}`;
      const refused = await caller("POST", "/sales-invoices", salesInvoice(id, MAIN, MAIN_WAREHOUSE));
      expect(refused.status, `${label} ${JSON.stringify(refused.body).slice(0, 200)}`).toBe(403);
      expect(refused.body.error).toBe("WAREHOUSE_OUT_OF_SCOPE");
      expect(refused.body.message).toMatch(ARABIC);
      expect(one("SELECT id FROM sales_invoice WHERE id = ?", id)).toBeUndefined();
      expect((await caller("POST", "/purchases/invoices", purchaseInvoice(`${id}-PI`, MAIN, MAIN_WAREHOUSE))).status, label).toBe(403);
      const allowed = await caller("POST", "/sales-invoices", salesInvoice(`${id}-OK`, MAIN, granted));
      expect(allowed.status, `${label} ${JSON.stringify(allowed.body).slice(0, 200)}`).toBe(201);
    }
  });
});

describe("D111 round 3 · the chips above a branch user's list count that user's rows", () => {
  it("installment plans, collection follow-ups and leave requests answer their counts and stats from the caller's branch", async () => {
    const lists: readonly (readonly [list: string, counts: string, totalKey: string])[] = [
      ["/installments/plans", "/installments/plans/counts", "all"],
      ["/installments/follow-ups", "/installments/follow-ups/counts", "all"],
      ["/hr/leave-requests", "/hr/leave-requests/counts", "total"],
    ];
    for (const [list, counts, totalKey] of lists) {
      for (const caller of [alex, alexStar, mainOnly]) {
        const rows = rowsOf((await caller("GET", list)).body);
        const chips = await caller("GET", counts);
        expect(chips.status, counts).toBe(200);
        expect(chips.body[totalKey], counts).toBe(rows.length);
      }
      expect((await admin("GET", counts)).body[totalKey], counts).toBeGreaterThan(rowsOf((await alex("GET", list)).body).length);
    }
    for (const stats of ["/installments/plans/stats", "/installments/follow-ups/stats"]) {
      const mine = await alex("GET", stats);
      expect(mine.status, stats).toBe(200);
      expect(JSON.stringify(mine.body), stats).not.toBe(JSON.stringify((await admin("GET", stats)).body));
    }
  });
});

describe("D111 round 4 · a create cannot take over another branch's record by naming its id", () => {
  interface Takeover {
    readonly route: string;
    readonly schema: SampledSchema;
    readonly table: string;
    readonly foreignIdSql: string;
  }
  const TAKEOVERS: readonly Takeover[] = [
    { route: "/treasury-accounts", schema: contracts.createTreasuryAccountSchema, table: "treasury_account", foreignIdSql: "SELECT id FROM treasury_account WHERE id = 'TR-DEMO-BANK'" },
    { route: "/field/vans", schema: contracts.createVanSchema, table: "van", foreignIdSql: "SELECT id FROM van WHERE branch_id = 'BR-MAIN' LIMIT 1" },
    { route: "/field/van-trips", schema: contracts.openVanTripSchema, table: "van_trip", foreignIdSql: "SELECT id FROM van_trip WHERE branch_id = 'BR-MAIN' LIMIT 1" },
    { route: "/crm/opportunities", schema: contracts.createOpportunitySchema, table: "crm_opportunity", foreignIdSql: "SELECT id FROM crm_opportunity WHERE id = 'OPP-DEMO-7'" },
    { route: "/hr/payroll/runs", schema: contracts.createPayrollRunSchema, table: "hr_payroll_run", foreignIdSql: "SELECT id FROM hr_payroll_run WHERE id = 'PR-DEMO-3'" },
    { route: "/cheques", schema: contracts.createChequeSchema, table: "cheque", foreignIdSql: "SELECT id FROM cheque WHERE branch_id = 'BR-MAIN' LIMIT 1" },
    { route: "/vouchers", schema: contracts.createVoucherSchema, table: "voucher", foreignIdSql: "SELECT id FROM voucher WHERE branch_id = 'BR-MAIN' LIMIT 1" },
    { route: "/sales-invoices", schema: contracts.createSalesInvoiceSchema, table: "sales_invoice", foreignIdSql: "SELECT id FROM sales_invoice WHERE branch_id = 'BR-MAIN' LIMIT 1" },
  ];
  const alexReferences = { branchId: ALEX, warehouseId: ALEX_WAREHOUSE, treasuryAccountId: "TR-DEMO-CASH-ALEX", customerId: "CUST-DEMO-2", currency: "EGP", date: TODAY };
  const rowOf = (table: string, id: string) => JSON.stringify(one(`SELECT * FROM "${table}" WHERE id = ?`, id));
  const journalCount = () => one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n;

  it.each(TAKEOVERS)("$route — a branch user and a * admin granted one branch are told nothing is there, and the row is untouched", async ({ route, schema, table, foreignIdSql }) => {
    const id = one<{ id: string }>(foreignIdSql)!.id;
    const body = sampleOf(schema, { ...alexReferences, id });
    for (const caller of [alex, alexStar]) {
      const before = rowOf(table, id);
      const entries = journalCount();
      const res = await caller("POST", route, body);
      expect(res.status, `${route} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(404);
      expect(res.body?.error).toBe("NOT_FOUND");
      expect(res.body?.message).toMatch(ARABIC);
      expect(JSON.stringify(res.body)).not.toContain(MAIN);
      expect(rowOf(table, id)).toBe(before);
      expect(journalCount()).toBe(entries);
    }
  });

  it.each(TAKEOVERS)("$route — the refusal is the one an id nobody holds draws when it is named as a reference", async ({ route, schema, foreignIdSql }) => {
    const id = one<{ id: string }>(foreignIdSql)!.id;
    const taken = await alex("POST", route, sampleOf(schema, { ...alexReferences, id }));
    const unknownReference = await alex("POST", "/sales-returns", { id: "D111-R4-UNKNOWN-REF", date: TODAY, sourceInvoiceId: "D111-R4-NO-SUCH-INVOICE", lines: [] });
    expect(taken.status).toBe(unknownReference.status);
    expect(taken.body).toEqual(unknownReference.body);
  });

  it.each(TAKEOVERS)("$route — a user granted both branches is told the id is taken, and the row is untouched", async ({ route, schema, table, foreignIdSql }) => {
    const id = one<{ id: string }>(foreignIdSql)!.id;
    const before = rowOf(table, id);
    const entries = journalCount();
    const res = await bothBranches("POST", route, sampleOf(schema, { ...alexReferences, id }));
    expect(res.status, `${route} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(409);
    expect(res.body?.error).toBe(RecordErrorCode.DuplicateId);
    expect(res.body?.message).toMatch(ARABIC);
    expect(rowOf(table, id)).toBe(before);
    expect(journalCount()).toBe(entries);
  });

  it("a branch user is told its own branch's id is taken", async () => {
    const before = rowOf("treasury_account", "TR-DEMO-CASH-ALEX");
    const res = await alex("POST", "/treasury-accounts", sampleOf(contracts.createTreasuryAccountSchema, { ...alexReferences, id: "TR-DEMO-CASH-ALEX" }));
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe(RecordErrorCode.DuplicateId);
    expect(rowOf("treasury_account", "TR-DEMO-CASH-ALEX")).toBe(before);
  });

  it("a shared cost centre cannot be renamed through the create route by any session", async () => {
    const before = rowOf("cost_center", "CC-DEMO-1");
    for (const caller of [alex, alexStar, bothBranches, admin]) {
      const res = await caller("POST", "/cost-centers", sampleOf(contracts.createCostCenterSchema, { id: "CC-DEMO-1" }));
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(409);
      expect(res.body?.error).toBe(RecordErrorCode.DuplicateId);
      expect(rowOf("cost_center", "CC-DEMO-1")).toBe(before);
    }
  });

  it("the HQ bank stays out of a branch user's reach after the attempt", async () => {
    await alex("POST", "/treasury-accounts", { id: "TR-DEMO-BANK", code: "R4-TAKEOVER", name: "استيلاء", type: "bank", branchId: ALEX });
    expect(one<{ branch_id: string; gl_account_id: string }>("SELECT branch_id, gl_account_id FROM treasury_account WHERE id = 'TR-DEMO-BANK'")).toEqual({ branch_id: MAIN, gl_account_id: "1310" });
    const paid = await alex("POST", "/vouchers", { ...voucher("D111-R4-PAY", ALEX, "TR-DEMO-BANK", "1310"), voucherType: "supplier_payment", amount: "5000.00" });
    expect([403, 404]).toContain(paid.status);
    expect(one("SELECT id FROM voucher WHERE id = 'D111-R4-PAY'")).toBeUndefined();
  });
});

describe("D111 round 4 · a cheque and the entry that receives it are one write", () => {
  const cheque = (id: string, chequeNumber: string) => ({
    id,
    direction: "incoming",
    chequeNumber,
    bankName: "بنك الاختبار",
    amount: "3100.00",
    issueDate: TODAY,
    dueDate: TODAY,
    branchId: ALEX,
    partyId: "CUST-DEMO-2",
    counterpartyGlAccountId: "1105",
    controlAccounts: { underCollectionAccountId: "1320", payableAccountId: "2140" },
  });
  const receivable = () => one<{ net: number }>("SELECT COALESCE(SUM(debit - credit), 0) AS net FROM journal_line WHERE account_id = '1105'")!.net;

  it("a cheque whose row cannot be stored leaves no journal entry behind", async () => {
    sqlite.exec("CREATE TRIGGER d111_r4_refuse_cheque BEFORE INSERT ON cheque WHEN NEW.id = 'D111-R4-ATOMIC' BEGIN SELECT RAISE(ABORT, 'forced failure after posting'); END");
    try {
      const entries = one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n;
      const owed = receivable();
      const res = await admin("POST", "/cheques", cheque("D111-R4-ATOMIC", "D111-R4-0001"));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(one("SELECT id FROM cheque WHERE id = 'D111-R4-ATOMIC'")).toBeUndefined();
      expect(one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n).toBe(entries);
      expect(receivable()).toBe(owed);
    } finally {
      sqlite.exec("DROP TRIGGER d111_r4_refuse_cheque");
    }
  });

  it("a cheque under an id already on the register is refused before anything posts", async () => {
    const existing = one<{ id: string }>("SELECT id FROM cheque WHERE branch_id = ? LIMIT 1", MAIN)!;
    const entries = one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n;
    const owed = receivable();
    const res = await admin("POST", "/cheques", { ...cheque(existing.id, "D111-R4-0002"), branchId: MAIN });
    expect(res.status).toBe(409);
    expect(res.body?.error).toBe(RecordErrorCode.DuplicateId);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n).toBe(entries);
    expect(receivable()).toBe(owed);
    const reconciliation = await admin("GET", "/reconciliation");
    expect(reconciliation.body.rows.filter((row: any) => !row.matched)).toEqual([]);
  });
});
