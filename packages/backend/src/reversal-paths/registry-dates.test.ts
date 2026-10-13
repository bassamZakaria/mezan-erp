import { DOCUMENT_REVERSAL_PATHS, ReversalDocumentType } from "@mezan/api";
import { reversalRoute } from "@mezan/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INVARIANTS_ZERO, seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const ARABIC = /[؀-ۿ]/;
const REASON = "سبب العكس";
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());

interface Reversible {
  readonly params: Readonly<Record<string, string>>;
  readonly originalDate: string;
  readonly mirror?: { readonly list: string; readonly detail: (id: string) => string; readonly originalId: string };
}

async function ok(method: string, url: string, body: unknown, status: number): Promise<Record<string, unknown>> {
  const res = await world.request(method, url, body);
  expect(`${res.status} ${method} ${url}`, JSON.stringify(res.body)).toBe(`${status} ${method} ${url}`);
  return res.body;
}

const latestEntryDate = (docType: string, docId: string) =>
  (world.sqlite.prepare(`SELECT MAX(substr(date, 1, 10)) AS day FROM journal_entry WHERE source_doc_type = ? AND source_doc_id = ? AND status = 'posted'`).get(docType, docId) as { day: string }).day;
const entryDate = (entryId: string) => (world.sqlite.prepare(`SELECT substr(date, 1, 10) AS day FROM journal_entry WHERE id = ?`).get(entryId) as { day: string }).day;

