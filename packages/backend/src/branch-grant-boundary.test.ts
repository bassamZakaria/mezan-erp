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
  const session = async (userId: string, permissions: readonly string[], branchScope: typeof ALL_SCOPE | string[]) =>
    callerFor(await handle.sessions.issue({ userId, permissions, roleCode: null, branchScope, warehouseScope: ALL_SCOPE }));
  admin = (await session("USER-ADMIN", ["*"], ALL_SCOPE));
  alex = (await session("USER-D111-ALEX", everythingButUnattributed, [ALEX]));
  alexWithUnattributed = (await session("USER-D111-ALEX-U", [...everythingButUnattributed, VIEW_UNATTRIBUTED], [ALEX]));
  mainOnly = (await session("USER-D111-MAIN", everythingButUnattributed, [MAIN]));
  alexStar = (await session("USER-D111-ALEX-STAR", ["*"], [ALEX]));
  bothBranches = (await session("USER-D111-BOTH", everythingButUnattributed, [MAIN, ALEX]));
  bothBranchesWithUnattributed = (await session("USER-D111-BOTH-U", [...everythingButUnattributed, VIEW_UNATTRIBUTED], [MAIN, ALEX]));
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

  it("refuses to reverse an unattributed entry it may not read, and still refuses once «غير مخصص» is held — that permission reads, it does not write", async () => {
    expect((await admin("POST", "/gl/journal-entries", journal("D111-JE-COMPANY-2", null))).status).toBe(201);
    expectRefusedInArabic(await alex("POST", "/gl/journal-entries/D111-JE-COMPANY-2/reverse", {}));
    expect(statusOf("D111-JE-COMPANY-2")).toBe("posted");
    expect((await alexWithUnattributed("GET", "/gl/journal-entries/D111-JE-COMPANY-2")).status).toBe(200);
    const refused = await alexWithUnattributed("POST", "/gl/journal-entries/D111-JE-COMPANY-2/reverse", {});
    expect(refused.status).toBe(404);
    expectRefusedInArabic(refused);
    expect(statusOf("D111-JE-COMPANY-2")).toBe("posted");
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
    expect(Object.keys(res.body.branches[0]).sort()).toEqual(["active", "code", "id", "isMain", "name"]);
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
    const raised = await admin("POST", "/assets/depreciation/runs", { period: "2026-08", branchId: MAIN });
    expect(raised.status, JSON.stringify(raised.body).slice(0, 200)).toBe(201);
    const booked = await admin("POST", `/assets/depreciation/runs/${raised.body.id}/post`, {});
    expect(booked.status, JSON.stringify(booked.body).slice(0, 200)).toBe(200);
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

    const sameBranch = await admin("POST", "/vouchers", voucher("D111-R2-V-ADMIN-OK", ALEX, "TR-DEMO-CASH-ALEX", "1300-ALEX"));
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
        `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS net FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id JOIN account a ON a.id = l.account_id WHERE e.status IN ('posted', 'reversed') AND a.type = 'asset' AND a.is_header = 0 AND (a.id IN (SELECT gl_account_id FROM treasury_account WHERE gl_account_id IS NOT NULL) OR (a.parent_id = '1300' AND a.id <> '1340')) AND ${where}`,
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
        const opened = await caller("GET", `/gl/journal-entries/${activity.id}`);
        expect(opened.status, `${label} ${activity.id}`).toBe(200);
        expect(opened.body.lines.length, `${label} ${activity.id}`).toBeGreaterThan(0);
        expect(opened.body.lines.filter((line: { branchId: string | null }) => line.branchId !== ALEX && line.branchId !== null), `${label} ${activity.id}`).toEqual([]);
      }
    }
    const pendingEverywhere = (await admin("GET", "/workflow/requests/pending-count")).body.count;
    expect(pendingEverywhere).toBeGreaterThan(0);
    expect((await alexStar("GET", "/workflow/requests/pending-count")).body.count).toBe(rowsOf((await alexStar("GET", "/workflow/requests/pending")).body).length);
    expect((await alexStar("GET", "/workflow/requests/pending-count")).body.count).toBeLessThan(pendingEverywhere);
    for (const [label, caller] of [["admin", admin], ...restricted()] as const) {
      const counts = await caller("GET", "/workflow/requests/counts");
      expect(counts.status, label).toBe(200);
      for (const scope of ["mine", "acted"] as const) {
        const everyRow: unknown[] = [];
        for (let page = 1; ; page += 1) {
          const rows = rowsOf((await caller("GET", `/workflow/requests/${scope}?page=${page}&pageSize=200`)).body);
          everyRow.push(...rows);
          if (rows.length < 200) break;
        }
        expect(counts.body[scope], `${label} ${scope}`).toBe(everyRow.length);
        const firstPage = rowsOf((await caller("GET", `/workflow/requests/${scope}?page=1&pageSize=2`)).body);
        expect(firstPage.length, `${label} ${scope} page`).toBe(Math.min(2, everyRow.length));
      }
    }
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

    const { branchId: _omitted, ...headerless } = voucher("D111-R2-V-DEFAULT", ALEX, "TR-DEMO-CASH-ALEX", "1300-ALEX");
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
    const live = callerFor(await handle.sessions.issue({ userId: holder, permissions: ["sales.invoice.view"], roleCode: "D111_R2_ROLE", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }));
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
    branchAdmin = callerFor(await handle.sessions.issue({ userId: BRANCH_ADMIN, permissions: ["*"], roleCode: null, branchScope: [ALEX], warehouseScope: ALL_SCOPE }));
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

  const expectNotThere = (res: Res) => {
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(404);
    expect(res.body?.error).toBe("USER_NOT_FOUND");
    expect(res.body?.message).toMatch(ARABIC);
  };

  it("cannot set the PIN or password of an account that reaches further than it does: that account is not there for it", async () => {
    const before = stored(HQ_ACCOUNTANT);
    const edit = account("r3-hq-accountant@cyag.example", { roleId, branchScope: ALL_SCOPE, password: undefined });
    expectNotThere(await branchAdmin("PUT", `/users/${HQ_ACCOUNTANT}`, { ...edit, pin: "432100" }));
    expectNotThere(await branchAdmin("PUT", `/users/${HQ_ACCOUNTANT}`, { ...edit, password: "an-attackers-password" }));
    expect(stored(HQ_ACCOUNTANT)).toEqual(before);
  });

  it("cannot change the role of, make an administrator of, deactivate, reactivate or unlock such an account", async () => {
    const before = stored(HQ_ACCOUNTANT);
    const otherRole = one<{ id: string }>("SELECT id FROM role WHERE id <> ? LIMIT 1", roleId)!.id;
    expectNotThere(await branchAdmin("PUT", `/users/${HQ_ACCOUNTANT}`, account("r3-hq-accountant@cyag.example", { roleId: otherRole, branchScope: [ALEX], password: undefined })));
    expectNotThere(await branchAdmin("PUT", `/users/${HQ_ACCOUNTANT}`, account("r3-hq-accountant@cyag.example", { isCompanyAdmin: true, branchScope: [ALEX], password: undefined })));
    for (const action of ["deactivate", "activate", "unlock"]) {
      expectNotThere(await branchAdmin("POST", `/users/${HQ_ACCOUNTANT}/${action}`, {}));
    }
    expect(stored(HQ_ACCOUNTANT)).toEqual(before);
    expectNotThere(await branchAdmin("POST", "/users/USER-ADMIN/deactivate", {}));
    expect(stored("USER-ADMIN").status).toBe("active");
  });

  it("the attempt on an account it cannot see is still written to the audit trail", async () => {
    const attempts = () => one<{ n: number }>("SELECT count(*) AS n FROM audit_event WHERE action = 'PRIVILEGE_ESCALATION_DENIED' AND entity_id = ?", HQ_ACCOUNTANT)!.n;
    const before = attempts();
    expectNotThere(await branchAdmin("POST", `/users/${HQ_ACCOUNTANT}/deactivate`, {}));
    expect(attempts()).toBe(before + 1);
    expectNotThere(await branchAdmin("GET", `/users/${HQ_ACCOUNTANT}`));
    expect(attempts()).toBe(before + 1);
  });

  it("is refused the same way when it is a non-admin holding every permission", async () => {
    const before = stored(HQ_ACCOUNTANT);
    expectNotThere(await alex("PUT", `/users/${HQ_ACCOUNTANT}`, account("r3-hq-accountant@cyag.example", { roleId, branchScope: ALL_SCOPE, password: undefined, pin: "432100" })));
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
    expect(one<any>("SELECT name, branch_id FROM treasury_account WHERE id = ?", HQ_BANK)).toEqual({ name: "حساب المركز الرئيسي", branch_id: null });
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

  it("the stock-levels summary is the same figures as the stock-levels list the caller can see", async () => {
    const warehouseOnly = callerFor(
      await handle.sessions.issue({ userId: "USER-D111-WH-ALEX", permissions: ["inventory.stock.view"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: [ALEX_WAREHOUSE] }),
    );
    const figures = async (caller: Caller) => {
      const summary = await caller("GET", "/reports/inventory/stock-levels/summary");
      const list = await caller("GET", "/reports/inventory/stock-levels");
      expect(summary.status).toBe(200);
      expect(list.status).toBe(200);
      return { summary: summary.body, rows: list.body.rows as any[], value: list.body.kpis.find((kpi: any) => kpi.key === "value").value };
    };
    const company = await figures(admin);
    for (const [label, caller] of [...restricted(), ["one warehouse", warehouseOnly]] as const) {
      const { summary, rows, value } = await figures(caller);
      const attention = rows.filter((row) => row.status !== contracts.StockLevelStatusDTO.Normal);
      const low = rows.filter((row) => row.status === contracts.StockLevelStatusDTO.Low);
      expect(Number(summary.totalValue), label).toBeCloseTo(Number(value), 4);
      expect(summary.needsAttentionCount, label).toBe(attention.length);
      expect(summary.lowCount, label).toBe(low.length);
      expect(summary.attention.map((row: any) => row.itemId), label).toEqual(attention.slice(0, summary.attention.length).map((row) => row.itemId));
      expect(summary.firstLow?.itemId ?? null, label).toBe(low[0]?.itemId ?? null);
      expect(Number(summary.totalValue), label).toBeLessThan(Number(company.summary.totalValue));
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
      ["every branch", callerFor(await handle.sessions.issue({ userId: "USER-R3-WH-ALL", permissions: everythingButUnattributed(), roleCode: null, branchScope: ALL_SCOPE, warehouseScope: [granted] }))],
      ["one branch", callerFor(await handle.sessions.issue({ userId: "USER-R3-WH-MAIN", permissions: everythingButUnattributed(), roleCode: null, branchScope: [MAIN], warehouseScope: [granted] }))],
      ["* admin", callerFor(await handle.sessions.issue({ userId: "USER-R3-WH-STAR", permissions: ["*"], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: [granted] }))],
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
    readonly valid?: (sampled: Record<string, unknown>, id: string) => Record<string, unknown>;
  }
  const TAKEOVERS: readonly Takeover[] = [
    { route: "/field/vans", schema: contracts.createVanSchema, table: "van", foreignIdSql: "SELECT id FROM van WHERE branch_id = 'BR-MAIN' LIMIT 1" },
    { route: "/field/van-trips", schema: contracts.openVanTripSchema, table: "van_trip", foreignIdSql: "SELECT id FROM van_trip WHERE branch_id = 'BR-MAIN' LIMIT 1", valid: (sampled) => ({ ...sampled, vanId: undefined, vanWarehouseId: ALEX_WAREHOUSE }) },
    { route: "/crm/opportunities", schema: contracts.createOpportunitySchema, table: "crm_opportunity", foreignIdSql: "SELECT id FROM crm_opportunity WHERE id = 'OPP-DEMO-7'" },
    { route: "/hr/payroll/runs", schema: contracts.createPayrollRunSchema, table: "hr_payroll_run", foreignIdSql: "SELECT id FROM hr_payroll_run WHERE id = 'PR-DEMO-3'", valid: (sampled) => ({ ...sampled, year: 2099, month: 1 }) },
    { route: "/cheques", schema: contracts.createChequeSchema, table: "cheque", foreignIdSql: "SELECT id FROM cheque WHERE branch_id = 'BR-MAIN' LIMIT 1",
      valid: (sampled) => ({ ...sampled, issueDate: TODAY, dueDate: TODAY, chequeNumber: "D111-R4-0099", bankName: "بنك مصر", partyId: "CUST-DEMO-2", counterpartyGlAccountId: "1105", controlAccounts: { underCollectionAccountId: "1320", bouncedAccountId: "1360" } }),
    },
    { route: "/vouchers", schema: contracts.createVoucherSchema, table: "voucher", foreignIdSql: "SELECT id FROM voucher WHERE branch_id = 'BR-MAIN' AND id NOT LIKE '%:%' LIMIT 1", valid: (sampled) => ({ ...sampled, partyId: "CUST-DEMO-2", counterpartyGlAccountId: "1105" }) },
    { route: "/sales-invoices", schema: contracts.createSalesInvoiceSchema, table: "sales_invoice", foreignIdSql: "SELECT id FROM sales_invoice WHERE branch_id = 'BR-MAIN' LIMIT 1", valid: (_sampled, id) => salesInvoice(id, ALEX, ALEX_WAREHOUSE) },
  ];
  const storedReferences = () => ({
    branchId: ALEX,
    warehouseId: ALEX_WAREHOUSE,
    treasuryAccountId: "TR-DEMO-CASH-ALEX",
    customerId: "CUST-DEMO-2",
    vanId: one<{ id: string }>("SELECT id FROM van ORDER BY id LIMIT 1")!.id,
    employeeId: one<{ id: string }>("SELECT id FROM hr_employee ORDER BY id LIMIT 1")!.id,
    sourceWarehouseId: MAIN_WAREHOUSE,
    sourceTreasuryAccountId: "TR-DEMO-CASH",
    vanWarehouseId: "WH-DEMO-VAN",
    vanTreasuryAccountId: "TR-DEMO-VAN",
    currency: "EGP",
    date: TODAY,
  });
  const rowOf = (table: string, id: string) => JSON.stringify(one(`SELECT * FROM "${table}" WHERE id = ?`, id));
  const journalCount = () => one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n;

  it.each(TAKEOVERS)("$route — a branch user and a * admin granted one branch are told nothing is there, and the row is untouched", async ({ route, schema, table, foreignIdSql }) => {
    const id = one<{ id: string }>(foreignIdSql)!.id;
    const body = sampleOf(schema, { ...storedReferences(), id });
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
    const taken = await alex("POST", route, sampleOf(schema, { ...storedReferences(), id }));
    const unknownReference = await alex("POST", "/sales-returns", { id: "D111-R4-UNKNOWN-REF", date: TODAY, sourceInvoiceId: "D111-R4-NO-SUCH-INVOICE", lines: [] });
    expect(taken.status).toBe(unknownReference.status);
    expect(taken.body).toEqual(unknownReference.body);
  });

  it.each(TAKEOVERS)("$route — a user granted both branches is told the id is taken, and the row is untouched", async ({ route, schema, table, foreignIdSql, valid }) => {
    const id = one<{ id: string }>(foreignIdSql)!.id;
    const before = rowOf(table, id);
    const entries = journalCount();
    const sampled = sampleOf(schema, { ...storedReferences(), id }) as Record<string, unknown>;
    const res = await bothBranches("POST", route, valid ? valid(sampled, id) : sampled);
    expect(res.status, `${route} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(409);
    expect(res.body?.error).toBe(RecordErrorCode.DuplicateId);
    expect(res.body?.message).toMatch(ARABIC);
    expect(rowOf(table, id)).toBe(before);
    expect(journalCount()).toBe(entries);
  });

  it("a treasury account is head office's to open: a branch session draws one refusal whoever holds the id it names", async () => {
    const answers = new Set<string>();
    for (const caller of [alex, alexStar, bothBranches]) {
      for (const id of ["TR-DEMO-CASH-ALEX", "TR-DEMO-BANK", "D111-R5-TR-FREE"]) {
        const before = rowOf("treasury_account", id);
        const res = await caller("POST", "/treasury-accounts", sampleOf(contracts.createTreasuryAccountSchema, { ...storedReferences(), id }));
        expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(403);
        expect(res.body?.error).toBe("HEAD_OFFICE_CREATES_ONLY");
        expect(res.body?.message).toMatch(ARABIC);
        expect(rowOf("treasury_account", id)).toBe(before);
        answers.add(JSON.stringify(res.body));
      }
    }
    expect(answers.size).toBe(1);
  });

  it("a shared cost centre cannot be renamed through the create route by any session", async () => {
    const before = rowOf("cost_center", "CC-DEMO-1");
    for (const caller of [bothBranches, admin]) {
      const res = await caller("POST", "/cost-centers", sampleOf(contracts.createCostCenterSchema, { id: "CC-DEMO-1" }));
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(409);
      expect(res.body?.error).toBe(RecordErrorCode.DuplicateId);
      expect(rowOf("cost_center", "CC-DEMO-1")).toBe(before);
    }
  });

  it("a shared record another branch owns is not confirmed to exist by a create that names its id", async () => {
    expect((await admin("POST", "/customers", { id: "ZZ-D111-R5-CUST-MAIN", nameAr: "عميل الفرع الرئيسي", branchId: MAIN })).status).toBe(201);
    expect((await admin("POST", "/suppliers", { id: "ZZ-D111-R5-SUPP-MAIN", nameAr: "مورد الفرع الرئيسي" })).status).toBe(201);
    sqlite.prepare("UPDATE supplier SET branch_id = ? WHERE id = 'ZZ-D111-R5-SUPP-MAIN'").run(MAIN);
    const unknownReference = await alex("POST", "/sales-returns", { id: "D111-R5-UNKNOWN-REF", date: TODAY, sourceInvoiceId: "D111-R5-NO-SUCH-INVOICE", lines: [] });
    const owned: (readonly [route: string, table: string, id: string, body: Record<string, unknown>])[] = [
      ["/cost-centers", "cost_center", "CC-DEMO-1", sampleOf(contracts.createCostCenterSchema, { id: "CC-DEMO-1" }) as Record<string, unknown>],
      ["/customers", "customer", "ZZ-D111-R5-CUST-MAIN", { id: "ZZ-D111-R5-CUST-MAIN", nameAr: "استيلاء" }],
      ["/suppliers", "supplier", "ZZ-D111-R5-SUPP-MAIN", { id: "ZZ-D111-R5-SUPP-MAIN", nameAr: "استيلاء" }],
    ];
    for (const [route, table, id, body] of owned) {
      const before = rowOf(table, id);
      for (const caller of [alex, alexStar]) {
        const res = await caller("POST", route, body);
        expect(res.status, `${route} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(404);
        expect(res.body).toEqual(unknownReference.body);
        expect(rowOf(table, id)).toBe(before);
      }
    }
  });

  it("a shared record no branch owns is every branch's to read, so its id is simply taken", async () => {
    const company = one<{ id: string }>("SELECT id FROM cost_center WHERE branch_id IS NULL OR branch_id = '' LIMIT 1")!.id;
    const res = await alex("POST", "/cost-centers", sampleOf(contracts.createCostCenterSchema, { id: company }));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(409);
    expect(res.body?.error).toBe(RecordErrorCode.DuplicateId);
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
    expect(res.body?.error).toBe(contracts.IdempotencyRefusal.KeyReused);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n).toBe(entries);
    expect(receivable()).toBe(owed);
    const reconciliation = await admin("GET", "/reconciliation");
    expect(reconciliation.body.rows.filter((row: any) => !row.matched)).toEqual([]);
  });
});

describe("D111 round 4 · a notification reaches only the people whose branch grant covers its document", () => {
  const CASH_FORECAST = "treasury.cash_forecast.view";
  const recipients: Record<string, { id: string; read: Caller }> = {};

  const settled = async (documentNumber: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (one("SELECT 1 FROM notification WHERE payload_json LIKE ?", `%${documentNumber}%`)) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const received = async (who: string, needle: string) => {
    const res = await recipients[who]!.read("GET", "/notifications?limit=200");
    expect(res.status).toBe(200);
    return rowsOf(res.body).some((notification: any) => JSON.stringify(notification).includes(needle));
  };
  const confirmedInvoice = async (id: string, branchId: string, warehouseId: string): Promise<string> => {
    expect((await admin("POST", "/sales-invoices", salesInvoice(id, branchId, warehouseId))).status).toBe(201);
    const confirmed = await admin("POST", `/sales-invoices/${id}/confirm`, {});
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 200)).toBe(200);
    const documentNumber = one<{ doc_no: string }>("SELECT doc_no FROM sales_invoice WHERE id = ?", id)!.doc_no;
    await settled(documentNumber);
    return documentNumber;
  };

  beforeAll(async () => {
    const role = async (code: string, permissions: string[]) => {
      const res = await admin("POST", "/roles", { code, name: code, permissions });
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(201);
      return res.body.id as string;
    };
    const plain = await role("D111_R4_NOTIFY", ["sales.invoice.view", CASH_FORECAST]);
    const withUnattributed = await role("D111_R4_NOTIFY_U", ["sales.invoice.view", CASH_FORECAST, VIEW_UNATTRIBUTED]);
    const user = async (key: string, roleId: string | null, isCompanyAdmin: boolean, branchScope: typeof ALL_SCOPE | string[], permissions: readonly string[]) => {
      const res = await admin("POST", "/users", {
        nameAr: `مستلم ${key}`,
        email: `d111-r4-${key.toLowerCase()}@cyag.example`,
        roleId,
        isCompanyAdmin,
        branchScope,
        warehouseScope: ALL_SCOPE,
        password: "Passw0rd!x",
        acknowledge: true,
        reason: "اختبار حدود الإشعارات",
      });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
      const id = res.body.id as string;
      recipients[key] = { id, read: callerFor(await handle.sessions.issue({ userId: id, permissions, roleCode: null, branchScope, warehouseScope: ALL_SCOPE })) };
    };
    await user("alex", plain, false, [ALEX], ["sales.invoice.view", CASH_FORECAST]);
    await user("alexUnattributed", withUnattributed, false, [ALEX], ["sales.invoice.view", CASH_FORECAST, VIEW_UNATTRIBUTED]);
    await user("main", plain, false, [MAIN], ["sales.invoice.view", CASH_FORECAST]);
    await user("everywhere", plain, false, ALL_SCOPE, ["sales.invoice.view", CASH_FORECAST]);
    await user("alexAdmin", null, true, [ALEX], ["*"]);
  });

  it("another branch's confirmed invoice — its number, amount and customer — reaches nobody restricted to a different branch", async () => {
    const documentNumber = await confirmedInvoice("D111-R4-NOTIFY-MAIN", MAIN, MAIN_WAREHOUSE);
    expect(await received("main", documentNumber)).toBe(true);
    expect(await received("everywhere", documentNumber)).toBe(true);
    for (const who of ["alex", "alexUnattributed", "alexAdmin"]) expect(await received(who, documentNumber), who).toBe(false);
    const stored = all<{ recipient_user_id: string }>("SELECT recipient_user_id FROM notification WHERE payload_json LIKE ?", `%${documentNumber}%`).map((row) => row.recipient_user_id);
    for (const who of ["alex", "alexUnattributed", "alexAdmin"]) expect(stored, who).not.toContain(recipients[who]!.id);
  });

  it("a branch's own confirmed invoice reaches its people and not the other branch's", async () => {
    const documentNumber = await confirmedInvoice("D111-R4-NOTIFY-ALEX", ALEX, ALEX_WAREHOUSE);
    for (const who of ["alex", "alexUnattributed", "alexAdmin", "everywhere"]) expect(await received(who, documentNumber), who).toBe(true);
    expect(await received("main", documentNumber)).toBe(false);
  });

  it("a company-level alert reaches the unrestricted and a restricted holder of «غير مخصص», nobody else", async () => {
    expect((await admin("PUT", "/cash-forecast/threshold", { amount: "999999999999.00" })).status).toBe(200);
    expect((await admin("GET", "/cash-forecast")).status).toBe(200);
    const alert = one<{ id: string }>("SELECT id FROM cash_forecast_alerts ORDER BY detected_at DESC LIMIT 1")!;
    expect(alert).toBeDefined();
    for (const who of ["everywhere", "alexUnattributed", "alexAdmin"]) expect(await received(who, alert.id), who).toBe(true);
    for (const who of ["alex", "main"]) expect(await received(who, alert.id), who).toBe(false);
  });
});

