import { describe, expect, it } from "vitest";
import {
  SequenceGapExplanation,
  SequenceNumberAnomaly,
  SequenceSourceCoverage,
  buildSequenceGapReport,
  type NumberedDocumentRecord,
  type SequenceCounterState,
} from "./sequence-gap-report.js";
import { csvCell, evidenceSigningIdentity, signEvidenceManifest, verifyEvidenceManifest } from "./evidence-manifest.js";
import { AccessExpiryProblem, accessExpiryProblem, isAccessExpired } from "../users/access-expiry.js";

const INVOICES: SequenceCounterState = {
  code: "SALES_INVOICE",
  labelAr: "فاتورة مبيعات",
  period: null,
  scope: null,
  branchCode: null,
  issued: 10,
  format: { prefixes: ["INV-"], suffix: "", padLength: 6 },
  coverage: SequenceSourceCoverage.Documents,
};

function doc(n: number, date: string, voided = false): NumberedDocumentRecord {
  return { number: `INV-${String(n).padStart(6, "0")}`, date, status: voided ? "void" : "confirmed", voided, source: "sales_invoice" };
}

describe("sequence gap report", () => {
  const window = { from: "2026-03-01", to: "2026-03-31" };

  it("names every issued number with no document, including the tail after the last document, and counts voids as accounted for", () => {
    const documents = [doc(1, "2026-02-10"), doc(2, "2026-03-02"), doc(4, "2026-03-05", true), doc(5, "2026-03-09"), doc(7, "2026-04-02")];
    const report = buildSequenceGapReport({ window, counters: [INVOICES], documentsByCode: new Map([["SALES_INVOICE", documents]]), adjustments: [], deletions: [] });
    const series = report.series[0]!;
    expect(series.gaps.map((g) => [g.first, g.last, g.explanation, g.inWindow])).toEqual([
      [3, 3, SequenceGapExplanation.Unexplained, true],
      [6, 6, SequenceGapExplanation.Unexplained, true],
      [8, 10, SequenceGapExplanation.Unexplained, false],
    ]);
    expect(series.voided.map((v) => v.number)).toEqual(["INV-000004"]);
    expect(series.missingCount).toBe(5);
    expect(report.totals.unexplained).toBe(5);
  });

  it("explains a gap the administrator made by advancing the counter, and a deleted numbered draft", () => {
    const documents = [doc(1, "2026-03-01"), doc(9, "2026-03-20")];
    const report = buildSequenceGapReport({
      window,
      counters: [{ ...INVOICES, issued: 9 }],
      documentsByCode: new Map([["SALES_INVOICE", documents]]),
      adjustments: [{ code: "SALES_INVOICE", from: 2, to: 7, at: "2026-03-10T09:00:00Z", actor: "admin" }],
      deletions: [{ code: "SALES_INVOICE", number: "INV-000008", at: "2026-03-11T09:00:00Z", actor: "u1" }],
    });
    expect(report.series[0]!.gaps.map((g) => [g.first, g.last, g.explanation])).toEqual([
      [2, 2, SequenceGapExplanation.Unexplained],
      [3, 7, SequenceGapExplanation.CounterAdjusted],
      [8, 8, SequenceGapExplanation.DraftDeleted],
    ]);
  });

  it("reports a number above the counter and a number held twice as anomalies", () => {
    const documents = [doc(1, "2026-03-01"), doc(1, "2026-03-02"), doc(12, "2026-03-03")];
    const report = buildSequenceGapReport({ window, counters: [{ ...INVOICES, issued: 1 }], documentsByCode: new Map([["SALES_INVOICE", documents]]), adjustments: [], deletions: [] });
    expect(report.series[0]!.anomalies.map((a) => [a.kind, a.number])).toEqual([
      [SequenceNumberAnomaly.Duplicate, "INV-000001"],
      [SequenceNumberAnomaly.BeyondCounter, "INV-000012"],
    ]);
  });

  it("keeps branch-scoped counters apart by the branch code inside the number", () => {
    const branched = { ...INVOICES, scope: "BR-1", branchCode: "CAI", issued: 2 };
    const documents: NumberedDocumentRecord[] = [
      { number: "INV-CAI-000001", date: "2026-03-01", status: "confirmed", voided: false, source: "sales_invoice" },
      { number: "INV-ALX-000002", date: "2026-03-01", status: "confirmed", voided: false, source: "sales_invoice" },
    ];
    const report = buildSequenceGapReport({ window, counters: [branched], documentsByCode: new Map([["SALES_INVOICE", documents]]), adjustments: [], deletions: [] });
    expect(report.series[0]!.documentsFound).toBe(1);
    expect(report.series[0]!.gaps.map((g) => g.firstNumber)).toEqual(["INV-CAI-000002"]);
  });

  it("lists a counter with no document table without inventing gaps for it", () => {
    const report = buildSequenceGapReport({
      window,
      counters: [{ ...INVOICES, code: "BOM", coverage: SequenceSourceCoverage.CounterOnly }],
      documentsByCode: new Map(),
      adjustments: [],
      deletions: [],
    });
    expect(report.series[0]!.gaps).toEqual([]);
    expect(report.series[0]!.coverage).toBe(SequenceSourceCoverage.CounterOnly);
  });
});

