import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money } from "../money/index.js";
import { fullNameAr, type Employee } from "../hr/employee.js";
import { VanTripCashMovementKind, VanTripCrewRole, VanTripStatus, type VanTrip } from "../field-sales/van-trip.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { withinDateRange } from "./period-bucket.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";
import { ReportParamKind } from "./types.js";

/**
 * أداء المندوب اليومي — one row per rep per trip day: what the van invoiced,
 * what came back as returns, what the rep collected, and what the settlement
 * found short or over. Every figure is read from the settlement the trip
 * stored (E3-04), never re-derived from today's books.
 */

export interface RepDailyContext {
  readonly trips: readonly VanTrip[];
  readonly employees: readonly Employee[];
}

export interface RepDailyParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly branchId: string;
}

export interface RepDailyRow {
  readonly key: string;
  readonly date: string;
  readonly employeeId: string;
  readonly repAr: string;
  readonly tripCount: number;
  readonly awaitingApproval: number;
  readonly invoicedSales: number;
  readonly returnsValue: number;
  readonly netSales: number;
  readonly fieldCashSales: number;
  readonly collections: number;
  readonly cashVariance: number;
  readonly shortageValue: number;
  readonly overageValue: number;
}

const paramsSchema = z.object({
  dateFrom: isoDateParamSchema,
  dateTo: isoDateParamSchema,
  branchId: branchIdParamSchema,
});

interface Bucket {
  date: string;
  employeeId: string;
  trips: number;
  awaiting: number;
  invoicedSales: Money;
  returnsValue: Money;
  fieldCashSales: Money;
  collections: Money;
  cashVariance: Money;
  shortageValue: Money;
  overageValue: Money;
}

function repsOf(trip: VanTrip): readonly string[] {
  const reps = trip.crew.filter((m) => m.role === VanTripCrewRole.Rep).map((m) => m.employeeId);
  if (reps.length > 0) return reps;
  const first = trip.crew[0];
  return first ? [first.employeeId] : [];
}

const asNumber = (m: Money): number => Number(m.toString());