describe("D111 round 4 · the ledger account money moves through is the stored treasury account's, never the caller's", () => {
  const DRAWER = "TR-DEMO-CASH-ALEX";
  const HQ_BANK_GL = "1310";
  const drawerGl = () => one<{ gl: string }>("SELECT gl_account_id AS gl FROM treasury_account WHERE id = ?", DRAWER)!.gl;
  const linesOf = (documentId: string) =>
    all<{ account_id: string; debit: number; credit: number }>(
      "SELECT l.account_id, l.debit, l.credit FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id WHERE e.source_doc_id = ? OR e.id = ?",
      documentId,
      documentId,
    );
  const hqBankNet = () => one<{ net: number }>("SELECT COALESCE(SUM(debit - credit), 0) AS net FROM journal_line WHERE account_id = ?", HQ_BANK_GL)!.net;
  const payment = (id: string, treasuryGlAccountId: string | undefined) => {
    const { treasuryGlAccountId: _stated, ...body } = voucher(id, ALEX, DRAWER, "unused");
    return { ...body, voucherType: "other_income", counterpartyGlAccountId: "4900", customerId: undefined, ...(treasuryGlAccountId ? { treasuryGlAccountId } : {}) };
  };

  it("a voucher on the branch drawer that names the HQ bank's ledger account is refused, for a branch user and for the admin", async () => {
    for (const [label, caller] of [["branch user", alex], ["* admin granted one branch", alexStar], ["admin", admin]] as const) {
      const before = hqBankNet();
      const res = await caller("POST", "/vouchers", payment(`D111-R4-GL-${label.length}`, HQ_BANK_GL));
      expect(res.status, `${label} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(422);
      expect(res.body?.error).toBe("TREASURY_GL_ACCOUNT_MISMATCH");
      expect(res.body?.message).toMatch(ARABIC);
      expect(one("SELECT id FROM voucher WHERE id = ?", `D111-R4-GL-${label.length}`)).toBeUndefined();
      expect(hqBankNet()).toBe(before);
    }
  });

  it("a voucher that names no ledger account posts to the drawer's own", async () => {
    const before = hqBankNet();
    const created = await alex("POST", "/vouchers", payment("D111-R4-GL-DERIVED", undefined));
    expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(201);
    expect(created.body.treasuryGlAccountId).toBe(drawerGl());
    const confirmed = await alex("POST", "/vouchers/D111-R4-GL-DERIVED/confirm", {});
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 200)).toBe(200);
    const accounts = linesOf("D111-R4-GL-DERIVED").map((line) => line.account_id);
    expect(accounts).toContain(drawerGl());
    expect(accounts).not.toContain(HQ_BANK_GL);
    expect(hqBankNet()).toBe(before);
  });

  it("a voucher on a treasury account nobody holds is refused rather than posted to a ledger account the caller picked", async () => {
    const res = await admin("POST", "/vouchers", { ...payment("D111-R4-GL-GHOST", HQ_BANK_GL), treasuryAccountId: "TR-NO-SUCH-ACCOUNT" });
    expect(res.status).toBe(422);
    expect(res.body?.error).toBe("TREASURY_ACCOUNT_NOT_FOUND");
    expect(one("SELECT id FROM voucher WHERE id = 'D111-R4-GL-GHOST'")).toBeUndefined();
  });

  it("a cheque is collected into the ledger account of the bank it was deposited at, whatever the request names", async () => {
    const cheque = {
      id: "D111-R4-CHQ-GL",
      direction: "incoming",
      chequeNumber: "D111-R4-0100",
      bankName: "بنك الاختبار",
      amount: "410.00",
      issueDate: TODAY,
      dueDate: TODAY,
      branchId: MAIN,
      partyId: "CUST-DEMO-2",
      counterpartyGlAccountId: "1105",
      controlAccounts: { underCollectionAccountId: "1320" },
    };
    expect((await admin("POST", "/cheques", cheque)).status).toBe(201);
    expect((await admin("POST", "/cheques/D111-R4-CHQ-GL/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK" })).status).toBe(200);
    const entries = one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n;
    const elsewhere = await admin("POST", "/cheques/D111-R4-CHQ-GL/collect", { bankGlAccountId: drawerGl() });
    expect(elsewhere.status, JSON.stringify(elsewhere.body).slice(0, 200)).toBe(422);
    expect(elsewhere.body?.message).toMatch(ARABIC);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n).toBe(entries);
    const collected = await admin("POST", "/cheques/D111-R4-CHQ-GL/collect", {});
    expect(collected.status, JSON.stringify(collected.body).slice(0, 200)).toBe(200);
    const entryId = one<{ id: string }>("SELECT collection_journal_entry_id AS id FROM cheque WHERE id = 'D111-R4-CHQ-GL'")!.id;
    const debited = all<{ account_id: string }>("SELECT account_id FROM journal_line WHERE entry_id = ? AND debit > 0", entryId).map((line) => line.account_id);
    expect(debited).toEqual([HQ_BANK_GL]);
  });
});

describe("D111 round 4 · a document's warehouse belongs to the branch the document is booked to, however that branch is arrived at", () => {
  const purchaseReturn = (id: string, warehouseId: string) => ({
    id,
    date: TODAY,
    memo: "مرتجع اختبار",
    lines: [
      {
        itemId: "ITEM-DEMO-1",
        warehouseId,
        supplierId: "SUPP-DEMO-1",
        sourceInvoiceId: "PI-DEMO-ALEX-1",
        sourceInvoiceNumber: null,
        reason: "DEFECTIVE",
        availableQty: "1",
        qty: "1",
        unitCost: "140",
        taxAmount: "19.60",
      },
    ],
  });
  const movementsOutOfMain = () => one<{ n: number }>("SELECT count(*) AS n FROM stock_movement WHERE warehouse_id = ?", MAIN_WAREHOUSE)!.n;

  it("a return against a branch's invoice cannot take its stock out of another branch's warehouse by leaving the branch unsaid", async () => {
    expect(one<{ b: string }>("SELECT branch_id AS b FROM purchase_invoice WHERE id = 'PI-DEMO-ALEX-1'")?.b).toBe(ALEX);
    for (const [label, caller] of [["admin", admin], ["both branches", bothBranches]] as const) {
      const id = `D111-R4-PRET-${label.length}`;
      const moved = movementsOutOfMain();
      const res = await caller("POST", "/purchase-returns", purchaseReturn(id, MAIN_WAREHOUSE));
      expect(res.status, `${label} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(422);
      expect(res.body?.error).toBe("WAREHOUSE_BRANCH_MISMATCH");
      expect(res.body?.message).toMatch(ARABIC);
      expect(one("SELECT id FROM framework_document WHERE id = ?", id)).toBeUndefined();
      expect(movementsOutOfMain()).toBe(moved);
    }
  });

  it("the same return out of the invoice's own branch's warehouse is accepted", async () => {
    const res = await admin("POST", "/purchase-returns", purchaseReturn("D111-R4-PRET-OWN", ALEX_WAREHOUSE));
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
  });

  it("a line's warehouse cannot leave the branch of the document's header", async () => {
    const res = await admin("POST", "/purchases/invoices", {
      id: "D111-R4-PI-LINE-WH",
      supplierId: "SUPP-DEMO-1",
      date: TODAY,
      branchId: ALEX,
      warehouseId: ALEX_WAREHOUSE,
      currency: "EGP",
      lines: [{ itemId: "ITEM-DEMO-1", qty: "1", unitCost: "140", kind: "inventory", taxRatePercent: 14, warehouseId: MAIN_WAREHOUSE }],
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(422);
    expect(res.body?.error).toBe("WAREHOUSE_BRANCH_MISMATCH");
    expect(one("SELECT id FROM purchase_invoice WHERE id = 'D111-R4-PI-LINE-WH'")).toBeUndefined();
  });

  it("a warehouse holding stock or open documents cannot be moved to another branch", async () => {
    const before = one<{ b: string }>("SELECT branch_id AS b FROM warehouse WHERE id = ?", ALEX_WAREHOUSE)!.b;
    const current = (await admin("GET", `/warehouses/${ALEX_WAREHOUSE}`)).body ?? rowsOf((await admin("GET", "/warehouses")).body).find((row: any) => row.id === ALEX_WAREHOUSE);
    for (const caller of [admin, bothBranches]) {
      const res = await caller("PUT", `/warehouses/${ALEX_WAREHOUSE}`, { ...current, branchId: MAIN });
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(409);
      expect(res.body?.error).toBe("WAREHOUSE_IN_USE");
      expect(res.body?.message).toMatch(ARABIC);
      expect(one<{ b: string }>("SELECT branch_id AS b FROM warehouse WHERE id = ?", ALEX_WAREHOUSE)!.b).toBe(before);
    }
  });

  it("an empty warehouse with no documents can still be moved", async () => {
    expect((await admin("POST", "/warehouses", { id: "D111-R4-WH-EMPTY", code: "R4E", name: "مستودع فارغ", type: "MAIN", branchId: ALEX })).status).toBe(201);
    const current = rowsOf((await admin("GET", "/warehouses")).body).find((row: any) => row.id === "D111-R4-WH-EMPTY");
    const res = await admin("PUT", "/warehouses/D111-R4-WH-EMPTY", { ...current, branchId: MAIN });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    expect(one<{ b: string }>("SELECT branch_id AS b FROM warehouse WHERE id = 'D111-R4-WH-EMPTY'")!.b).toBe(MAIN);
  });
});

describe("D111 round 4 · a session granted some warehouses cannot open or move another warehouse's document by its id", () => {
  const OTHER_ALEX_WAREHOUSE = "D111-R4-WH-ALEX-2";
  const INVOICE = "D111-R4-INV-OTHER-WH";
  const everything = () => ALL_PERMISSION_CODES.filter((code) => code !== VIEW_UNATTRIBUTED);
  const narrow = async (userId: string, permissions: readonly string[], branchScope: typeof ALL_SCOPE | string[], warehouses: string[]) =>
    callerFor(await handle.sessions.issue({ userId, permissions, roleCode: null, branchScope, warehouseScope: warehouses }));
  const statusOf = () => one<{ status: string }>("SELECT status FROM sales_invoice WHERE id = ?", INVOICE)!.status;

  beforeAll(async () => {
    const warehouse = await admin("POST", "/warehouses", { id: OTHER_ALEX_WAREHOUSE, code: "ALX2", name: "مستودع الإسكندرية الثاني", type: "MAIN", branchId: ALEX });
    expect(warehouse.status, JSON.stringify(warehouse.body).slice(0, 200)).toBe(201);
    const invoice = await admin("POST", "/sales-invoices", salesInvoice(INVOICE, ALEX, OTHER_ALEX_WAREHOUSE));
    expect(invoice.status, JSON.stringify(invoice.body).slice(0, 200)).toBe(201);
  });

  it("answers as if the document were not there — to read it, to confirm it, to cancel it — whatever the branch grant", async () => {
    const callers = [
      ["branch user, one warehouse", await narrow("USER-R4-WH-ALEX", everything(), [ALEX], [ALEX_WAREHOUSE])],
      ["* admin of the branch, one warehouse", await narrow("USER-R4-WH-STAR", ["*"], [ALEX], [ALEX_WAREHOUSE])],
      ["every branch, one warehouse", await narrow("USER-R4-WH-ALL", everything(), ALL_SCOPE, [ALEX_WAREHOUSE])],
    ] as const;
    for (const [label, caller] of callers) {
      for (const [method, path] of [["GET", `/sales-invoices/${INVOICE}`], ["POST", `/sales-invoices/${INVOICE}/confirm`], ["POST", `/sales-invoices/${INVOICE}/cancel`]] as const) {
        const res = await caller(method, path, method === "GET" ? undefined : {});
        expect(res.status, `${label} ${method} ${path} ${JSON.stringify(res.body).slice(0, 160)}`).toBe(404);
        expect(res.body?.error).toBe("NOT_FOUND");
        expect(res.body?.message).toMatch(ARABIC);
        expect(JSON.stringify(res.body)).not.toContain(OTHER_ALEX_WAREHOUSE);
      }
      expect(statusOf(), label).toBe("draft");
    }
  });

  it("the same answer is given for an id nobody holds", async () => {
    const caller = (await narrow("USER-R4-WH-ALEX", everything(), [ALEX], [ALEX_WAREHOUSE]));
    const foreign = await caller("GET", `/sales-invoices/${INVOICE}`);
    const unknown = await caller("GET", "/sales-invoices/D111-R4-NO-SUCH-INVOICE");
    expect(foreign.status).toBe(unknown.status);
    expect(foreign.body).toEqual(unknown.body);
  });

  it("a session granted that warehouse opens it", async () => {
    const caller = (await narrow("USER-R4-WH-BOTH", everything(), [ALEX], [ALEX_WAREHOUSE, OTHER_ALEX_WAREHOUSE]));
    expect((await caller("GET", `/sales-invoices/${INVOICE}`)).status).toBe(200);
    expect((await alex("GET", `/sales-invoices/${INVOICE}`)).status).toBe(200);
  });
});

describe("D111 round 4 · a company-level record is not created by a branch-restricted session", () => {
  it("a treasury account with no branch is refused, and none is stored", async () => {
    for (const caller of [alex, alexStar, bothBranches]) {
      const res = await caller("POST", "/treasury-accounts", { id: "D111-R4-TR-COMPANY", code: "R4-CO", name: "حساب الشركة", type: "bank", branchId: null });
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(403);
      expect(res.body?.error).toBe("HEAD_OFFICE_CREATES_ONLY");
      expect(res.body?.message).toMatch(ARABIC);
      expect(one("SELECT id FROM treasury_account WHERE id = 'D111-R4-TR-COMPANY'")).toBeUndefined();
    }
  });
});

describe("D111 round 4 · a branch user edits a shared record's contact details and nothing else", () => {
  const refused = (res: Res, field: string) => {
    expect(res.status, `${field} ${JSON.stringify(res.body).slice(0, 200)}`).toBe(403);
    expect(res.body?.error).toBe("SHARED_FIELD_RESTRICTED");
    expect(res.body?.message).toMatch(ARABIC);
    expect(res.body?.fields).toContain(field);
  };
  const row = (table: string, id: string) => JSON.stringify(one(`SELECT * FROM "${table}" WHERE id = ?`, id));
  const openingEntries = () => one<{ n: number }>("SELECT count(*) AS n FROM journal_entry WHERE id LIKE 'OB-%'")!.n;
  const restricted = (): readonly (readonly [string, Caller])[] => [["non-admin", alex], ["* admin granted one branch", alexStar], ["two branches", bothBranches]];

  it("a supplier's bank account, opening balance, tax number, currency and category are refused", async () => {
    const supplier = one<{ id: string }>("SELECT id FROM supplier ORDER BY id LIMIT 1")!.id;
    for (const [label, caller] of restricted()) {
      const before = row("supplier", supplier);
      const entries = openingEntries();
      for (const [field, value] of [["bankAccount", "EG00 ATTACKER 0000"], ["openingBalance", "123456.00"], ["taxNumber", "111-111-111"], ["currency", "USD"], ["category", "vip"]] as const) {
        refused(await caller("PATCH", `/suppliers/${supplier}`, { [field]: value }), field);
      }
      expect(row("supplier", supplier), label).toBe(before);
      expect(openingEntries(), label).toBe(entries);
    }
  });

  it("a customer's opening balance, tax number, currency and tax identity are refused", async () => {
    for (const [label, caller] of restricted()) {
      const before = row("customer", "CUST-DEMO-2");
      const entries = openingEntries();
      const buyerType = one<{ t: string }>("SELECT eta_buyer_type AS t FROM customer WHERE id = 'CUST-DEMO-2'")!.t === "individual" ? "business" : "individual";
      for (const [field, value] of [["openingBalance", "777.00"], ["taxNumber", "999-999-999"], ["currency", "USD"], ["etaBuyerType", buyerType], ["nationalId", "29001010101010"], ["commercialRegistrationNumber", "55555"]] as const) {
        refused(await caller("PATCH", "/customers/CUST-DEMO-2", { [field]: value }), field);
      }
      expect(row("customer", "CUST-DEMO-2"), label).toBe(before);
      expect(openingEntries(), label).toBe(entries);
    }
  });

  it("an item's sale price, tax rate, stock tracking, type, units and costing are refused", async () => {
    const otherSupplier = one<{ id: string }>("SELECT id FROM supplier WHERE id <> COALESCE((SELECT default_supplier_id FROM item WHERE id = 'ITEM-DEMO-1'), '') ORDER BY id LIMIT 1")!.id;
    for (const [label, caller] of restricted()) {
      const before = row("item", "ITEM-DEMO-1");
      for (const [field, value] of [
        ["salePrice", "0.01"],
        ["taxRatePercent", 0],
        ["trackInventory", false],
        ["type", "service"],
        ["baseUnitCode", "KG"],
        ["alternateUnits", [{ code: "BOX", name: "كرتونة", factor: 1000 }]],
        ["defaultSupplierId", otherSupplier],
      ] as const) {
        refused(await caller("PATCH", "/items/ITEM-DEMO-1", { [field]: value }), field);
      }
      expect(row("item", "ITEM-DEMO-1"), label).toBe(before);
    }
  });

  it("a branch user still creates a customer and a supplier at the counter, with contact details only", async () => {
    const customer = await alex("POST", "/customers", { id: "D111-R4-CUST-COUNTER", nameAr: "عميل الشباك", phone: "01000000009", address: "الإسكندرية", notes: "عميل نقدي" });
    expect(customer.status, JSON.stringify(customer.body).slice(0, 200)).toBe(201);
    const supplier = await alex("POST", "/suppliers", { id: "D111-R4-SUPP-COUNTER", nameAr: "مورد محلي", phone: "01000000008", addressCity: "الإسكندرية" });
    expect(supplier.status, JSON.stringify(supplier.body).slice(0, 200)).toBe(201);
  });

  it("neither can be born owing or owed money, nor with a bank account", async () => {
    const entries = openingEntries();
    refused(await alex("POST", "/customers", { id: "D111-R4-CUST-OB", nameAr: "عميل برصيد", openingBalance: "50000.00", openingBalanceDate: TODAY }), "openingBalance");
    refused(await alex("POST", "/suppliers", { id: "D111-R4-SUPP-OB", nameAr: "مورد برصيد", openingBalance: "90000.00" }), "openingBalance");
    refused(await alex("POST", "/suppliers", { id: "D111-R4-SUPP-BANK", nameAr: "مورد بحساب", bankAccount: "EG00 X" }), "bankAccount");
    expect(one("SELECT id FROM customer WHERE id = 'D111-R4-CUST-OB'")).toBeUndefined();
    expect(one("SELECT id FROM supplier WHERE id IN ('D111-R4-SUPP-OB', 'D111-R4-SUPP-BANK')")).toBeUndefined();
    expect(openingEntries()).toBe(entries);
  });

  it("a branch user edits the contact details of a shared record", async () => {
    expect((await alex("PATCH", "/customers/CUST-DEMO-2", { phone: "01000000077", email: "branch@example.com", address: "عنوان جديد", notes: "ملاحظة الفرع", contactPerson: "أحمد" })).status).toBe(200);
    const supplier = one<{ id: string }>("SELECT id FROM supplier ORDER BY id LIMIT 1")!.id;
    expect((await alex("PATCH", `/suppliers/${supplier}`, { phone: "01000000066", addressStreet: "شارع الفرع", notes: "ملاحظة" })).status).toBe(200);
    expect((await alex("PATCH", "/items/ITEM-DEMO-1", { description: "وصف الفرع", nameEn: "Branch name" })).status).toBe(200);
  });

  it("an unrestricted session sets all of it, opening balances included", async () => {
    expect((await admin("PATCH", "/items/ITEM-DEMO-1", { taxRatePercent: 14 })).status).toBe(200);
    const created = await admin("POST", "/customers", { id: "D111-R4-CUST-ADMIN", nameAr: "عميل الإدارة", taxNumber: "123-456-789", openingBalance: "10.00", openingBalanceDate: TODAY });
    expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(201);
  });
});

describe("D111 round 4 · the lists a picker needs are open to every signed-in user and cut to the session's grant", () => {
  const picker = async (userId: string, branchScope: typeof ALL_SCOPE | string[], warehouseScope: typeof ALL_SCOPE | string[]) =>
    callerFor(await handle.sessions.issue({ userId, permissions: ["sales.invoice.create"], roleCode: null, branchScope, warehouseScope }));

  it("a user with no admin permission reads the branches and warehouses of its grant, and no other's", async () => {
    const caller = (await picker("USER-R4-PICK-ALEX", [ALEX], ALL_SCOPE));
    const branches = await caller("GET", "/branches/lookup");
    expect(branches.status).toBe(200);
    expect(branches.body.branches.map((branch: any) => branch.id)).toEqual([ALEX]);
    expect(branches.body.branches[0].code).toBeTruthy();
    const warehouses = await caller("GET", "/warehouses/lookup");
    expect(warehouses.status, JSON.stringify(warehouses.body).slice(0, 200)).toBe(200);
    const ids = warehouses.body.map((warehouse: any) => warehouse.id);
    expect(ids).toContain(ALEX_WAREHOUSE);
    expect(new Set(warehouses.body.map((warehouse: any) => warehouse.branchId))).toEqual(new Set([ALEX]));
    expect(JSON.stringify(warehouses.body)).not.toContain(MAIN_WAREHOUSE);
  });

  it("a narrow warehouse grant cuts the warehouse list further", async () => {
    const caller = (await picker("USER-R4-PICK-ONE", ALL_SCOPE, [ALEX_WAREHOUSE]));
    const warehouses = await caller("GET", "/warehouses/lookup");
    expect(warehouses.body.map((warehouse: any) => warehouse.id)).toEqual([ALEX_WAREHOUSE]);
  });

  it("the settings every screen needs are readable without the settings permission, and carry no mail credentials", async () => {
    const caller = (await picker("USER-R4-PICK-ALEX", [ALEX], ALL_SCOPE));
    expect((await caller("GET", "/settings")).status).toBe(403);
    const lookup = await caller("GET", "/settings/lookup");
    expect(lookup.status, JSON.stringify(lookup.body).slice(0, 200)).toBe(200);
    expect(lookup.body.companyName).toBeTruthy();
    expect(lookup.body.currency).toBe("EGP");
    expect(Object.keys(lookup.body).filter((key) => key.startsWith("smtp") || key === "allowedEmailDomains")).toEqual([]);
  });

  it("the settings lookup answers its allowlist and nothing else — no secret, credential or mail template, whoever asks", async () => {
    sqlite.prepare("UPDATE tenant_settings SET data = json_set(data, '$.futureApiSecret', 'sk-live-not-for-screens', '$.webhookToken', 't0ken')").run();
    for (const caller of [admin, alex, await picker("USER-R5-PICK", [ALEX], ALL_SCOPE)]) {
      const lookup = await caller("GET", "/settings/lookup");
      expect(lookup.status).toBe(200);
      expect(Object.keys(lookup.body).sort()).toEqual([...contracts.TENANT_SETTINGS_LOOKUP_KEYS].sort());
      expect(Object.keys(lookup.body).filter((key) => /secret|password|token|key|smtp|template/i.test(key))).toEqual([]);
      expect(JSON.stringify(lookup.body)).not.toContain("sk-live-not-for-screens");
    }
  });

  it("an unauthenticated caller reads none of them", async () => {
    for (const path of ["/branches/lookup", "/warehouses/lookup", "/settings/lookup"]) {
      const res = await handle.app.fetch(new Request(`http://local${path}`));
      expect(res.status, path).toBe(401);
    }
  });

  it("the seeded branch manager holds what its dashboard and an invoice ask for, and confirms a voucher it may not write", async () => {
    const permissions = JSON.parse(one<{ permissions: string }>("SELECT permissions FROM role WHERE code = 'BRANCH_MANAGER'")!.permissions) as string[];
    for (const code of ["dashboard.view", "accounting.journal.view", "sales.invoice.create", "treasury.cash_voucher.confirm"]) expect(permissions, code).toContain(code);
    expect(permissions).not.toContain("treasury.cash_voucher.create");
    const manager = callerFor(await handle.sessions.issue({ userId: "USER-R4-MANAGER", permissions, roleCode: "BRANCH_MANAGER", branchScope: [ALEX], warehouseScope: ALL_SCOPE }));
    expect((await manager("GET", "/dashboard/summary")).status).toBe(200);
  });
});

describe("D111 round 4 · a reference nobody holds and one another branch holds answer the same, under every reference key", () => {
  it("an employee, a cost centre, a payroll run and a recurring template", async () => {
    const foreignEmployee = one<{ id: string }>("SELECT id FROM hr_employee WHERE branch_id = ? LIMIT 1", MAIN)!.id;
    const foreignRun = one<{ id: string }>("SELECT id FROM hr_payroll_run WHERE branch_id = ? LIMIT 1", MAIN)!.id;
    const foreignCostCenter = one<{ id: string }>("SELECT id FROM cost_center WHERE branch_id = ? LIMIT 1", MAIN)?.id;
    const probes: (readonly [path: string, body: (id: string) => unknown, foreign: string | undefined])[] = [
      ["/hr/advances", (id) => ({ employeeId: id, amount: "100.00", installments: 1, requestDate: TODAY }), foreignEmployee],
      ["/hr/leave-requests", (id) => ({ employeeId: id, leaveType: "annual", startDate: TODAY, endDate: TODAY }), foreignEmployee],
      ["/hr/payroll/garnishments", (id) => ({ employeeId: id, runId: foreignRun, totalAmount: "10.00", monthlyAmount: "10.00", startDate: TODAY }), foreignEmployee],
      ["/vouchers", (id) => ({ ...voucher(`D111-R4-ORACLE-${id.length}`, ALEX, "TR-DEMO-CASH-ALEX", "1300-ALEX"), costCenterId: id }), foreignCostCenter],
      ["/gl/recurring/runs", (id) => ({ templateId: id, period: "2026-10" }), one<{ id: string }>("SELECT id FROM recurring_journal_template LIMIT 1")?.id],
    ];
    for (const [path, body, foreign] of probes) {
      if (!foreign) continue;
      for (const caller of [alex, alexStar]) {
        const held = await caller("POST", path, body(foreign));
        const unknown = await caller("POST", path, body("D111-R4-NOBODY-HOLDS-THIS"));
        expect({ status: unknown.status, body: unknown.body }, path).toEqual({ status: held.status, body: held.body });
      }
    }
  });
});

describe("D111 round 4 · the user list is the users within the caller's branches", () => {
  it("a branch-restricted session lists and opens only users whose branches are inside its own", async () => {
    const scopes = new Map(all<{ id: string; branch_scope: string }>("SELECT id, branch_scope FROM user").map((row) => [row.id, JSON.parse(row.branch_scope) as string | string[]]));
    for (const caller of [alex, alexStar]) {
      const listed = rowsOf((await caller("GET", "/users")).body);
      expect(listed.length).toBeGreaterThan(0);
      for (const user of listed) {
        const scope = scopes.get(user.id);
        expect(Array.isArray(scope) && scope.every((branch) => branch === ALEX), `${user.email} ${JSON.stringify(scope)}`).toBe(true);
      }
      const outside = [...scopes].find(([, scope]) => scope === "*")![0];
      const res = await caller("GET", `/users/${outside}`);
      expect(res.status).toBe(404);
    }
    expect(rowsOf((await admin("GET", "/users")).body).length).toBe(scopes.size);
  });
});

describe("D111 round 4 · a stored record cannot be moved onto another branch's warehouse by its id", () => {
  it("a till of one branch is not given another branch's warehouse", async () => {
    const terminal = one<{ id: string; warehouse_id: string }>("SELECT id, warehouse_id FROM pos_terminal WHERE branch_id = ? LIMIT 1", MAIN)!;
    const current = (await admin("GET", `/pos/terminals/${terminal.id}`)).body;
    const res = await admin("PUT", `/pos/terminals/${terminal.id}`, { ...current, warehouseId: ALEX_WAREHOUSE });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(422);
    expect(res.body?.error).toBe("WAREHOUSE_BRANCH_MISMATCH");
    expect(one<{ w: string }>("SELECT warehouse_id AS w FROM pos_terminal WHERE id = ?", terminal.id)!.w).toBe(terminal.warehouse_id);
  });
});

describe("D111 round 4 · a refund paid out of the company's account is booked to the branch of the return it settles", () => {
  it("the refund voucher and its journal carry the return's branch, never none", async () => {
    const companyAccount = await admin("POST", "/treasury-accounts", { id: "D111-R4-TR-HQ", code: "R4-HQ", name: "حساب الشركة", type: "bank", currency: "EGP", branchId: null, glAccountId: "1310" });
    expect(companyAccount.status, JSON.stringify(companyAccount.body).slice(0, 200)).toBe(201);
    const invoice = { ...salesInvoice("D111-R4-REFUND-INV", ALEX, ALEX_WAREHOUSE), lines: [{ ...salesInvoice("x", ALEX, ALEX_WAREHOUSE).lines[0]!, lineId: "D111-R4-REFUND-INV-L1", isStock: true, qty: "1" }] };
    expect((await admin("POST", "/sales-invoices", invoice)).status).toBe(201);
    const confirmed = await admin("POST", "/sales-invoices/D111-R4-REFUND-INV/confirm", {});
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 200)).toBe(200);
    const drafted = await admin("POST", "/sales-returns/from-invoice", { id: "D111-R4-REFUND-SRT", date: TODAY, sourceInvoiceId: "D111-R4-REFUND-INV", warehouseId: ALEX_WAREHOUSE, reason: "OTHER", requested: [{ itemId: "ITEM-DEMO-1", qty: "1" }] });
    expect(drafted.status, JSON.stringify(drafted.body).slice(0, 200)).toBe(201);
    expect((await admin("POST", "/sales-returns/D111-R4-REFUND-SRT/confirm", {})).status).toBe(200);

    const refunded = await admin("POST", "/sales-returns/D111-R4-REFUND-SRT/refund", { amount: "10.00", treasuryAccountId: "D111-R4-TR-HQ", paymentMethod: "bank" });
    expect(refunded.status, JSON.stringify(refunded.body).slice(0, 200)).toBe(200);
    const voucherId = refunded.body.voucherId as string;
    expect(one<{ b: string }>("SELECT branch_id AS b FROM voucher WHERE id = ?", voucherId)!.b).toBe(ALEX);
    const branches = all<{ b: string | null }>("SELECT DISTINCT l.branch_id AS b FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id WHERE e.source_doc_id = ? OR e.id = ?", voucherId, voucherId);
    expect(branches).toEqual([{ b: ALEX }]);
  });
});

describe("D111 round 4 · which warehouse may stand on which branch's document — the rule, for van, transit and site stores", () => {
  const transfer = (id: string, fromWarehouseId: string, toWarehouseId: string) => ({ id, date: TODAY, memo: "تحويل اختبار", lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId, toWarehouseId, qty: "1" }] });
  const typeOf = (warehouseId: string) => one<{ type: string; branch_id: string }>("SELECT type, branch_id FROM warehouse WHERE id = ?", warehouseId)!;

  it("a transfer is the one document that crosses branches: branch to transit to branch, for a session that holds both", async () => {
    expect(typeOf("WH-DEMO-TRANSIT")).toEqual({ type: "TRANSIT", branch_id: MAIN });
    for (const caller of [admin, bothBranches]) {
      const tag = caller === admin ? "A" : "B";
      const out = await caller("POST", "/inventory/stock-transfers/draft", transfer(`D111-R4-TRF-OUT-${tag}`, ALEX_WAREHOUSE, "WH-DEMO-TRANSIT"));
      expect(out.status, JSON.stringify(out.body).slice(0, 200)).toBe(201);
      const into = await caller("POST", "/inventory/stock-transfers/draft", transfer(`D111-R4-TRF-IN-${tag}`, "WH-DEMO-TRANSIT", MAIN_WAREHOUSE));
      expect(into.status, JSON.stringify(into.body).slice(0, 200)).toBe(201);
    }
  });

  it("a branch user cannot route its stock through another branch's transit store", async () => {
    const res = await alex("POST", "/inventory/stock-transfers/draft", transfer("D111-R4-TRF-ALEX", ALEX_WAREHOUSE, "WH-DEMO-TRANSIT"));
    expect(res.status).toBe(403);
    expect(res.body?.error).toBe("BRANCH_OUT_OF_SCOPE");
    expect(one("SELECT id FROM stock_transfer_document WHERE id = 'D111-R4-TRF-ALEX'")).toBeUndefined();
  });

  it("a van, transit or site store sells and buys only for the branch it belongs to", async () => {
    for (const warehouseId of ["WH-DEMO-VAN", "WH-DEMO-TRANSIT", "WH-SITE-TOWER"]) {
      expect(typeOf(warehouseId).branch_id).toBe(MAIN);
      const foreign = await admin("POST", "/sales-invoices", salesInvoice(`D111-R4-RULE-${warehouseId}-ALEX`, ALEX, warehouseId));
      expect(foreign.status, `${warehouseId} ${JSON.stringify(foreign.body).slice(0, 160)}`).toBe(422);
      expect(foreign.body?.error).toBe("WAREHOUSE_BRANCH_MISMATCH");
      expect(foreign.body?.message).toMatch(ARABIC);
      const own = await admin("POST", "/sales-invoices", salesInvoice(`D111-R4-RULE-${warehouseId}-MAIN`, MAIN, warehouseId));
      expect(own.status, `${warehouseId} ${JSON.stringify(own.body).slice(0, 160)}`).toBe(201);
    }
  });
});

