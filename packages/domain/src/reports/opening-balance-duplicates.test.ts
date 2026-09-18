import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { runReport } from "./engine.js";
import {
  createOpeningBalanceDuplicatesReport,
  findOpeningBalanceDuplicates,
  type OpeningBalanceEntryRef,
  type OpeningBalancePartyRef,
} from "./opening-balance-duplicates.js";

function entry(overrides: Partial<OpeningBalanceEntryRef> = {}): OpeningBalanceEntryRef {
  return {
    id: "OB-CUST-JE:p1",
    entryNo: "JE-000001",
    date: "2026-01-01",
    status: "posted",
    sourceDocType: "CUSTOMER_OPENING_BALANCE",
    sourceDocId: "p1",
    controlMovement: Money.fromMajor("750.00"),
    ...overrides,
  };
}

function party(overrides: Partial<OpeningBalancePartyRef> = {}): OpeningBalancePartyRef {
  return { id: "p1", code: "C001", nameAr: "عميل", openingBalance: Money.fromMajor("750.00"), ...overrides };
}

describe("findOpeningBalanceDuplicates", () => {
  it("reports nothing for a party with a single, correctly-posted entry", () => {
    const rows = findOpeningBalanceDuplicates("customer", [party()], [entry()]);
    expect(rows).toEqual([]);
  });

  it("reports nothing for a party with no posted entry at all — that is the ordinary not-yet-posted case, not a duplicate", () => {
    const rows = findOpeningBalanceDuplicates("customer", [party()], []);
    expect(rows).toEqual([]);
  });

  it("flags exactly D241's shape: the screen's entry and a second one under a different id, doubling the total", () => {
    const entries = [
      entry({ id: "CUST-OPEN-JE:p1:uuid", entryNo: "JE-1" }),
      entry({ id: "OB-CUST-JE:p1", entryNo: "JE-2" }),
    ];
    const rows = findOpeningBalanceDuplicates("customer", [party()], entries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "customer",
      partyId: "p1",
      wanted: 750,
      totalPosted: 1500,
      excess: 750,
      entryCount: 2,
    });
    expect([...rows[0]!.entryIds].sort()).toEqual(["CUST-OPEN-JE:p1:uuid", "OB-CUST-JE:p1"]);
  });

  it("does NOT flag a legitimate D142/D241 correction — reverse-and-repost nets to zero excess even with three entries", () => {
    const entries = [
      entry({ id: "OB-CUST-JE:p1", entryNo: "JE-1", status: "reversed", controlMovement: Money.fromMajor("5000.00") }),
      entry({ id: "OB-CUST-JE:p1:REV", entryNo: "JE-2", controlMovement: Money.fromMajor("-5000.00") }),
      entry({ id: "OB-CUST-JE:p1:v1", entryNo: "JE-3", controlMovement: Money.fromMajor("7500.00") }),
    ];
    const rows = findOpeningBalanceDuplicates("customer", [party({ openingBalance: Money.fromMajor("7500.00") })], entries);
    expect(rows).toEqual([]);
  });

  it("ignores a draft entry — it never reached the control account", () => {
    const entries = [entry({ id: "OB-CUST-JE:p1", status: "draft" }), entry({ id: "CUST-OPEN-JE:p1:uuid" })];
    const rows = findOpeningBalanceDuplicates("customer", [party()], entries);
    expect(rows).toEqual([]);
  });

  it("checks suppliers too — the same shape, credited to 2100 and negated against the record", () => {
    const supplierEntry = (overrides: Partial<OpeningBalanceEntryRef> = {}) =>
      entry({ sourceDocType: "SUPPLIER_OPENING_BALANCE", sourceDocId: "s1", controlMovement: Money.fromMajor("-300.00"), ...overrides });
    const entries = [supplierEntry({ id: "SUP-OPEN-JE:s1:uuid" }), supplierEntry({ id: "OB-SUPP-JE:s1" })];
    const rows = findOpeningBalanceDuplicates("supplier", [party({ id: "s1", code: "S001", nameAr: "مورد", openingBalance: Money.fromMajor("300.00") })], entries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "supplier", partyId: "s1", wanted: -300, totalPosted: -600, excess: -300 });
  });

  it("does not cross-contaminate customer and supplier entries sharing a party id", () => {
    const customerEntries = [entry({ id: "OB-CUST-JE:p1", sourceDocType: "CUSTOMER_OPENING_BALANCE" })];
    const supplierRow = findOpeningBalanceDuplicates("supplier", [party({ id: "p1" })], customerEntries);
    expect(supplierRow).toEqual([]);
  });
});

describe("createOpeningBalanceDuplicatesReport", () => {
  it("runs both kinds together and totals the excess in its KPI strip", () => {
    const definition = createOpeningBalanceDuplicatesReport();
    const outcome = runReport(
      definition,
      {},
      {
        customers: [party()],
        suppliers: [party({ id: "s1", code: "S001", nameAr: "مورد", openingBalance: Money.fromMajor("300.00") })],
        entries: [
          entry({ id: "CUST-OPEN-JE:p1:uuid" }),
          entry({ id: "OB-CUST-JE:p1" }),
          entry({ id: "SUP-OPEN-JE:s1:uuid", sourceDocType: "SUPPLIER_OPENING_BALANCE", sourceDocId: "s1", controlMovement: Money.fromMajor("-300.00") }),
          entry({ id: "OB-SUPP-JE:s1", sourceDocType: "SUPPLIER_OPENING_BALANCE", sourceDocId: "s1", controlMovement: Money.fromMajor("-300.00") }),
        ],
      },
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(2);
    // customer excess is +750 (over-debited); supplier excess is -300 (its
    // `wanted` is negated onto the control account's own sign, D241) — the
    // KPI is their raw sum, not the sum of magnitudes.
    const excessKpi = outcome.kpis.find((k) => k.key === "excess");
    expect(excessKpi?.value).toBe(450);
  });
});
