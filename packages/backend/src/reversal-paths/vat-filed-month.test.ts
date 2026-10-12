import { DEFAULT_TIME_ZONE, toTenantDay } from "@mezan/domain";
import { DOCUMENT_REVERSAL_PATHS, ReversalDocumentType, reversalRoute } from "@mezan/api";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";

let world: SeededWorld;
const today = toTenantDay(new Date().toISOString(), DEFAULT_TIME_ZONE);
const monthStart = `${today.slice(0, 7)}-01`;
const monthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);

const ok = async (method: string, url: string, body: unknown, ...statuses: number[]) => {
  const res = await world.request(method, url, body);
  expect(statuses.length > 0 ? statuses : [200, 201], `${method} ${url} ${JSON.stringify(res.body)}`).toContain(res.status);
  return res.body;
};
const one = <T,>(sql: string, ...params: unknown[]) => world.sqlite.prepare(sql).get(...params) as T;

const STANDING: Record<ReversalDocumentType, () => Promise<Record<string, string>>> = {
  [ReversalDocumentType.FxRevaluation]: async () => ({ entryId: String((await ok("POST", "/revaluation/post", { date: "2026-08-31", currencies: ["USD"], autoReverse: false })).entryId) }),
  [ReversalDocumentType.PayrollRun]: async () => ({ id: "PR-DEMO-2" }),
  [ReversalDocumentType.EmployeeAdvance]: async () => {
    world.sqlite.prepare(`UPDATE hr_employee_advance SET status = 'approved' WHERE id = 'ADV-DEMO-4'`).run();
    await ok("POST", "/hr/advances/ADV-DEMO-4/disburse", { treasuryAccountId: "TR-DEMO-BANK", branchId: "BR-MAIN", date: "2026-08-12", paymentMethod: "bank" });
    return { id: "ADV-DEMO-4" };
  },
  [ReversalDocumentType.Cheque]: async () => ({ id: "CHQ-DEMO-2" }),
  [ReversalDocumentType.YearEndClose]: async () => {
    world.sqlite.prepare(`UPDATE fiscal_period SET status = 'open' WHERE id = 'fp-2025-12'`).run();
    await ok("POST", "/gl/year-end-close", { year: 2025, retainedEarningsAccountId: "3900" });
    return { year: "2025" };
  },
  [ReversalDocumentType.AssetDisposal]: async () => {
    await ok("POST", "/assets/ASSET-DEMO-5/dispose", { date: "2026-08-20", proceeds: "9000.00", proceedsAccountId: "1310" });
    return { id: "ASSET-DEMO-5" };
  },
  [ReversalDocumentType.HrLeaveProvision]: async () => {
    await ok("POST", "/hr/payroll/provisions/leave", { asOfDate: "2026-08-31" });
    return { kind: "leave", asOfDate: "2026-08-31" };
  },
  [ReversalDocumentType.StockAdjustment]: async () => {
    await ok("POST", "/inventory/stock-adjustments/draft", { id: "VATR-ADJ", date: "2026-08-18", lines: [{ itemId: "ITEM-DEMO-1", warehouseId: "WH-MAIN", reason: "OTHER", direction: "IN", qty: "2", unitCost: "1.00" }] });
    await ok("POST", "/inventory/stock-adjustments/VATR-ADJ/confirm", {});
    return { id: "VATR-ADJ" };
  },
  [ReversalDocumentType.Adjustment]: async () => {
    await ok("POST", "/inventory/adjustments", { adjustmentId: "VATR-DIRECT", warehouseId: "WH-MAIN", reason: "DAMAGE", occurredAt: "2026-08-18", lines: [{ itemId: "ITEM-DEMO-1", direction: "OUT", qty: "2" }] });
    return { id: "VATR-DIRECT" };
  },
  [ReversalDocumentType.WritedownRun]: async () => ({ id: one<{ id: string }>(`SELECT id FROM writedown_run WHERE period = '2026-08' AND status = 'posted' ORDER BY created_at LIMIT 1`).id }),
  [ReversalDocumentType.LetterOfGuarantee]: async () => {
    await ok("POST", "/contracting/guarantees", { id: "VATR-LG", kind: "bid", tenderRef: "مناقصة", beneficiaryNameAr: "جهة الإسناد", bankTreasuryAccountId: "TR-DEMO-BANK", faceValue: "100000.00", cashMarginAmount: "10000.00", issueDate: "2026-08-03", expiryDate: "2027-08-03" });
    await ok("POST", "/contracting/guarantees/VATR-LG/issue", {});
    return { id: "VATR-LG" };
  },
  [ReversalDocumentType.EquipmentLog]: async () => ({ id: one<{ id: string }>(`SELECT id FROM equipment_log WHERE status = 'confirmed' AND date >= '2026-08-01' ORDER BY id LIMIT 1`).id }),
  [ReversalDocumentType.MaterialConsumption]: async () => ({ id: "CON-DEMO-SUB-1" }),
  [ReversalDocumentType.LandedCost]: async () => ({ id: "LC-DEMO-1" }),
  [ReversalDocumentType.DepreciationRun]: async () => ({ id: one<{ id: string }>(`SELECT id FROM depreciation_run WHERE status = 'posted' ORDER BY period DESC LIMIT 1`).id }),
  [ReversalDocumentType.RecurringJournalTemplate]: async () => ({ id: one<{ id: string }>(`SELECT r.id FROM recurring_journal_run r JOIN journal_entry e ON e.id = r.journal_entry_id WHERE e.status = 'posted' AND r.reversal_journal_entry_id IS NULL ORDER BY r.period DESC LIMIT 1`).id }),
};

const params = new Map<ReversalDocumentType, Record<string, string>>();

beforeAll(async () => {
  world = await seededWorld();
  for (const type of Object.values(ReversalDocumentType)) params.set(type, await STANDING[type]());
  await ok("POST", "/gl/vat-filings", { id: "VATR-FILING", periodFrom: monthStart, periodTo: monthEnd, netAmount: "0.00" });
  await ok("POST", "/gl/vat-filings", { id: "VATR-FILING-YE", periodFrom: "2025-12-01", periodTo: "2025-12-31", netAmount: "0.00" });
}, 900_000);

afterAll(() => world?.close());

describe("a reversal dated into a month whose VAT return is filed is refused on every named route", () => {
  it.each(Object.values(ReversalDocumentType))("%s", async (type) => {
    const entries = world.count("journal_entry");
    const movements = world.count("stock_movement");
    const res = await world.request(DOCUMENT_REVERSAL_PATHS[type].method, reversalRoute(type, params.get(type) ?? {}), { date: today, memo: "اختبار" });
    expect(`${res.status} ${String(res.body.error)}`, JSON.stringify(res.body)).toBe("422 VAT_PERIOD_ALREADY_FILED");
    expect(String(res.body.message)).toMatch(/[؀-ۿ]/);
    expect(typeof res.body.messageEn).toBe("string");
    expect(world.count("journal_entry")).toBe(entries);
    expect(world.count("stock_movement")).toBe(movements);
  });
});