describe("D111 round 4 · a page of a branch's list is a whole page — a document with no branch of its own is placed in the query, not dropped after the cut", () => {
  type Caller = typeof alex;
  const EFFECTIVE_BRANCH = "COALESCE(NULLIF(d.branch_id, ''), (SELECT w.branch_id FROM warehouse w WHERE w.id = d.warehouse_id))";

  async function everyPage(caller: Caller, path: string, pageSize: number): Promise<{ ids: string[]; sizes: number[] }> {
    const ids: string[] = [];
    const sizes: number[] = [];
    for (let page = 1; page <= 400; page++) {
      const res = await caller("GET", `${path}?page=${page}&pageSize=${pageSize}`);
      expect(res.status, JSON.stringify(res.body).slice(0, 160)).toBe(200);
      const rows = res.body as { id: string }[];
      sizes.push(rows.length);
      ids.push(...rows.map((row) => row.id));
      if (rows.length < pageSize) break;
    }
    return { ids, sizes };
  }

  function reshaped(table: string, where: string, count: number, set: string, ...params: unknown[]): { ids: string[]; restore: () => void } {
    const warehouse = table === "voucher" ? "NULL" : "warehouse_id";
    const rows = all<{ id: string; branch_id: string; warehouse_id: string | null }>(`SELECT id, branch_id, ${warehouse} AS warehouse_id FROM ${table} d WHERE ${where} ORDER BY id LIMIT ${count}`);
    expect(rows.length, `${table} ${where}`).toBe(count);
    const change = sqlite.prepare(`UPDATE ${table} SET ${set} WHERE id = ?`);
    const put = sqlite.prepare(table === "voucher" ? `UPDATE ${table} SET branch_id = ? WHERE id = ?` : `UPDATE ${table} SET branch_id = ?, warehouse_id = ? WHERE id = ?`);
    for (const row of rows) change.run(...params, row.id);
    return {
      ids: rows.map((row) => row.id),
      restore: () => rows.forEach((row) => (table === "voucher" ? put.run(row.branch_id, row.id) : put.run(row.branch_id, row.warehouse_id, row.id))),
    };
  }

  for (const [table, path] of [
    ["sales_invoice", "/sales-invoices"],
    ["purchase_invoice", "/purchases/invoices"],
  ] as const) {
    it(`${path}: one with no branch stands on its warehouse's branch, and every page but the last is full`, async () => {
      const atMain = `d.branch_id = '${MAIN}' AND d.warehouse_id = '${MAIN_WAREHOUSE}'`;
      const own = reshaped(table, atMain, 3, "branch_id = '', warehouse_id = ?", ALEX_WAREHOUSE);
      const stated = reshaped(table, atMain, 4, "branch_id = ?, warehouse_id = ?", ALEX, ALEX_WAREHOUSE);
      const foreign = reshaped(table, atMain, 3, "branch_id = ''");
      try {
        const expected = all<{ id: string }>(`SELECT d.id FROM ${table} d WHERE ${EFFECTIVE_BRANCH} = ?`, ALEX).map((row) => row.id).sort();
        expect(expected.length).toBeGreaterThan(7);
        for (const caller of [alex, alexWithUnattributed]) {
          const { ids, sizes } = await everyPage(caller, path, 2);
          expect([...ids].sort()).toEqual(expected);
          expect(new Set(ids).size).toBe(ids.length);
          expect(sizes.slice(0, -1).every((size) => size === 2), sizes.join(",")).toBe(true);
          for (const id of own.ids) expect(ids).toContain(id);
          for (const id of foreign.ids) expect(ids).not.toContain(id);
        }
      } finally {
        foreign.restore();
        stated.restore();
        own.restore();
      }
    });
  }

  it("/vouchers: one with no branch is listed only for a session that reads the unattributed, in whole pages either way", async () => {
    const stated = reshaped("voucher", `d.branch_id = '${MAIN}'`, 5, "branch_id = ?", ALEX);
    const unattributed = reshaped("voucher", `d.branch_id = '${MAIN}'`, 3, "branch_id = ''");
    try {
      const owned = all<{ id: string }>("SELECT id FROM voucher WHERE branch_id = ?", ALEX).map((row) => row.id).sort();
      expect(owned.length).toBeGreaterThan(4);
      const plain = await everyPage(alex, "/vouchers", 2);
      expect([...plain.ids].sort()).toEqual(owned);
      expect(plain.sizes.slice(0, -1).every((size) => size === 2), plain.sizes.join(",")).toBe(true);
      const reading = await everyPage(alexWithUnattributed, "/vouchers", 2);
      expect([...reading.ids].sort()).toEqual([...owned, ...unattributed.ids].sort());
      expect(reading.sizes.slice(0, -1).every((size) => size === 2), reading.sizes.join(",")).toBe(true);
    } finally {
      unattributed.restore();
      stated.restore();
    }
  });
});