describe("evidence manifest signing", () => {
  const seed = "11".repeat(32);

  it("verifies the exact manifest bytes under the install's public key and nothing else", async () => {
    const { publicKeyHex, keyId } = await evidenceSigningIdentity(seed);
    expect(keyId).toMatch(/^[0-9a-f]{16}$/);
    const bytes = new TextEncoder().encode('{"files":[]}\n');
    const signature = await signEvidenceManifest(bytes, seed);
    expect(await verifyEvidenceManifest(bytes, signature, publicKeyHex)).toBe(true);
    expect(await verifyEvidenceManifest(new TextEncoder().encode('{"files":[1]}\n'), signature, publicKeyHex)).toBe(false);
    const other = await evidenceSigningIdentity("22".repeat(32));
    expect(await verifyEvidenceManifest(bytes, signature, other.publicKeyHex)).toBe(false);
  });

  it("escapes CSV cells and defuses spreadsheet formulas without touching negative amounts", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-125.50")).toBe("-125.50");
    expect(csvCell(null)).toBe("");
  });
});

describe("access expiry", () => {
  const now = Date.parse("2026-03-10T00:00:00Z");

  it("is expired from the stored instant on, and an unparseable stored value counts as expired", () => {
    expect(isAccessExpired({ accessExpiresAt: "2026-03-10T00:00:00Z" }, now)).toBe(true);
    expect(isAccessExpired({ accessExpiresAt: "2026-03-11T00:00:00Z" }, now)).toBe(false);
    expect(isAccessExpired({ accessExpiresAt: null }, now)).toBe(false);
    expect(isAccessExpired({ accessExpiresAt: "garbage" }, now)).toBe(true);
  });

  it("requires an end date on the time-boxed auditor role, bounds it, and refuses one on a company admin", () => {
    expect(accessExpiryProblem({ accessExpiresAt: null, isCompanyAdmin: false, roleCode: "EXTERNAL_AUDITOR" }, now)?.problem).toBe(AccessExpiryProblem.RequiredForRole);
    expect(accessExpiryProblem({ accessExpiresAt: "2027-03-10T00:00:00Z", isCompanyAdmin: false, roleCode: "EXTERNAL_AUDITOR_2" }, now)?.problem).toBe(AccessExpiryProblem.TooLong);
    expect(accessExpiryProblem({ accessExpiresAt: "2026-04-10T00:00:00Z", isCompanyAdmin: false, roleCode: "EXTERNAL_AUDITOR" }, now)).toBeNull();
    expect(accessExpiryProblem({ accessExpiresAt: "2026-04-10T00:00:00Z", isCompanyAdmin: true, roleCode: null }, now)?.problem).toBe(AccessExpiryProblem.OnCompanyAdmin);
    expect(accessExpiryProblem({ accessExpiresAt: null, isCompanyAdmin: false, roleCode: "CASHIER" }, now)).toBeNull();
  });
});
