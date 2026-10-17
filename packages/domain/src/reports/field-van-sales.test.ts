import { VanTripCashMovementKind, VanTripCrewRole, VanTripStatus } from "../field-sales/van-trip.js";
import { EmployeeRefStatus } from "../hr-shared/employee-ref.js";
import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import { runReport } from "./engine.js";
import { createVanSalesReport } from "./field-van-sales.js";
import type { VanTrip, VanTripSettlement } from "../field-sales/van-trip.js";
import type { Employee } from "../hr/employee.js";

function employee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: "emp-1",
    code: "EMP-0001",
    firstName: "Ahmed",
    lastName: "Hassan",
    firstNameAr: "أحمد",
    lastNameAr: "حسن",
    email: null,
    phone: null,
    birthDate: null,
    nationalId: null,
    gender: null,
    maritalStatus: null,
    departmentId: null,
    jobTitleId: null,
    managerId: null,
    branchId: "br-1",
    hireDate: "2020-01-01",
    workerCategory: "staff",
    employmentType: "full_time",
    overtimeEligibility: "not_eligible",
    standardWorkHours: null,
    probationEndDate: null,
    priorServiceYears: 0,
    requireSelfieAtClockIn: false,
    requireBiometricAtClockIn: false, deviceBadgeId: null, hasPensionEntitlement: null, taxDisabilityExemption: false,
    address: null,
    emergencyContact: null,
    salaryPaymentMethod: null,
    bankAccount: null,
    status: EmployeeRefStatus.Active,
    terminatedAt: null,
    createdAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function settlement(overrides: Partial<VanTripSettlement> = {}): VanTripSettlement {
  return {
    expectedCash: Money.fromMajor("0.00"),
    countedCash: Money.fromMajor("0.00"),
    cashVariance: Money.fromMajor("0.00"),
    stockCounts: [],
    settledAt: "2026-08-05T00:00:00.000Z",
    settledBy: null,
    settlementDate: null,
    cashBreakdown: null,
    invoicedSales: Money.zero(),
    returnsValue: Money.zero(),
    reconciliation: null,
    ...overrides,
  };
}

function vanTrip(overrides: Partial<VanTrip> = {}): VanTrip {
  return {
    id: "trip-1",
    tripNo: "VT-0001",
    date: "2026-08-05",
    branchId: "br-1",
    vanId: null,
    vanWarehouseId: "wh-van-1",
    vanTreasuryAccountId: "acc-van-1",
    sourceWarehouseId: "wh-main",
    sourceTreasuryAccountId: "acc-main",
    openingCashFloat: Money.fromMajor("0.00"),
    crew: [],
    loadedStock: [],
    cashMovements: [],
    status: VanTripStatus.Ongoing,
    openedAt: "2026-08-05T08:00:00.000Z",
    settledAt: null,
    settlement: null,
    notes: null,
    ...overrides,
  };
}

const baseParams = { dateFrom: "2026-08-01", dateTo: "2026-08-31", status: "all" as const };