describe("D111 round 4 · a bank charge on the company's account takes the branch of the statement it was read from", () => {
  const BANK = "TR-R4-CHG-HQ";
  const imported = (id: string) => ({
    id,
    treasuryAccountId: BANK,
    rawCsv: "Date,Description,Amount,Ref\n" + `${TODAY.slice(0, 10)},مصاريف بنكية,-25.00,${id}\n`,
    mapping: { dateColumn: "Date", descriptionColumn: "Description", amountColumn: "Amount", referenceColumn: "Ref" },
    periodStart: TODAY.slice(0, 10),
    periodEnd: TODAY.slice(0, 10),
    openingBalance: "0.00",
    closingBalance: "-25.00",
  });
  const chargeOn = async (statementId: string) => {
    const line = one<{ id: string }>("SELECT id FROM statement_line WHERE statement_id = ?", statementId)!.id;
    const res = await admin("POST", `/bank-statements/${statementId}/lines/${line}/create-entry`, { accountId: "5200" });
    expect(res.status, JSON.stringify(res.body).slice(0, 240)).toBe(201);
    expect(res.body.held).toBe(false);
    return {
      voucher: one<{ branch_id: string }>("SELECT branch_id FROM voucher WHERE id = ?", res.body.voucherId)!.branch_id,
      lines: all<{ branch_id: string | null }>("SELECT branch_id FROM journal_line WHERE entry_id = ?", res.body.entryId).map((row) => row.branch_id),
    };
  };

  it("a statement a one-branch user imports on the company's account is that branch's, and its charge with it; one the company imports is «غير مخصص»", async () => {
    const created = await admin("POST", "/treasury-accounts", { id: BANK, code: "BANK-R4-CHG", name: "حساب الشركة للمصاريف", type: "bank", branchId: null, glAccountId: "1310" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(one("SELECT branch_id FROM treasury_account WHERE id = ?", BANK)).toEqual({ branch_id: null });

    const byBranch = await alex("POST", "/bank-statements/import", imported("R4-STMT-ALEX"));
    expect(byBranch.status, JSON.stringify(byBranch.body).slice(0, 240)).toBe(201);
    expect(one("SELECT branch_id FROM bank_statement WHERE id = 'R4-STMT-ALEX'")).toEqual({ branch_id: ALEX });
    expect((await alex("GET", "/bank-statements/R4-STMT-ALEX")).status).toBe(200);
    expect((await mainOnly("GET", "/bank-statements/R4-STMT-ALEX")).status).toBe(404);

    const byCompany = await admin("POST", "/bank-statements/import", imported("R4-STMT-NONE"));
    expect(byCompany.status, JSON.stringify(byCompany.body).slice(0, 240)).toBe(201);
    expect(one("SELECT branch_id FROM bank_statement WHERE id = 'R4-STMT-NONE'")).toEqual({ branch_id: null });

    const byTwoBranches = await bothBranches("POST", "/bank-statements/import", imported("R4-STMT-BOTH"));
    expect(byTwoBranches.status, JSON.stringify(byTwoBranches.body).slice(0, 240)).toBe(400);
    expect(byTwoBranches.body.error).toBe("BRANCH_REQUIRED");
    expect(byTwoBranches.body.message).toMatch(/الفرع/);
    expect(one("SELECT id FROM bank_statement WHERE id = 'R4-STMT-BOTH'")).toBeUndefined();
    const reading = await bothBranchesWithUnattributed("POST", "/bank-statements/import", imported("R4-STMT-BOTH-U"));
    expect(reading.status, JSON.stringify(reading.body).slice(0, 240)).toBe(201);
    expect(one("SELECT branch_id FROM bank_statement WHERE id = 'R4-STMT-BOTH-U'")).toEqual({ branch_id: null });
    expect((await bothBranchesWithUnattributed("GET", "/bank-statements/R4-STMT-BOTH-U")).status).toBe(200);

    const ofBranch = await chargeOn("R4-STMT-ALEX");
    expect(ofBranch.voucher).toBe(ALEX);
    expect(ofBranch.lines).toEqual([ALEX, ALEX]);

    const unattributed = await chargeOn("R4-STMT-NONE");
    expect(unattributed.voucher).toBe("");
    expect(unattributed.lines).toEqual([null, null]);
  });

  it("a user of several branches says which branch the statement on the company's account is for", async () => {
    const res = await bothBranches("POST", "/bank-statements/import", { ...imported("R5-STMT-BOTH-ALEX"), branchId: ALEX });
    expect(res.status, JSON.stringify(res.body).slice(0, 240)).toBe(201);
    expect(one("SELECT branch_id FROM bank_statement WHERE id = 'R5-STMT-BOTH-ALEX'")).toEqual({ branch_id: ALEX });
    expect((await alex("GET", "/bank-statements/R5-STMT-BOTH-ALEX")).status).toBe(200);
    const charged = await chargeOn("R5-STMT-BOTH-ALEX");
    expect(charged.lines).toEqual([ALEX, ALEX]);
  });

  it("a branch outside the grant, or one that is not the account's own, is refused and nothing is stored", async () => {
    const outside = await alex("POST", "/bank-statements/import", { ...imported("R5-STMT-ALEX-MAIN"), branchId: MAIN });
    expect(outside.status).toBe(403);
    expect(outside.body?.message).toMatch(ARABIC);
    const notItsOwn = await admin("POST", "/bank-statements/import", { ...imported("R5-STMT-WRONG"), treasuryAccountId: "TR-DEMO-BANK", branchId: ALEX });
    expect(notItsOwn.status, JSON.stringify(notItsOwn.body).slice(0, 240)).toBe(422);
    expect(notItsOwn.body?.error).toBe("STATEMENT_BRANCH_NOT_THE_ACCOUNTS");
    expect(notItsOwn.body?.message).toMatch(ARABIC);
    expect(one("SELECT count(*) AS n FROM bank_statement WHERE id IN ('R5-STMT-ALEX-MAIN', 'R5-STMT-WRONG')")).toEqual({ n: 0 });
  });

  it("head office's statement on the company's account stays the company's, and each charge takes the branch named for it, or none", async () => {
    const res = await admin("POST", "/bank-statements/import", {
      ...imported("R5-STMT-HQ"),
      rawCsv: `Date,Description,Amount,Ref\n${TODAY},مصاريف فرع الإسكندرية,-11.00,R5-A\n${TODAY},مصاريف عامة,-7.00,R5-B\n`,
      closingBalance: "-18.00",
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 240)).toBe(201);
    expect(one("SELECT branch_id FROM bank_statement WHERE id = 'R5-STMT-HQ'")).toEqual({ branch_id: null });
    const [forAlex, general] = all<{ id: string }>("SELECT id FROM statement_line WHERE statement_id = 'R5-STMT-HQ' ORDER BY amount").map((row) => row.id);
    const linesOf = (entryId: string) => all<{ b: string | null }>("SELECT branch_id AS b FROM journal_line WHERE entry_id = ?", entryId).map((row) => row.b);

    const named = await admin("POST", `/bank-statements/R5-STMT-HQ/lines/${forAlex}/create-entry`, { accountId: "5200", branchId: ALEX });
    expect(named.status, JSON.stringify(named.body).slice(0, 240)).toBe(201);
    expect(linesOf(named.body.entryId)).toEqual([ALEX, ALEX]);
    const unnamed = await admin("POST", `/bank-statements/R5-STMT-HQ/lines/${general}/create-entry`, { accountId: "5200" });
    expect(unnamed.status, JSON.stringify(unnamed.body).slice(0, 240)).toBe(201);
    expect(linesOf(unnamed.body.entryId)).toEqual([null, null]);
  });

  it("a charge on a branch's own statement cannot be booked to another branch", async () => {
    expect((await alex("POST", "/bank-statements/import", imported("R5-STMT-ALEX-2"))).status).toBe(201);
    const line = one<{ id: string }>("SELECT id FROM statement_line WHERE statement_id = 'R5-STMT-ALEX-2'")!.id;
    const entries = one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n;
    const res = await admin("POST", `/bank-statements/R5-STMT-ALEX-2/lines/${line}/create-entry`, { accountId: "5200", branchId: MAIN });
    expect(res.status, JSON.stringify(res.body).slice(0, 240)).toBe(422);
    expect(res.body?.error).toBe("STATEMENT_BRANCH_NOT_THE_ACCOUNTS");
    expect(res.body?.message).toMatch(ARABIC);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n).toBe(entries);
  });
});

describe("D111 round 5 · a return is taken at the counter the goods come back to, whichever branch sold them", () => {
  const INVOICE = "D111-R5-XRET-INV";
  const fromInvoice = (id: string, warehouseId: string) => ({ id, date: TODAY, sourceInvoiceId: INVOICE, warehouseId, reason: "OTHER", requested: [{ itemId: "ITEM-DEMO-1", qty: "1" }] });
  const returnBranchesOf = (id: string) => (JSON.parse(one<{ l: string }>("SELECT lines_json AS l FROM framework_document WHERE id = ?", id)!.l) as { branchId: string | null }[]).map((line) => line.branchId);
  const netByBranch = () => all<{ b: string | null; net: number }>("SELECT branch_id AS b, sum(debit) - sum(credit) AS net FROM journal_line GROUP BY branch_id");

  beforeAll(async () => {
    const base = salesInvoice(INVOICE, MAIN, MAIN_WAREHOUSE);
    const invoice = { ...base, lines: [{ ...base.lines[0]!, isStock: true, qty: "3" }] };
    expect((await admin("POST", "/sales-invoices", invoice)).status).toBe(201);
    const confirmed = await admin("POST", `/sales-invoices/${INVOICE}/confirm`, {});
    expect(confirmed.status, JSON.stringify(confirmed.body).slice(0, 200)).toBe(200);
  });

  it("head office and a user of both branches return branch A's invoice at branch B, and it is booked to B", async () => {
    for (const [tag, caller] of [["ADMIN", admin], ["BOTH", bothBranches]] as const) {
      const id = `D111-R5-XRET-${tag}`;
      const drafted = await caller("POST", "/sales-returns/from-invoice", fromInvoice(id, ALEX_WAREHOUSE));
      expect(drafted.status, `${tag} ${JSON.stringify(drafted.body).slice(0, 300)}`).toBe(201);
      expect(returnBranchesOf(id)).toEqual([ALEX]);
      const stockBefore = one<{ n: number }>("SELECT count(*) AS n FROM stock_movement WHERE warehouse_id = ?", ALEX_WAREHOUSE)!.n;
      const confirmed = await caller("POST", `/sales-returns/${id}/confirm`, {});
      expect(confirmed.status, `${tag} ${JSON.stringify(confirmed.body).slice(0, 300)}`).toBe(200);
      expect(one<{ n: number }>("SELECT count(*) AS n FROM stock_movement WHERE warehouse_id = ?", ALEX_WAREHOUSE)!.n).toBe(stockBefore + 1);
      const moved = all<{ w: string }>("SELECT warehouse_id AS w FROM stock_movement WHERE source_doc_id = ?", id).map((row) => row.w);
      expect(moved).toEqual([ALEX_WAREHOUSE]);
      const branches = all<{ b: string | null }>("SELECT DISTINCT l.branch_id AS b FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id WHERE e.source_doc_id = ?", id);
      expect(branches).toEqual([{ b: ALEX }]);
    }
  });

  it("a user of branch B alone cannot: branch A's invoice is not there for them, and nothing is drafted", async () => {
    const before = one<{ n: number }>("SELECT count(*) AS n FROM framework_document")!.n;
    const res = await alex("POST", "/sales-returns/from-invoice", fromInvoice("D111-R5-XRET-ALEX", ALEX_WAREHOUSE));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(404);
    expect(res.body?.error).toBe("NOT_FOUND");
    expect(res.body?.message).toMatch(ARABIC);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM framework_document")!.n).toBe(before);
  });

  it("a user of branch A alone cannot take it at branch B's counter either", async () => {
    const res = await mainOnly("POST", "/sales-returns/from-invoice", fromInvoice("D111-R5-XRET-MAIN", ALEX_WAREHOUSE));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(403);
    expect(res.body?.error).toBe("BRANCH_OUT_OF_SCOPE");
    expect(one("SELECT id FROM framework_document WHERE id = 'D111-R5-XRET-MAIN'")).toBeUndefined();
  });

  it("a return cannot be split across two branches' stores", async () => {
    const line = (warehouseId: string) => ({ itemId: "ITEM-DEMO-1", warehouseId, customerId: "CUST-DEMO-2", sourceInvoiceId: INVOICE, sourceInvoiceNumber: null, reason: "OTHER", availableQty: "1", qty: "0.5", unitPrice: "100", unitCost: "0", taxAmount: "0" });
    const res = await admin("POST", "/sales-returns", { id: "D111-R5-XRET-SPLIT", date: TODAY, memo: "", lines: [line(ALEX_WAREHOUSE), line(MAIN_WAREHOUSE)] });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(422);
    expect(res.body?.message).toMatch(ARABIC);
    expect(one("SELECT id FROM framework_document WHERE id = 'D111-R5-XRET-SPLIT'")).toBeUndefined();
  });

  it("the ledger by branch, with what no branch owns, still adds up to the company's", () => {
    const company = one<{ net: number }>("SELECT sum(debit) - sum(credit) AS net FROM journal_line")!.net;
    expect(company).toBe(0);
    expect(netByBranch().reduce((sum, row) => sum + row.net, 0)).toBe(company);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM journal_line WHERE branch_id = ''")!.n).toBe(0);
  });
});

describe("D111 round 5 · a user outside a branch admin's branches is not there, on every by-id route", () => {
  const HIDDEN_BY_SCOPE = "D111-R5-USER-NOSCOPE";
  let branchAdmin: typeof alex;
  let hiddenIds: string[];

  beforeAll(async () => {
    branchAdmin = callerFor(await handle.sessions.issue({ userId: "USER-R5-BRANCH-ADMIN", permissions: ["*"], roleCode: null, branchScope: [ALEX], warehouseScope: ALL_SCOPE }));
    const everyBranch = one<{ id: string }>(`SELECT id FROM "user" WHERE branch_scope = '"*"' AND is_company_admin = 0 AND erased_at IS NULL LIMIT 1`)?.id;
    const template = one<Record<string, unknown>>(`SELECT * FROM "user" WHERE id = ?`, everyBranch)!;
    const columns = Object.keys(template);
    sqlite
      .prepare(`INSERT INTO "user" (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .run(...columns.map((column) => (column === "id" ? HIDDEN_BY_SCOPE : column === "email" ? "r5-noscope@cyag.example" : column === "branch_scope" ? "[]" : template[column])));
    hiddenIds = [everyBranch!, HIDDEN_BY_SCOPE];
  });

  it("a user granted no branch at all is listed only to an unrestricted admin", async () => {
    expect(rowsOf((await admin("GET", "/users")).body).map((user: any) => user.id)).toContain(HIDDEN_BY_SCOPE);
    expect(rowsOf((await branchAdmin("GET", "/users")).body).map((user: any) => user.id)).not.toContain(HIDDEN_BY_SCOPE);
  });

  it("every mounted by-id route answers a hidden user exactly as it answers an id nobody holds", async () => {
    const byId = handle.app.routes.filter((route) => route.method !== "ALL" && /^\/users\/:id(\/|$)/.test(route.path));
    expect(byId.length).toBeGreaterThanOrEqual(5);
    const bodies: Record<string, unknown> = { PUT: { nameAr: "اسم جديد" }, POST: {} };
    for (const route of byId) {
      const call = (id: string) => branchAdmin(route.method, route.path.replace(":id", id), route.method === "GET" ? undefined : (bodies[route.method] ?? {}));
      const missing = await call("D111-R5-NO-SUCH-USER");
      expect(missing.status, `${route.method} ${route.path}`).toBe(404);
      expect(missing.body?.message).toMatch(ARABIC);
      for (const id of hiddenIds) {
        const before = JSON.stringify(one(`SELECT * FROM "user" WHERE id = ?`, id));
        const hidden = await call(id);
        expect(hidden.status, `${route.method} ${route.path} ${id}`).toBe(missing.status);
        expect(hidden.body, `${route.method} ${route.path} ${id}`).toEqual(missing.body);
        expect(JSON.stringify(one(`SELECT * FROM "user" WHERE id = ?`, id))).toBe(before);
      }
    }
  });
});

describe("D111 round 5 · a refund is booked to its return's branch and paid from that branch's drawer or the company's account", () => {
  const vouchersFor = (returnId: string) => one<{ n: number }>("SELECT count(*) AS n FROM voucher WHERE id LIKE ?", `REFUND:${returnId}:%`)!.n;

  it("is refused out of another branch's drawer, for head office too, and nothing is posted", async () => {
    const entries = one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n;
    for (const [caller, status, error] of [[admin, 422, "SALES_RETURN_REFUND_TREASURY_BRANCH"], [bothBranches, 403, "TREASURY_BRANCH_MISMATCH"]] as const) {
      const res = await caller("POST", "/sales-returns/D111-R4-REFUND-SRT/refund", { amount: "5.00", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash" });
      expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(status);
      expect(res.body?.error).toBe(error);
      expect(res.body?.message).toMatch(ARABIC);
    }
    expect(one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n).toBe(entries);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM voucher WHERE id LIKE 'REFUND:D111-R4-REFUND-SRT:%' AND treasury_account_id = 'TR-DEMO-CASH'")!.n).toBe(0);
  });

  it("is paid from the return's own branch's drawer and carries that branch", async () => {
    const funded = await admin("POST", "/vouchers", { ...voucher("D111-R5-REFUND-FUND", ALEX, "TR-DEMO-CASH-ALEX", "1300-ALEX"), amount: "50.00" });
    expect(funded.status, JSON.stringify(funded.body).slice(0, 200)).toBe(201);
    expect((await admin("POST", "/vouchers/D111-R5-REFUND-FUND/confirm", {})).status).toBe(200);
    const before = vouchersFor("D111-R4-REFUND-SRT");
    const res = await admin("POST", "/sales-returns/D111-R4-REFUND-SRT/refund", { amount: "5.00", treasuryAccountId: "TR-DEMO-CASH-ALEX", paymentMethod: "cash" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(vouchersFor("D111-R4-REFUND-SRT")).toBe(before + 1);
    expect(one<{ b: string }>("SELECT branch_id AS b FROM voucher WHERE id = ?", res.body.voucherId)!.b).toBe(ALEX);
  });

  it("a return taken at branch B for branch A's invoice is refunded as branch B's", async () => {
    const res = await admin("POST", "/sales-returns/D111-R5-XRET-ADMIN/refund", { amount: "5.00", treasuryAccountId: "TR-DEMO-CASH-ALEX", paymentMethod: "cash" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(one<{ b: string }>("SELECT branch_id AS b FROM voucher WHERE id = ?", res.body.voucherId)!.b).toBe(ALEX);
    const fromSellingBranch = await admin("POST", "/sales-returns/D111-R5-XRET-ADMIN/refund", { amount: "5.00", treasuryAccountId: "TR-DEMO-CASH", paymentMethod: "cash" });
    expect(fromSellingBranch.status).toBe(422);
  });
});

describe("D111 round 5 · a cheque is collected into a real, active bank account", () => {
  const cheque = (id: string, number: string) => ({
    id,
    direction: "incoming",
    chequeNumber: number,
    bankName: "بنك الاختبار",
    amount: "250.00",
    issueDate: TODAY,
    dueDate: TODAY,
    branchId: MAIN,
    partyId: "CUST-DEMO-2",
    counterpartyGlAccountId: "1105",
    controlAccounts: { underCollectionAccountId: "1320" },
  });
  const entries = () => one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n;
  const linesOnNoAccount = () => one<{ n: number }>("SELECT count(*) AS n FROM journal_line WHERE account_id = ''")!.n;
  const stateOf = (id: string) => one<{ status: string; bank: string | null }>("SELECT status, bank_treasury_account_id AS bank FROM cheque WHERE id = ?", id)!;

  it("a deposited cheque with no bank account on record is not collected onto no account: the bank account is asked for", async () => {
    expect((await admin("POST", "/cheques", cheque("D111-R5-CHQ-NOBANK", "D111-R5-0001"))).status).toBe(201);
    expect((await admin("POST", "/cheques/D111-R5-CHQ-NOBANK/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK" })).status).toBe(200);
    sqlite.prepare("UPDATE cheque SET bank_treasury_account_id = NULL WHERE id = 'D111-R5-CHQ-NOBANK'").run();
    const before = entries();
    const res = await admin("POST", "/cheques/D111-R5-CHQ-NOBANK/collect", {});
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(422);
    expect(res.body?.error).toBe("CHEQUE_BANK_ACCOUNT_REQUIRED");
    expect(res.body?.message).toMatch(ARABIC);
    expect(entries()).toBe(before);
    expect(linesOnNoAccount()).toBe(0);
    expect(stateOf("D111-R5-CHQ-NOBANK").status).toBe("deposited");

    const chosen = await admin("POST", "/cheques/D111-R5-CHQ-NOBANK/collect", { bankTreasuryAccountId: "TR-DEMO-BANK" });
    expect(chosen.status, JSON.stringify(chosen.body).slice(0, 300)).toBe(200);
    expect(stateOf("D111-R5-CHQ-NOBANK")).toEqual({ status: "collected", bank: "TR-DEMO-BANK" });
  });

  it("a cheque deposited at an account since deactivated is collected into another active bank account chosen at collect time", async () => {
    expect((await admin("POST", "/treasury-accounts", { id: "D111-R5-TR-OLD-BANK", code: "R5-OLD", name: "بنك مغلق", type: "bank", currency: "EGP", branchId: MAIN, glAccountId: "1310" })).status).toBe(201);
    expect((await admin("POST", "/cheques", cheque("D111-R5-CHQ-OLDBANK", "D111-R5-0002"))).status).toBe(201);
    expect((await admin("POST", "/cheques/D111-R5-CHQ-OLDBANK/deposit", { bankTreasuryAccountId: "D111-R5-TR-OLD-BANK" })).status).toBe(200);
    expect((await admin("PATCH", "/treasury-accounts/D111-R5-TR-OLD-BANK", { status: "inactive" })).status).toBe(200);

    const before = entries();
    const stuck = await admin("POST", "/cheques/D111-R5-CHQ-OLDBANK/collect", {});
    expect(stuck.status).toBe(422);
    expect(stuck.body?.error).toBe("CHEQUE_BANK_ACCOUNT_REQUIRED");
    const intoDrawer = await admin("POST", "/cheques/D111-R5-CHQ-OLDBANK/collect", { bankTreasuryAccountId: "TR-DEMO-CASH" });
    expect(intoDrawer.status, JSON.stringify(intoDrawer.body).slice(0, 200)).toBe(422);
    expect(intoDrawer.body?.message).toMatch(ARABIC);
    expect(entries()).toBe(before);

    const collected = await admin("POST", "/cheques/D111-R5-CHQ-OLDBANK/collect", { bankTreasuryAccountId: "TR-DEMO-BANK" });
    expect(collected.status, JSON.stringify(collected.body).slice(0, 300)).toBe(200);
    expect(stateOf("D111-R5-CHQ-OLDBANK")).toEqual({ status: "collected", bank: "TR-DEMO-BANK" });
    const entryId = one<{ id: string }>("SELECT collection_journal_entry_id AS id FROM cheque WHERE id = 'D111-R5-CHQ-OLDBANK'")!.id;
    expect(all<{ a: string; t: string | null }>("SELECT account_id AS a, treasury_account_id AS t FROM journal_line WHERE entry_id = ? AND debit > 0", entryId)).toEqual([{ a: "1310", t: "TR-DEMO-BANK" }]);
  });

  it("a cheque whose bank account is still active is not redirected to another one", async () => {
    expect((await admin("POST", "/cheques", cheque("D111-R5-CHQ-FIXED", "D111-R5-0003"))).status).toBe(201);
    expect((await admin("POST", "/cheques/D111-R5-CHQ-FIXED/deposit", { bankTreasuryAccountId: "TR-DEMO-BANK" })).status).toBe(200);
    expect((await admin("POST", "/treasury-accounts", { id: "D111-R5-TR-BANK-2", code: "R5-B2", name: "بنك آخر", type: "bank", currency: "EGP", branchId: MAIN, glAccountId: "1310" })).status).toBe(201);
    const before = entries();
    const res = await admin("POST", "/cheques/D111-R5-CHQ-FIXED/collect", { bankTreasuryAccountId: "D111-R5-TR-BANK-2" });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(422);
    expect(res.body?.error).toBe("CHEQUE_BANK_ACCOUNT_FIXED");
    expect(res.body?.message).toMatch(ARABIC);
    expect(entries()).toBe(before);
    expect(stateOf("D111-R5-CHQ-FIXED")).toEqual({ status: "deposited", bank: "TR-DEMO-BANK" });
  });
});

describe("D111 round 5 · a counter clerk records the tax identity of a customer of its own branch", () => {
  const identity = { taxNumber: "311-222-333", nationalId: "29001011234567", etaBuyerType: "business", commercialRegistrationNumber: "CR-7788" } as const;
  const stored = (id: string) => one<{ tax_number: string | null; national_id: string | null; eta_buyer_type: string; branch_id: string | null }>("SELECT tax_number, national_id, eta_buyer_type, branch_id FROM customer WHERE id = ?", id)!;

  it("sets it when it creates the customer, who lands in its branch", async () => {
    const res = await alex("POST", "/customers", { id: "D111-R5-CUST-COUNTER", nameAr: "عميل الشباك", phone: "01000000000", ...identity });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(201);
    expect(stored("D111-R5-CUST-COUNTER")).toEqual({ tax_number: identity.taxNumber, national_id: identity.nationalId, eta_buyer_type: "business", branch_id: ALEX });
  });

  it("corrects it later on a customer of its own branch", async () => {
    const res = await alex("PATCH", "/customers/D111-R5-CUST-COUNTER", { taxNumber: "311-222-334", etaBuyerType: "individual" });
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(stored("D111-R5-CUST-COUNTER")).toMatchObject({ tax_number: "311-222-334", eta_buyer_type: "individual" });
  });

  it("still cannot set a credit limit, an opening balance or a price list while doing so", async () => {
    for (const body of [{ creditLimit: "5000.00" }, { openingBalance: "100.00" }, { paymentTermsDays: 90 }]) {
      const created = await alex("POST", "/customers", { id: "D111-R5-CUST-GREEDY", nameAr: "عميل", ...identity, ...body });
      expect(created.status, JSON.stringify(created.body).slice(0, 200)).toBe(403);
      expect(created.body?.error).toBe("SHARED_FIELD_RESTRICTED");
      const edited = await alex("PATCH", "/customers/D111-R5-CUST-COUNTER", body);
      expect(edited.status).toBe(403);
    }
    expect(one("SELECT id FROM customer WHERE id = 'D111-R5-CUST-GREEDY'")).toBeUndefined();
  });

  it("cannot touch the tax identity of the company's customer or of another branch's", async () => {
    const company = stored("CUST-DEMO-2");
    expect(company.branch_id).toBeNull();
    const onCompany = await alex("PATCH", "/customers/CUST-DEMO-2", { taxNumber: "999" });
    expect(onCompany.status).toBe(403);
    expect(onCompany.body?.error).toBe("SHARED_FIELD_RESTRICTED");
    await alex("PATCH", "/customers/CUST-DEMO-2", { branchId: ALEX });
    expect(stored("CUST-DEMO-2")).toEqual(company);

    expect((await admin("POST", "/customers", { id: "ZZ-D111-R5-CUST-MAIN-ID", nameAr: "عميل الرئيسي", branchId: MAIN, taxNumber: "100-100-100" })).status).toBe(201);
    const onForeign = await alex("PATCH", "/customers/ZZ-D111-R5-CUST-MAIN-ID", { taxNumber: "999" });
    expect([403, 404]).toContain(onForeign.status);
    expect(onForeign.body?.message).toMatch(ARABIC);
    expect(stored("ZZ-D111-R5-CUST-MAIN-ID").tax_number).toBe("100-100-100");
  });
});

describe("D111 round 5 · a warehouse or a cash account nobody holds answers as one another branch holds", () => {
  it("in a document body", async () => {
    const pairs: (readonly [label: string, path: string, body: (id: string) => unknown, foreign: string])[] = [
      ["warehouse on an invoice", "/sales-invoices", (id) => salesInvoice(`D111-R5-LOC-${id.length}`, ALEX, id), MAIN_WAREHOUSE],
      ["cash account on a voucher", "/vouchers", (id) => voucher(`D111-R5-LOC-V-${id.length}`, ALEX, id, "1300-ALEX"), "TR-DEMO-BANK"],
      ["warehouse on a transfer line", "/inventory/stock-transfers/draft", (id) => ({ id: `D111-R5-LOC-T-${id.length}`, date: TODAY, memo: "", lines: [{ itemId: "ITEM-DEMO-1", fromWarehouseId: ALEX_WAREHOUSE, toWarehouseId: id, qty: "1" }] }), MAIN_WAREHOUSE],
    ];
    for (const [label, path, body, foreign] of pairs) {
      for (const caller of [alex, alexStar]) {
        const held = await caller("POST", path, body(foreign));
        const nobody = await caller("POST", path, body("D111-R5-NO-SUCH-PLACE"));
        expect(held.status, label).toBe(403);
        expect(nobody.status, `${label} ${JSON.stringify(nobody.body).slice(0, 200)}`).toBe(held.status);
        expect(nobody.body, label).toEqual(held.body);
        expect(nobody.body?.message).toMatch(ARABIC);
      }
    }
    expect(one<{ n: number }>("SELECT count(*) AS n FROM sales_invoice WHERE id LIKE 'D111-R5-LOC-%'")!.n).toBe(0);
    expect(one<{ n: number }>("SELECT count(*) AS n FROM voucher WHERE id LIKE 'D111-R5-LOC-%'")!.n).toBe(0);
  });

  it("in a stock query", async () => {
    const held = await alex("GET", `/inventory/stock-balance?warehouseId=${MAIN_WAREHOUSE}`);
    const nobody = await alex("GET", "/inventory/stock-balance?warehouseId=D111-R5-NO-SUCH-PLACE");
    expect(held.status).toBe(403);
    expect(nobody.status).toBe(held.status);
    expect(nobody.body).toEqual(held.body);
  });

  it("an unrestricted session is still told plainly that the place does not exist", async () => {
    const res = await admin("POST", "/sales-invoices", salesInvoice("D111-R5-LOC-ADMIN", ALEX, "D111-R5-NO-SUCH-PLACE"));
    expect([404, 422]).toContain(res.status);
    expect(one("SELECT id FROM sales_invoice WHERE id = 'D111-R5-LOC-ADMIN'")).toBeUndefined();
  });
});

describe("D111 · a reversal, a void, a resubmit and a tax tag need the branch grant of the document they act on", () => {
  const REASON = { memo: "سبب الاختبار", reason: "سبب الاختبار", date: TODAY };
  const journalEntries = () => one<{ n: number }>("SELECT count(*) AS n FROM journal_entry")!.n;
  const adjustment = (id: string) => ({
    id,
    date: TODAY,
    lines: [{ itemId: "ITEM-DEMO-1", warehouseId: MAIN_WAREHOUSE, reason: "OTHER", direction: "IN", qty: "1", unitCost: "140" }],
  });

  async function confirmedAdjustment(id: string): Promise<void> {
    const drafted = await admin("POST", "/inventory/stock-adjustments/draft", adjustment(id));
    expect([201, 409], JSON.stringify(drafted.body).slice(0, 200)).toContain(drafted.status);
    const confirmed = await admin("POST", `/inventory/stock-adjustments/${id}/confirm`, {});
    expect([200, 409], JSON.stringify(confirmed.body).slice(0, 200)).toContain(confirmed.status);
    expect(one<{ status: string }>("SELECT status FROM stock_adjustment_document WHERE id = ?", id)?.status).toBe("confirmed");
  }

  interface MainBranchAction {
    readonly path: string;
    readonly state: () => unknown;
  }

  const mainBranchActions = (): MainBranchAction[] => {
    const postedRun = one<{ id: string }>("SELECT id FROM depreciation_run WHERE branch_id = ? AND status = 'posted' LIMIT 1", MAIN)!.id;
    const adjustmentState = row("stock_adjustment_document", "D111-REV-ADJ", "status, journal_entry_id");
    const landedCost = row("framework_document", "LC-DEMO-2", "status, journal_entry_id");
    const salesReturn = row("framework_document", "SRT-DEMO-2", "status, journal_entry_id");
    const purchaseReturn = row("framework_document", "PRT-DEMO-2", "status, journal_entry_id");
    const salesInvoiceState = row("sales_invoice", "D111-MAIN-INV");
    const purchaseInvoiceState = row("purchase_invoice", "D111-MAIN-PI");
    return [
      { path: "/inventory/stock-adjustments/D111-REV-ADJ/reverse", state: adjustmentState },
      { path: "/inventory/stock-adjustments/D111-REV-ADJ/resubmit", state: adjustmentState },
      { path: "/inventory/adjustments/D111-REV-ADJ/reverse", state: adjustmentState },
      { path: "/landed-costs/LC-DEMO-2/reverse", state: landedCost },
      { path: "/landed-costs/LC-DEMO-2/resubmit", state: landedCost },
      { path: "/cheques/CHQ-DEMO-1/return", state: row("cheque", "CHQ-DEMO-1", "status") },
      { path: "/assets/ASSET-DEMO-2/undo-disposal", state: row("asset", "ASSET-DEMO-2", "status") },
      { path: `/assets/depreciation/runs/${postedRun}/reverse`, state: row("depreciation_run", postedRun, "status") },
      { path: "/sales-returns/SRT-DEMO-2/void", state: salesReturn },
      { path: "/sales-returns/SRT-DEMO-2/resubmit", state: salesReturn },
      { path: "/sales-returns/SRT-DEMO-2/lines/0/journal-tax", state: salesReturn },
      { path: "/purchase-returns/PRT-DEMO-2/void", state: purchaseReturn },
      { path: "/purchase-returns/PRT-DEMO-2/resubmit", state: purchaseReturn },
      { path: "/purchase-returns/PRT-DEMO-2/lines/0/journal-tax", state: purchaseReturn },
      { path: "/sales-invoices/D111-MAIN-INV/void", state: salesInvoiceState },
      { path: "/sales-invoices/D111-MAIN-INV/eta-receipt/retry", state: salesInvoiceState },
      { path: "/sales-invoices/D111-MAIN-INV/lines/D111-MAIN-INV-L1/classify-tax", state: salesInvoiceState },
      { path: "/sales-invoices/D111-MAIN-INV/lines/D111-MAIN-INV-L1/journal-tax", state: salesInvoiceState },
      { path: "/purchases/invoices/D111-MAIN-PI/lines/0/classify-tax", state: purchaseInvoiceState },
      { path: "/purchases/invoices/D111-MAIN-PI/lines/0/journal-tax", state: purchaseInvoiceState },
      { path: "/vouchers/D111-MAIN-VCH/resubmit", state: row("voucher", "D111-MAIN-VCH", "status, journal_entry_id") },
    ];
  };

  it("another branch's document refuses every one of them, in Arabic, and nothing is written", async () => {
    await confirmedAdjustment("D111-REV-ADJ");
    for (const action of mainBranchActions()) {
      const before = action.state();
      expect(before, `${action.path}: the document must exist in the seeded books`).toBeTruthy();
      for (const [label, caller] of [["non-admin", alex], ["* admin granted one branch", alexStar]] as const) {
        const entries = journalEntries();
        const res = await caller("POST", action.path, { ...REASON, taxRateId: "VAT14" });
        expect([403, 404], `${label} POST ${action.path} → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toContain(res.status);
        expectRefusedInArabic(res);
        expect(action.state(), `${label} POST ${action.path} must leave the stored row untouched`).toEqual(before);
        expect(journalEntries(), `${label} POST ${action.path} must post nothing`).toBe(entries);
      }
    }
  });

  it.each([
    ["POST", "/revaluation/runs/NO-SUCH-RUN/reverse"],
    ["POST", "/gl/year-end-close/2025/reopen"],
    ["POST", "/hr/payroll/provisions/leave/2026-01-31/reverse"],
    ["POST", "/contracting/guarantees/NO-SUCH/reverse-last"],
    ["POST", "/contracting/site/equipment-logs/NO-SUCH/reverse"],
    ["POST", "/contracting/site/consumptions/NO-SUCH/reverse"],
    ["GET", "/period-close/fp-2026-08/checks"],
    ["GET", "/period-close/fp-2026-08/summaries"],
  ] as const)("%s %s is the whole company's, and closed to a branch-restricted session whatever it holds", async (method, path) => {
    for (const caller of [alex, alexStar]) {
      const res = await caller(method, path, method === "POST" ? REASON : undefined);
      expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(403);
      expect(res.body?.error).toBe("COMPANY_WIDE_REPORT");
      expect(res.body?.message).toMatch(ARABIC);
    }
  });

  it("a user granted the document's branch reverses it, and the reversal's lines stay in that branch", async () => {
    await confirmedAdjustment("D111-REV-ADJ-OK");
    const mainStar = callerFor(await handle.sessions.issue({ userId: "USER-D111-MAIN-STAR", permissions: ["*"], roleCode: null, branchScope: [MAIN], warehouseScope: ALL_SCOPE }));
    const reversed = await mainStar("POST", "/inventory/stock-adjustments/D111-REV-ADJ-OK/reverse", REASON);
    expect([200, 201], JSON.stringify(reversed.body).slice(0, 300)).toContain(reversed.status);
    expect(one<{ status: string }>("SELECT status FROM stock_adjustment_document WHERE id = 'D111-REV-ADJ-OK'")?.status).toBe("reversed");
    const lines = all<{ id: string; memo: string | null; source_doc_id: string | null; branch_id: string | null; debit: number; credit: number }>(
      "SELECT e.id, e.memo, e.source_doc_id, l.branch_id, l.debit, l.credit FROM journal_line l JOIN journal_entry e ON e.id = l.entry_id WHERE e.source_doc_id LIKE 'D111-REV-ADJ-OK%' OR e.id LIKE 'D111-REV-ADJ-OK%'",
    );
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.filter((line) => line.branch_id !== MAIN)).toEqual([]);
  });

  it("a source invoice of another branch answers a return exactly as an invoice nobody holds", async () => {
    const mainSales = one<{ id: string }>("SELECT id FROM sales_invoice WHERE branch_id = ? AND status = 'confirmed' LIMIT 1", MAIN)!.id;
    const mainPurchase = one<{ id: string }>("SELECT id FROM purchase_invoice WHERE branch_id = ? AND status = 'confirmed' LIMIT 1", MAIN)!.id;
    for (const [family, held] of [["/sales-returns", mainSales], ["/purchase-returns", mainPurchase]] as const) {
      expect((await mainOnly("GET", `${family}/source-lines/${held}`)).status, family).toBe(200);
      for (const caller of [alex, alexStar]) {
        const foreign = await caller("GET", `${family}/source-lines/${held}`);
        const absent = await caller("GET", `${family}/source-lines/D111-NO-SUCH-INVOICE`);
        expect(foreign.status, family).toBe(404);
        expect([foreign.status, foreign.body], family).toEqual([absent.status, absent.body]);
      }
    }
  });
});