export function createRepDailyReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<RepDailyParams, RepDailyRow, RepDailyContext> {
  return {
    id: "field.rep-daily",
    titleAr: "أداء المندوبين اليومي",
    descriptionAr:
      "لكل مندوب في كل يوم رحلة مسوّاة: مبيعات فواتير مستودع المركبة ومرتجعاتها، والتحصيلات، وفرق النقدية، وقيمة العجز والزيادة في البضاعة بمتوسط التكلفة عند التسوية. رحلة بطاقمين من المندوبين تظهر لكل منهما.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, branchId: "" },
    paramFields: [{ kind: ReportParamKind.DateRange, fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" }, BRANCH_PARAM_FIELD],
    rowKey: (row) => row.key,
    columns: [
      { key: "date", header: "التاريخ", format: "date", value: (row) => row.date },
      { key: "repAr", header: "المندوب", format: "text", value: (row) => row.repAr },
      { key: "tripCount", header: "الرحلات", format: "qty", align: "end", total: true, value: (row) => row.tripCount },
      { key: "awaitingApproval", header: "بانتظار الاعتماد", format: "qty", align: "end", total: true, value: (row) => row.awaitingApproval },
      { key: "invoicedSales", header: "مبيعات الفواتير", format: "money", align: "end", total: true, value: (row) => row.invoicedSales },
      { key: "returnsValue", header: "المرتجعات", format: "money", align: "end", total: true, value: (row) => row.returnsValue },
      { key: "netSales", header: "صافي المبيعات", format: "money", align: "end", total: true, value: (row) => row.netSales },
      { key: "fieldCashSales", header: "مبيعات نقدية ميدانية", format: "money", align: "end", total: true, value: (row) => row.fieldCashSales },
      { key: "collections", header: "التحصيلات", format: "money", align: "end", total: true, value: (row) => row.collections },
      { key: "cashVariance", header: "فرق النقدية", format: "money", align: "end", total: true, value: (row) => row.cashVariance },
      { key: "shortageValue", header: "قيمة العجز", format: "money", align: "end", total: true, value: (row) => row.shortageValue },
      { key: "overageValue", header: "قيمة الزيادة", format: "money", align: "end", total: true, value: (row) => row.overageValue },
    ],
    kpis: [
      { key: "netSales", labelAr: "صافي المبيعات", format: "money", value: (rows) => sumRows(rows, (r) => r.netSales) },
      { key: "collections", labelAr: "التحصيلات", format: "money", value: (rows) => sumRows(rows, (r) => r.collections) },
      {
        key: "shortageValue",
        labelAr: "قيمة العجز",
        hintAr: "عجز البضاعة بمتوسط التكلفة عند التسوية",
        format: "money",
        value: (rows) => sumRows(rows, (r) => r.shortageValue),
        tone: (value) => (value === 0 ? "success" : "danger"),
      },
      {
        key: "cashVariance",
        labelAr: "فرق النقدية",
        format: "money",
        value: (rows) => sumRows(rows, (r) => r.cashVariance),
        tone: (value) => (value === 0 ? "success" : "danger"),
      },
    ],
    chart: {
      labelColumn: "repAr",
      valueColumn: "netSales",
      aggregate: true,
      maxPoints: 8,
      captionAr: "صافي مبيعات كل مندوب في الفترة.",
    },
    run: (params, ctx) => {
      const names = new Map(ctx.employees.map((e) => [e.id, fullNameAr(e)]));
      const buckets = new Map<string, Bucket>();

      for (const trip of ctx.trips) {
        const settlement = trip.settlement;
        if (!settlement) continue;
        if (trip.status !== VanTripStatus.AwaitingApproval && trip.status !== VanTripStatus.Settled) continue;
        if (!withinDateRange(trip.date, params.dateFrom, params.dateTo)) continue;
        if (!matchesBranch(trip.branchId, params.branchId)) continue;

        const movements = (kind: VanTripCashMovementKind) =>
          Money.sum(trip.cashMovements.filter((m) => m.kind === kind).map((m) => m.amount));
        const voucherCollections = settlement.cashBreakdown?.voucherCollections ?? Money.zero();
        const shortage = Money.sum(settlement.stockCounts.filter((l) => l.varianceValue.scaled < 0n).map((l) => l.varianceValue.negate()));
        const overage = Money.sum(settlement.stockCounts.filter((l) => l.varianceValue.scaled > 0n).map((l) => l.varianceValue));

        for (const employeeId of repsOf(trip)) {
          const key = `${trip.date}|${employeeId}`;
          const b: Bucket = buckets.get(key) ?? {
            date: trip.date,
            employeeId,
            trips: 0,
            awaiting: 0,
            invoicedSales: Money.zero(),
            returnsValue: Money.zero(),
            fieldCashSales: Money.zero(),
            collections: Money.zero(),
            cashVariance: Money.zero(),
            shortageValue: Money.zero(),
            overageValue: Money.zero(),
          };
          b.trips += 1;
          if (trip.status === VanTripStatus.AwaitingApproval) b.awaiting += 1;
          b.invoicedSales = b.invoicedSales.add(settlement.invoicedSales);
          b.returnsValue = b.returnsValue.add(settlement.returnsValue);
          b.fieldCashSales = b.fieldCashSales.add(movements(VanTripCashMovementKind.Sale));
          b.collections = b.collections.add(movements(VanTripCashMovementKind.Collection)).add(voucherCollections);
          b.cashVariance = b.cashVariance.add(settlement.cashVariance);
          b.shortageValue = b.shortageValue.add(shortage);
          b.overageValue = b.overageValue.add(overage);
          buckets.set(key, b);
        }
      }

      const rows: RepDailyRow[] = [...buckets.entries()].map(([key, b]) => ({
        key,
        date: b.date,
        employeeId: b.employeeId,
        repAr: names.get(b.employeeId) ?? b.employeeId,
        tripCount: b.trips,
        awaitingApproval: b.awaiting,
        invoicedSales: asNumber(b.invoicedSales),
        returnsValue: asNumber(b.returnsValue),
        netSales: asNumber(b.invoicedSales.add(b.returnsValue.negate())),
        fieldCashSales: asNumber(b.fieldCashSales),
        collections: asNumber(b.collections),
        cashVariance: asNumber(b.cashVariance),
        shortageValue: asNumber(b.shortageValue),
        overageValue: asNumber(b.overageValue),
      }));
      return rows.sort((a, b) => (a.date === b.date ? a.repAr.localeCompare(b.repAr) : a.date.localeCompare(b.date)));
    },
  };
}