const FIXTURES: Record<ReversalDocumentType, (() => Promise<Reversible>) | null> = {
  [ReversalDocumentType.YearEndClose]: null,
  [ReversalDocumentType.FxRevaluation]: async () => {
    const posted = await ok("POST", "/revaluation/post", { date: "2026-08-31", currencies: ["USD"], autoReverse: false }, 201);
    return { params: { entryId: String(posted.entryId) }, originalDate: "2026-08-31" };
  },
  [ReversalDocumentType.PayrollRun]: async () => {
    await ok("POST", "/hr/payroll/runs/PR-DEMO-3/approve", {}, 200);
    return { params: { id: "PR-DEMO-3" }, originalDate: latestEntryDate("PAYROLL_RUN", "PR-DEMO-3") };
  },
  [ReversalDocumentType.EmployeeAdvance]: async () => {
    world.sqlite.prepare(`UPDATE hr_employee_advance SET status = 'approved' WHERE id = 'ADV-DEMO-4'`).run();
    await ok("POST", "/hr/advances/ADV-DEMO-4/disburse", { treasuryAccountId: "TR-DEMO-BANK", branchId: "BR-MAIN", date: "2026-08-12", paymentMethod: "bank" }, 200);
    return { params: { id: "ADV-DEMO-4" }, originalDate: "2026-08-12" };
  },
  [ReversalDocumentType.Cheque]: async () => {
    const cheque = world.sqlite.prepare(`SELECT collection_journal_entry_id AS entryId FROM cheque WHERE id = 'CHQ-DEMO-2'`).get() as { entryId: string };
    return { params: { id: "CHQ-DEMO-2" }, originalDate: entryDate(cheque.entryId) };
  },
  [ReversalDocumentType.AssetDisposal]: async () => {
    await ok("POST", "/assets/ASSET-DEMO-5/dispose", { date: "2026-08-20", proceeds: "9000.00", proceedsAccountId: "1310" }, 200);
    return { params: { id: "ASSET-DEMO-5" }, originalDate: "2026-08-20" };
  },
  [ReversalDocumentType.HrLeaveProvision]: async () => {
    await ok("POST", "/hr/payroll/provisions/leave", { asOfDate: "2026-08-31" }, 200);
    return { params: { kind: "leave", asOfDate: "2026-08-31" }, originalDate: "2026-08-31" };
  },
  [ReversalDocumentType.StockAdjustment]: async () => {
    await ok("POST", "/inventory/stock-adjustments/draft", { id: "RD-ADJ", date: "2026-08-18", memo: "زيادة بالخطأ", lines: [{ itemId: "ITEM-DEMO-1", warehouseId: "WH-MAIN", reason: "OTHER", direction: "IN", qty: "10", unitCost: "1.00" }] }, 201);
    await ok("POST", "/inventory/stock-adjustments/RD-ADJ/confirm", {}, 200);
    return { params: { id: "RD-ADJ" }, originalDate: "2026-08-18", mirror: { list: "/inventory/stock-adjustments", detail: (id) => `/inventory/stock-adjustments/${encodeURIComponent(id)}`, originalId: "RD-ADJ" } };
  },
  [ReversalDocumentType.Adjustment]: async () => {
    await ok("POST", "/inventory/adjustments", { adjustmentId: "RD-DIRECT", warehouseId: "WH-MAIN", reason: "DAMAGE", occurredAt: "2026-08-18", lines: [{ itemId: "ITEM-DEMO-1", direction: "OUT", qty: "2" }] }, 201);
    return { params: { id: "RD-DIRECT" }, originalDate: "2026-08-18" };
  },
  [ReversalDocumentType.WritedownRun]: async () => {
    const run = world.sqlite.prepare(`SELECT id, journal_entry_id AS entryId FROM writedown_run WHERE status = 'posted' ORDER BY created_at LIMIT 1`).get() as { id: string; entryId: string };
    return { params: { id: run.id }, originalDate: entryDate(run.entryId) };
  },
  [ReversalDocumentType.LetterOfGuarantee]: async () => {
    await ok("POST", "/contracting/guarantees", { id: "RD-LG", kind: "bid", tenderRef: "مناقصة 2026/15", beneficiaryNameAr: "جهة الإسناد", bankTreasuryAccountId: "TR-DEMO-BANK", faceValue: "100000.00", cashMarginAmount: "10000.00", issueDate: "2026-08-03", expiryDate: "2027-08-03" }, 201);
    await ok("POST", "/contracting/guarantees/RD-LG/issue", {}, 200);
    return { params: { id: "RD-LG" }, originalDate: "2026-08-03" };
  },
  [ReversalDocumentType.EquipmentLog]: async () => {
    const log = world.sqlite.prepare(`SELECT id, substr(date, 1, 10) AS day FROM equipment_log WHERE status = 'confirmed' AND date >= '2026-08-01' ORDER BY id LIMIT 1`).get() as { id: string; day: string };
    return { params: { id: log.id }, originalDate: log.day };
  },
  [ReversalDocumentType.MaterialConsumption]: async () => {
    const doc = world.sqlite.prepare(`SELECT substr(date, 1, 10) AS day FROM material_consumption WHERE id = 'CON-DEMO-SUB-1'`).get() as { day: string };
    return { params: { id: "CON-DEMO-SUB-1" }, originalDate: doc.day };
  },
  [ReversalDocumentType.LandedCost]: async () => {
    await ok("POST", "/items", { id: "RD-LC-ITEM", code: "RD-LC-ITEM", nameAr: "صنف", type: "stock", baseUnitCode: "PCS" }, 201);
    await ok("POST", "/inventory/adjustments", { adjustmentId: "RD-LC-IN", warehouseId: "WH-MAIN", reason: "INITIAL_STOCK", occurredAt: "2026-08-05", lines: [{ itemId: "RD-LC-ITEM", direction: "IN", qty: "10", unitCost: "100" }] }, 201);
    await ok("POST", "/landed-costs", { id: "RD-LC", date: "2026-08-10", memo: "شحن", distributionMethod: "BY_QUANTITY", costItems: [{ costType: "SHIPPING", description: "شحن", amount: "100" }], targets: [{ itemId: "RD-LC-ITEM", warehouseId: "WH-MAIN", sourceInvoiceId: "RD-LC-IN", sourceInvoiceNumber: "RD-LC-IN", qty: "10", unitCost: "100" }] }, 201);
    await ok("POST", "/landed-costs/RD-LC/confirm", {}, 200);
    return { params: { id: "RD-LC" }, originalDate: "2026-08-10", mirror: { list: "/landed-costs", detail: (id) => `/landed-costs/${encodeURIComponent(id)}`, originalId: "RD-LC" } };
  },
  [ReversalDocumentType.Voucher]: async () => {
    await ok("POST", "/vouchers", { id: "RD-CV", date: "2026-08-18", voucherType: "other_expense", amount: "250", branchId: "BR-MAIN", paymentMethod: "bank", treasuryAccountId: "TR-DEMO-BANK", treasuryGlAccountId: "1310", counterpartyGlAccountId: "5900", memo: "مصروف سُجّل بالخطأ" }, 201);
    await ok("POST", "/vouchers/RD-CV/confirm", {}, 200);
    return { params: { id: "RD-CV" }, originalDate: "2026-08-18" };
  },
  [ReversalDocumentType.DepreciationRun]: async () => {
    const run = world.sqlite.prepare(`SELECT id, journal_entry_id AS entryId FROM depreciation_run WHERE status = 'posted' AND journal_entry_id IS NOT NULL ORDER BY period DESC LIMIT 1`).get() as { id: string; entryId: string };
    return { params: { id: run.id }, originalDate: entryDate(run.entryId) };
  },
  [ReversalDocumentType.RecurringJournalTemplate]: async () => {
    const runs = (await world.request("GET", "/gl/recurring/runs")).body as unknown as { id: string; journalEntryId: string; entryStatus: string; current: boolean }[];
    const run = runs.find((row) => row.current && (row.entryStatus === "draft" || row.entryStatus === "posted"))!;
    if (run.entryStatus === "draft") await ok("POST", `/gl/journal-entries/${encodeURIComponent(run.journalEntryId)}/post`, {}, 200);
    return { params: { id: run.id }, originalDate: entryDate(run.journalEntryId) };
  },
};

