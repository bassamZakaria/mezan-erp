import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money, Qty } from "../money/index.js";
import { fullNameAr, type Employee } from "../hr/employee.js";
import { getVanTripStatusLabel, type VanTrip, type VanTripStatus } from "../field-sales/van-trip.js";
import type { ReportDefinition } from "./types.js";
import { sumRows } from "./kpi.js";
import { withinDateRange } from "./period-bucket.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";
import { ReportParamKind } from "./types.js";

/**
 * مبيعات المندوبين — Van Sales (docs/archive/catalog/07-mfg-projects-assets.md
 * §"رحلات المندوبين"). One row per `VanTrip` in the period: what the van
 * carried out, what came back at settlement, what cash the crew recorded in
 * the field, and the settlement cash variance.
 *
 * Every column is derived from what a trip actually records — loaded stock,
 * `cashMovements` (sale/collection), and the settlement counts. A trip that
 * has not been settled yet has no counted stock or cash, so those cells are
 * blank rather than zero.
 */

export interface VanSalesContext {
  readonly trips: readonly VanTrip[];
  readonly employees: readonly Employee[];
}

export interface VanSalesParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly status: "all" | VanTripStatus;
  readonly branchId: string;
}

export interface VanSalesRow {
  readonly tripId: string;
  readonly tripLabel: string;
  readonly date: string;
  readonly status: VanTripStatus;
  readonly statusLabelAr: string;
  readonly crewAr: string;
  readonly loadedQty: number;
  readonly returnedQty: number | null;
  readonly dispatchedQty: number | null;
  readonly salesCash: number;
  readonly collectionsCash: number;
  readonly openingCashFloat: number;
  readonly expectedCash: number;
  readonly countedCash: number | null;
  readonly cashVariance: number | null;
}

const paramsSchema = z.object({
  dateFrom: isoDateParamSchema,
  dateTo: isoDateParamSchema,
  status: z.enum(["all", "ongoing", "settled", "cancelled"]),
  branchId: branchIdParamSchema,
});

function sumQty(lines: readonly { readonly qty: Qty }[]): Qty {
  return Qty.sum(lines.map((l) => l.qty));
}

