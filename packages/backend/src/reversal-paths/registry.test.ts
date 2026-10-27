import { ALL_PERMISSION_CODES, ALL_SCOPE, PermissionLabelLocale, getPermission, isSensitive, permissionHumanLabel } from "@mezan/domain";
import { DOCUMENT_REVERSAL_PATHS, ReversalDocumentType } from "@mezan/api";
import { ReversalPermission } from "@mezan/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seededWorld, type SeededWorld } from "../test-helpers/seeded-world.js";

let world: SeededWorld;

beforeAll(async () => {
  world = await seededWorld();
}, 900_000);

afterAll(() => world?.close());

const TWELVE = [
  ReversalDocumentType.FxRevaluation, ReversalDocumentType.PayrollRun, ReversalDocumentType.EmployeeAdvance, ReversalDocumentType.Cheque, ReversalDocumentType.YearEndClose, ReversalDocumentType.AssetDisposal, ReversalDocumentType.HrLeaveProvision,
  ReversalDocumentType.StockAdjustment, ReversalDocumentType.Adjustment, ReversalDocumentType.WritedownRun, ReversalDocumentType.LetterOfGuarantee, ReversalDocumentType.EquipmentLog, ReversalDocumentType.MaterialConsumption,
];
const ARABIC = /[؀-ۿ]/;

describe("the named reversal path of every entry type the journal refuses", () => {
  it.each(Object.entries(DOCUMENT_REVERSAL_PATHS))("%s is gated by a catalogued permission whose entity is labelled in Arabic and English", (_type, path) => {
    const permission = getPermission(path.permission);
    expect(permission, path.permission).toBeDefined();
    expect(permissionHumanLabel(path.permission, PermissionLabelLocale.Ar)).toMatch(ARABIC);
    const english = permissionHumanLabel(path.permission, PermissionLabelLocale.En);
    expect(english).not.toMatch(ARABIC);
  });

  it.each(Object.entries(DOCUMENT_REVERSAL_PATHS))("%s answers on its route: gated, not missing", async (_type, path) => {
    const url = path.route.replace(/:year/, "1999").replace(/:kind/, "leave").replace(/:asOfDate/, "1999-01-01").replace(/:\w+/g, "NO-SUCH-DOCUMENT");
    const token = await world.backend.sessions.issue({ userId: "nobody", permissions: [], roleCode: null, branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE });
    const res = await world.backend.app.fetch(new Request(`http://local${url}`, { method: path.method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { permission?: string }).permission).toBe(path.permission);
  });

  it("every registry type maps to exactly one reversal permission of its own kind that exists in the catalog, and the catalog holds no reversal permission without a route", () => {
    const declared = new Set<string>(Object.values(ReversalPermission));
    for (const [type, path] of Object.entries(DOCUMENT_REVERSAL_PATHS)) {
      expect(declared.has(path.permission), `${type} → ${path.permission}`).toBe(true);
      expect(path.permission.endsWith(".reverse"), `${type} → ${path.permission}`).toBe(true);
      expect(getPermission(path.permission), path.permission).toBeDefined();
      expect(isSensitive(path.permission), `${path.permission} is money-reversing`).toBe(true);
      expect(path.replaces, `${type} still rides on ${path.replaces}`).not.toBe(path.permission);
      expect(getPermission(path.replaces), path.replaces).toBeDefined();
    }
    const routed = new Set(Object.values(DOCUMENT_REVERSAL_PATHS).map((path) => path.permission));
    expect(ALL_PERMISSION_CODES.filter((code) => code.endsWith(".reverse")).sort()).toEqual([...routed].sort());
    expect([...declared].sort()).toEqual([...routed].sort());
  });

  const urlOf = (route: string) => route.replace(/:year/, "1999").replace(/:kind/, "leave").replace(/:asOfDate/, "1999-01-01").replace(/:\w+/g, "NO-SUCH-DOCUMENT");

  it.each(Object.entries(DOCUMENT_REVERSAL_PATHS).filter(([, path]) => path.takesReason))("%s refuses a reversal with no reason, in Arabic, before it looks anything up", async (_type, path) => {
    for (const body of [{}, { memo: "" }, { memo: "   " }, { memo: 7 }]) {
      const res = await world.request(path.method, urlOf(path.route), body);
      expect(`${res.status} ${String(res.body.error)}`, JSON.stringify(body)).toBe("422 REVERSAL_REASON_REQUIRED");
      expect(String(res.body.message)).toMatch(ARABIC);
      expect(String(res.body.messageEn)).not.toMatch(ARABIC);
    }
  });

  it.each(Object.entries(DOCUMENT_REVERSAL_PATHS).filter(([, path]) => !path.takesReason))("%s takes no reason and does not ask for one", async (_type, path) => {
    const res = await world.request(path.method, urlOf(path.route), {});
    expect(String(res.body.error)).not.toBe("REVERSAL_REASON_REQUIRED");
  });

  it("covers the twelve entry types that had no way to be reversed", () => {
    for (const type of TWELVE) expect(DOCUMENT_REVERSAL_PATHS[type], type).toBeDefined();
  });

  it("the journal's own reverse stays closed for every document-owned entry in the seeded books", async () => {
    const rows = world.sqlite
      .prepare(`SELECT source_doc_type AS type, MAX(id) AS id FROM journal_entry WHERE status = 'posted' AND reverses_entry_id IS NULL AND source_doc_type IS NOT NULL AND source_doc_type <> 'INITIAL_BALANCE' GROUP BY source_doc_type`)
      .all() as { type: string; id: string }[];
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const res = await world.request("POST", `/gl/journal-entries/${encodeURIComponent(row.id)}/reverse`, {});
      expect(`${row.type} ${res.status} ${String(res.body.error)}`).toBe(`${row.type} 422 JOURNAL_ENTRY_OWNED_BY_DOCUMENT`);
    }
  });
});