const REVERSED_STATUS = "reversed";

const FAMILY_TOTALS: Record<ReversalDocumentType, readonly string[] | null> = {
  [ReversalDocumentType.Voucher]: ["/vouchers/stats", "/vouchers/counts"],
  [ReversalDocumentType.StockAdjustment]: ["/inventory/stock-adjustments/stats", "/inventory/stock-adjustments/counts"],
  [ReversalDocumentType.AssetDisposal]: ["/assets/stats", "/assets/counts"],
  [ReversalDocumentType.FxRevaluation]: null,
  [ReversalDocumentType.PayrollRun]: null,
  [ReversalDocumentType.EmployeeAdvance]: null,
  [ReversalDocumentType.Cheque]: null,
  [ReversalDocumentType.YearEndClose]: null,
  [ReversalDocumentType.HrLeaveProvision]: null,
  [ReversalDocumentType.Adjustment]: null,
  [ReversalDocumentType.WritedownRun]: null,
  [ReversalDocumentType.LetterOfGuarantee]: null,
  [ReversalDocumentType.EquipmentLog]: null,
  [ReversalDocumentType.MaterialConsumption]: null,
  [ReversalDocumentType.LandedCost]: null,
  [ReversalDocumentType.DepreciationRun]: null,
  [ReversalDocumentType.RecurringJournalTemplate]: null,
};

async function familyTotals(type: ReversalDocumentType): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const url of FAMILY_TOTALS[type] ?? []) {
    const { [REVERSED_STATUS]: _found, ...totals } = (await world.request("GET", url)).body;
    out[url] = totals;
  }
  return out;
}

const dayBefore = (day: string) => {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};
const periodOf = (day: string) => world.sqlite.prepare(`SELECT id, status FROM fiscal_period WHERE start_date <= ? AND end_date >= ?`).get(day, day) as { id: string; status: string };
function earliestOpenDayFrom(day: string): string | null {
  const open = world.sqlite.prepare(`SELECT start_date AS start FROM fiscal_period WHERE status = 'open' AND end_date >= ? ORDER BY start_date LIMIT 1`).get(day) as { start: string } | undefined;
  if (!open) return null;
  return open.start > day ? open.start : day;
}
const maxEntryRow = () => (world.sqlite.prepare(`SELECT COALESCE(MAX(rowid), 0) AS n FROM journal_entry`).get() as { n: number }).n;
const entriesSince = (rowid: number) => world.sqlite.prepare(`SELECT id, entry_no AS entryNo, substr(date, 1, 10) AS day FROM journal_entry WHERE rowid > ? ORDER BY rowid`).all(rowid) as { id: string; entryNo: string | null; day: string }[];