describe("createVanSalesReport", () => {
  it("renders honestly over an empty context", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, baseParams, { trips: [], employees: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
    expect(outcome.grandTotals.salesCash).toBe(0);
    expect(outcome.grandTotals.cashVariance).toBe(0);
    const tripCount = outcome.kpis.find((k) => k.key === "tripCount");
    expect(tripCount?.value).toBe(0);
    const salesCashKpi = outcome.kpis.find((k) => k.key === "salesCash");
    expect(salesCashKpi?.value).toBe(0);
  });

  it("rejects a malformed date without throwing", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, { ...baseParams, dateFrom: "2026/08/01" }, { trips: [], employees: [] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.length).toBeGreaterThan(0);
  });

  it("rejects an invalid status enum value", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const outcome = runReport(definition, { ...baseParams, status: "in_transit" }, { trips: [], employees: [] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors.some((e) => e.field === "status")).toBe(true);
  });

  it("includes trips on both boundaries of the date range and excludes the day before/after", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const trips = [
      vanTrip({ id: "on-start", date: "2026-08-01" }),
      vanTrip({ id: "on-end", date: "2026-08-31" }),
      vanTrip({ id: "before", date: "2026-07-31" }),
      vanTrip({ id: "after", date: "2026-09-01" }),
    ];
    const outcome = runReport(definition, baseParams, { trips, employees: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.tripId).sort()).toEqual(["on-end", "on-start"]);
  });

  it("renders zero rows for a range with no matching trips", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const trips = [vanTrip({ id: "t1", date: "2026-08-15" })];
    const outcome = runReport(definition, { dateFrom: "2026-01-01", dateTo: "2026-01-31", status: "all" as const }, { trips, employees: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(0);
    expect(outcome.grandTotals.loadedQty).toBe(0);
  });

  it("filters by status, excluding every trip when none match", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const trips = [
      vanTrip({ id: "t-ongoing", date: "2026-08-05", status: VanTripStatus.Ongoing }),
      vanTrip({ id: "t-settled", date: "2026-08-06", status: VanTripStatus.Settled, settlement: settlement() }),
    ];
    const settledOnly = runReport(definition, { ...baseParams, status: VanTripStatus.Settled as const }, { trips, employees: [] });
    expect(settledOnly.ok).toBe(true);
    if (settledOnly.ok) {
      expect(settledOnly.rows.map((r) => r.tripId)).toEqual(["t-settled"]);
    }

    const noneCancelled = runReport(definition, { ...baseParams, status: VanTripStatus.Cancelled as const }, { trips, employees: [] });
    expect(noneCancelled.ok).toBe(true);
    if (!noneCancelled.ok) return;
    expect(noneCancelled.rows).toHaveLength(0);
  });

  it("sorts rows by date then trip label", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const trips = [
      vanTrip({ id: "c", tripNo: "VT-0003", date: "2026-08-10" }),
      vanTrip({ id: "a", tripNo: "VT-0001", date: "2026-08-05" }),
      vanTrip({ id: "b", tripNo: "VT-0002", date: "2026-08-05" }),
    ];
    const outcome = runReport(definition, baseParams, { trips, employees: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows.map((r) => r.tripId)).toEqual(["a", "b", "c"]);
  });

  it("leaves counted/variance fields null on an ongoing trip, and falls back to opening+sales+collections for expectedCash", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const trip = vanTrip({
      id: "ongoing-1",
      status: VanTripStatus.Ongoing,
      settlement: null,
      openingCashFloat: Money.fromMajor("100.00"),
      loadedStock: [{ itemId: "item-a", qty: Qty.fromMajor("40") }],
      cashMovements: [
        { id: "m1", kind: VanTripCashMovementKind.Sale, amount: Money.fromMajor("40.00"), occurredAt: "2026-08-05T10:00:00.000Z", notes: null },
        { id: "m2", kind: VanTripCashMovementKind.Sale, amount: Money.fromMajor("35.00"), occurredAt: "2026-08-05T11:00:00.000Z", notes: null },
        { id: "m3", kind: VanTripCashMovementKind.Collection, amount: Money.fromMajor("25.00"), occurredAt: "2026-08-05T12:00:00.000Z", notes: null },
      ],
    });
    const outcome = runReport(definition, baseParams, { trips: [trip], employees: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const row = outcome.rows[0];
    expect(row?.returnedQty).toBeNull();
    expect(row?.dispatchedQty).toBeNull();
    expect(row?.countedCash).toBeNull();
    expect(row?.cashVariance).toBeNull();
    expect(row?.loadedQty).toBe(40);
    expect(row?.salesCash).toBe(75);
    expect(row?.collectionsCash).toBe(25);
    // fallback: openingCashFloat(100) + salesCash(75) + collectionsCash(25) = 200
    expect(row?.expectedCash).toBe(200);
  });

  it("computes dispatchedQty as loaded minus returned on a settled trip", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const trip = vanTrip({
      id: "settled-1",
      status: VanTripStatus.Settled,
      loadedStock: [
        { itemId: "item-a", qty: Qty.fromMajor("60") },
        { itemId: "item-b", qty: Qty.fromMajor("40") },
      ],
      settlement: settlement({
        stockCounts: [
          {
            itemId: "item-a",
            expectedQty: Qty.fromMajor("60"),
            countedQty: Qty.fromMajor("30"),
            varianceQty: Qty.fromMajor("-30"),
            loadedQty: Qty.fromMajor("60"),
            soldQty: Qty.zero(),
            returnedQty: Qty.zero(),
            otherQty: Qty.zero(),
            unitCost: Money.zero(),
            varianceValue: Money.zero(),
          },
        ],
      }),
    });
    const outcome = runReport(definition, baseParams, { trips: [trip], employees: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const row = outcome.rows[0];
    expect(row?.loadedQty).toBe(100);
    expect(row?.returnedQty).toBe(30);
    expect(row?.dispatchedQty).toBe(70);
  });

  it("uses the settlement's own expectedCash as-is, even when it disagrees with the fallback formula", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const trip = vanTrip({
      id: "settled-2",
      status: VanTripStatus.Settled,
      openingCashFloat: Money.fromMajor("50.00"),
      cashMovements: [],
      settlement: settlement({
        expectedCash: Money.fromMajor("999.99"),
        countedCash: Money.fromMajor("990.00"),
        cashVariance: Money.fromMajor("-9.99"),
      }),
    });
    const outcome = runReport(definition, baseParams, { trips: [trip], employees: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const row = outcome.rows[0];
    // fallback would be 50 + 0 + 0 = 50, but the settlement's own figure must win
    expect(row?.expectedCash).toBe(999.99);
    expect(row?.countedCash).toBe(990);
    expect(row?.cashVariance).toBe(-9.99);
  });

  it("resolves crew names from employees and falls back to the raw id when unknown", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const employees = [employee({ id: "emp-known", firstNameAr: "سارة", lastNameAr: "محمود" })];
    const trip = vanTrip({
      id: "trip-crew",
      crew: [
        { employeeId: "emp-known", role: VanTripCrewRole.Driver },
        { employeeId: "emp-unknown", role: VanTripCrewRole.Rep },
      ],
    });
    const outcome = runReport(definition, baseParams, { trips: [trip], employees });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.crewAr).toBe("سارة محمود، emp-unknown");
  });

  it("keeps the cashVariance KPI and grand total in agreement, and the tone follows the sign", () => {
    const definition = createVanSalesReport("2026-08-01", "2026-08-31");
    const trips = [
      vanTrip({ id: "t1", date: "2026-08-05", status: VanTripStatus.Settled, settlement: settlement({ cashVariance: Money.fromMajor("-9.99") }) }),
      vanTrip({ id: "t2", date: "2026-08-06", status: VanTripStatus.Settled, settlement: settlement({ cashVariance: Money.fromMajor("2.00") }) }),
    ];
    const outcome = runReport(definition, baseParams, { trips, employees: [] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const variance = outcome.kpis.find((k) => k.key === "cashVariance");
    expect(variance?.value).toBe(-7.99);
    expect(outcome.grandTotals.cashVariance).toBe(-7.99);
    expect(variance?.tone).toBe("danger");

    const balanced = runReport(
      definition,
      baseParams,
      { trips: [vanTrip({ id: "t3", date: "2026-08-07", status: VanTripStatus.Settled, settlement: settlement({ cashVariance: Money.fromMajor("0.00") }) })], employees: [] },
    );
    expect(balanced.ok).toBe(true);
    if (!balanced.ok) return;
    const zeroVariance = balanced.kpis.find((k) => k.key === "cashVariance");
    expect(zeroVariance?.tone).toBe("success");
  });
});