export function createVanSalesReport(
  defaultDateFrom: string,
  defaultDateTo: string,
): ReportDefinition<VanSalesParams, VanSalesRow, VanSalesContext> {
  return {
    id: "field.van-sales",
    titleAr: "مبيعات المندوبين",
    descriptionAr:
      "ملخص رحلات المندوبين في الفترة: المحمّل من المخزون، والمرتجع عند التسوية، والنقدية المسجلة في الميدان، وفرق النقدية عند التسوية. الكميات مجمّعة عبر كل الأصناف، و«المنصرف» هو المحمّل ناقص المرتجع (يشمل المباع وأي عجز). الرحلات غير المسواة تظهر بخانات فارغة في أعمدة التسوية.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, status: "all", branchId: "" },
    paramFields: [
      { kind: ReportParamKind.DateRange, fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" },
      {
        kind: ReportParamKind.Select,
        key: "status",
        label: "الحالة",
        options: [
          { value: "all", label: "كل الحالات" },
          { value: "ongoing", label: "جارية" },
          { value: "settled", label: "مسواة" },
          { value: "cancelled", label: "ملغاة" },
        ],
      },
      BRANCH_PARAM_FIELD,
    ],
    rowKey: (row) => row.tripId,
    group: { key: (row) => row.status, label: (row) => row.statusLabelAr },
    columns: [
      { key: "tripLabel", header: "الرحلة", format: "text", value: (row) => row.tripLabel },
      { key: "date", header: "التاريخ", format: "date", value: (row) => row.date },
      { key: "crewAr", header: "الطاقم", format: "text", value: (row) => row.crewAr },
      { key: "loadedQty", header: "المحمّل", format: "qty", align: "end", total: true, value: (row) => row.loadedQty },
      { key: "returnedQty", header: "المرتجع", format: "qty", align: "end", total: true, value: (row) => row.returnedQty },
      { key: "dispatchedQty", header: "المنصرف", format: "qty", align: "end", total: true, value: (row) => row.dispatchedQty },
      { key: "salesCash", header: "مبيعات نقدية", format: "money", align: "end", total: true, value: (row) => row.salesCash },
      { key: "collectionsCash", header: "تحصيلات", format: "money", align: "end", total: true, value: (row) => row.collectionsCash },
      { key: "openingCashFloat", header: "العهدة الافتتاحية", format: "money", align: "end", total: true, value: (row) => row.openingCashFloat },
      { key: "expectedCash", header: "النقدية المتوقعة", format: "money", align: "end", total: true, value: (row) => row.expectedCash },
      { key: "countedCash", header: "النقدية المستلمة", format: "money", align: "end", total: true, value: (row) => row.countedCash },
      { key: "cashVariance", header: "فرق النقدية", format: "money", align: "end", total: true, value: (row) => row.cashVariance },
    ],
    kpis: [
      { key: "salesCash", labelAr: "مبيعات نقدية", format: "money", value: (rows) => sumRows(rows, (r) => r.salesCash) },
      { key: "collectionsCash", labelAr: "تحصيلات", format: "money", value: (rows) => sumRows(rows, (r) => r.collectionsCash) },
      { key: "cashVariance", labelAr: "فرق النقدية", hintAr: "المستلم عند التسوية ناقص المتوقع", format: "money", value: (rows) => sumRows(rows, (r) => r.cashVariance), tone: (value) => (value === 0 ? "success" : "danger") },
      { key: "tripCount", labelAr: "عدد الرحلات", format: "qty", value: (rows) => rows.length },
    ],
    chart: {
      labelColumn: "crewAr",
      valueColumn: "salesCash",
      aggregate: true,
      maxPoints: 8,
      captionAr: "المبيعات النقدية لكل طاقم في الفترة.",
    },
    run: (params, ctx) => {
      const employeeNames = new Map(ctx.employees.map((e) => [e.id, fullNameAr(e)]));
      const rows: VanSalesRow[] = [];

      for (const trip of ctx.trips) {
        if (!withinDateRange(trip.date, params.dateFrom, params.dateTo)) continue;
        if (params.status !== "all" && trip.status !== params.status) continue;
        if (!matchesBranch(trip.branchId, params.branchId)) continue;

        const salesCash = Money.sum(trip.cashMovements.filter((m) => m.kind === "sale").map((m) => m.amount));
        const collectionsCash = Money.sum(trip.cashMovements.filter((m) => m.kind === "collection").map((m) => m.amount));
        const loadedQty = sumQty(trip.loadedStock);
        const settlement = trip.settlement;
        const returnedQty = settlement ? Qty.sum(settlement.stockCounts.map((s) => s.countedQty)) : null;
        const expectedCash =
          settlement?.expectedCash ??
          Money.fromScaled(trip.openingCashFloat.scaled + salesCash.scaled + collectionsCash.scaled);

        rows.push({
          tripId: trip.id,
          tripLabel: trip.tripNo ?? trip.id.slice(0, 8),
          date: trip.date,
          status: trip.status,
          statusLabelAr: getVanTripStatusLabel(trip.status),
          crewAr: trip.crew.map((c) => employeeNames.get(c.employeeId) ?? c.employeeId).join("، "),
          loadedQty: Number(loadedQty.toString()),
          returnedQty: returnedQty ? Number(returnedQty.toString()) : null,
          dispatchedQty: returnedQty ? Number(Qty.fromScaled(loadedQty.scaled - returnedQty.scaled).toString()) : null,
          salesCash: Number(salesCash.toString()),
          collectionsCash: Number(collectionsCash.toString()),
          openingCashFloat: Number(trip.openingCashFloat.toString()),
          expectedCash: Number(expectedCash.toString()),
          countedCash: settlement ? Number(settlement.countedCash.toString()) : null,
          cashVariance: settlement ? Number(settlement.cashVariance.toString()) : null,
        });
      }

      return rows.sort((a, b) => (a.date === b.date ? a.tripLabel.localeCompare(b.tripLabel) : a.date.localeCompare(b.date)));
    },
  };
}