describe("every reversal route in the registry dates and numbers its reversal the same way", () => {
  const dated = Object.entries(DOCUMENT_REVERSAL_PATHS).filter(([, path]) => path.takesDate) as [ReversalDocumentType, (typeof DOCUMENT_REVERSAL_PATHS)[ReversalDocumentType]][];

  it("names the list totals of every family that has them, and says so for the ones that have none", () => {
    expect(Object.keys(FAMILY_TOTALS).sort()).toEqual(Object.keys(DOCUMENT_REVERSAL_PATHS).sort());
  });

  it("has a way to raise a reversible document for every route that takes a date", () => {
    for (const [type] of dated) expect(FIXTURES[type], type).not.toBeNull();
    expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(DOCUMENT_REVERSAL_PATHS).sort());
  });

  it.each(dated)("%s: a date before the original is refused, a blank date means today, a closed today names the earliest open day, and the mirror is numbered and linked both ways", async (type, path) => {
    const totalsBefore = await familyTotals(type);
    const fixture = await FIXTURES[type]!();
    const url = reversalRoute(type, fixture.params);
    expect(fixture.originalDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fixture.originalDate <= TODAY).toBe(true);

    const early = await world.request(path.method, url, { memo: REASON, date: dayBefore(fixture.originalDate) });
    expect(`${early.status} ${String(early.body.error)}`, JSON.stringify(early.body)).toBe("422 REVERSAL_DATE_BEFORE_ORIGINAL");
    expect(String(early.body.message)).toMatch(ARABIC);

    const today = periodOf(TODAY);
    expect(today.status).toBe("open");
    world.sqlite.prepare(`UPDATE fiscal_period SET status = 'closed' WHERE id = ?`).run(today.id);
    try {
      const expected = earliestOpenDayFrom(fixture.originalDate);
      const closed = await world.request(path.method, url, { memo: REASON });
      expect(`${closed.status} ${String(closed.body.error)}`, JSON.stringify(closed.body)).toBe("422 PERIOD_NOT_OPEN_FOR_POSTING");
      expect(String(closed.body.message)).toMatch(ARABIC);
      expect(closed.body.earliestOpenDate ?? null).toBe(expected);
    } finally {
      world.sqlite.prepare(`UPDATE fiscal_period SET status = 'open' WHERE id = ?`).run(today.id);
    }

    const before = maxEntryRow();
    const reversed = await world.request(path.method, url, { memo: REASON });
    expect([200, 201], `${reversed.status} ${JSON.stringify(reversed.body)}`).toContain(reversed.status);
    const posted = entriesSince(before);
    expect(posted.length).toBeGreaterThan(0);
    for (const entry of posted) {
      expect(`${entry.id} ${entry.day}`).toBe(`${entry.id} ${TODAY}`);
      expect(entry.entryNo, entry.id).toMatch(/\d/);
    }

    expect(await familyTotals(type), "the family's list totals and KPIs read as they did before the original was posted").toEqual(totalsBefore);

    if (fixture.mirror) {
      const original = (await world.request("GET", fixture.mirror.detail(fixture.mirror.originalId))).body as { docNo: string; status: string; reversedByDocId: string | null };
      expect(original.status).toBe("reversed");
      expect(original.reversedByDocId).toEqual(expect.any(String));
      const mirror = (await world.request("GET", fixture.mirror.detail(String(original.reversedByDocId)))).body as { docNo: string | null; date: string; reversesDocId: string | null };
      expect(mirror.docNo, "the reversal document has a number of its own").toMatch(/\d/);
      expect(mirror.docNo).not.toBe(original.docNo);
      expect(String(mirror.docNo).split("-")[0], "drawn from the document's own sequence").toBe(original.docNo.split("-")[0]);
      expect(mirror.reversesDocId).toBe(fixture.mirror.originalId);
      expect(mirror.date.slice(0, 10)).toBe(TODAY);
      const listed = (await world.request("GET", fixture.mirror.list)).body as unknown as { id: string; docNo: string | null; reversesDocId: string | null; reversedByDocId: string | null }[];
      const rows = Array.isArray(listed) ? listed : ((listed as unknown as { rows: typeof listed }).rows ?? []);
      expect(rows.find((row) => row.id === fixture.mirror!.originalId)).toMatchObject({ reversedByDocId: original.reversedByDocId });
      expect(rows.find((row) => row.id === original.reversedByDocId)).toMatchObject({ docNo: mirror.docNo, reversesDocId: fixture.mirror.originalId });
    }
    expect(await world.invariants()).toEqual(INVARIANTS_ZERO);
  });
});
