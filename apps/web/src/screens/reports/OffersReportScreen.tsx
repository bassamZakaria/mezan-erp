import { BRANCH_PARAM_FIELD, ReportParamKind, type ReportColumn, type ReportParamField } from "@mezan/domain";
import { ReportScreen, type ReportScreenDefinition } from "./ReportScreen";
import { monthStartIso, todayIso } from "../../lib/dates";

/**
 * تقرير العروض — the promotions report (docs/archive/catalog/08-reports.md:87;
 * the columns and KPIs are specified in 01-sales.md §"تقرير العروض"). It was
 * the one catalogue report with neither a route nor a screen (P-8).
 *
 * What it answers: what the shop gave away through campaigns in a period,
 * per campaign, and what the returns handed back. The figures are the ones
 * each invoice RECORDED at confirm — re-evaluating today's campaign rules
 * against last month's invoices would restate history whenever a promotion is
 * edited — so «الخصم الممنوح» here and the `promotionDiscountTotal` on the
 * invoices are the same money.
 *
 * The definition lives here rather than in @mezan/domain's report registry
 * because its `run` has no single-repository context: it reads invoices,
 * returns and the promotion master together, and the route computes it.
 */

interface OffersReportRow {
  readonly promotionId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly type: string;
  readonly uses: number;
  readonly granted: number;
  readonly reversed: number;
  readonly net: number;
}

interface OffersReportParams {
  readonly dateFrom: string;
  readonly dateTo: string;
}

const TYPE_LABEL_AR: Readonly<Record<string, string>> = {
  percentage: "نسبة خصم",
  fixed_amount: "خصم مبلغ",
  special_price: "سعر خاص",
  bundle: "حزمة",
  buy_x_get_y: "اشترِ واحصل",
};

const paramFields: readonly ReportParamField[] = [
  { kind: ReportParamKind.DateRange, fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" },
  BRANCH_PARAM_FIELD,
];

const columns: readonly ReportColumn<OffersReportRow>[] = [
  { key: "code", header: "الرمز", format: "text", value: (row) => row.code },
  { key: "nameAr", header: "الاسم", format: "text", value: (row) => row.nameAr },
  { key: "type", header: "النوع", format: "text", value: (row) => TYPE_LABEL_AR[row.type] ?? row.type ?? "—" },
  { key: "uses", header: "مرات الاستخدام", format: "qty", align: "end", total: true, value: (row) => row.uses },
  { key: "granted", header: "الخصم الممنوح", format: "money", align: "end", total: true, value: (row) => row.granted },
  { key: "reversed", header: "خصم معكوس (مرتجعات)", format: "money", align: "end", total: true, value: (row) => row.reversed },
  { key: "net", header: "صافي الخصم", format: "money", align: "end", total: true, value: (row) => row.net },
];

const definition: ReportScreenDefinition<OffersReportParams, OffersReportRow> = {
  id: "sales.offers",
  titleAr: "تقرير العروض",
  descriptionAr: "كم منحت العروض من خصم خلال الفترة، وكم رُدّ منه بالمرتجعات.",
  paramFields,
  defaultParams: { dateFrom: monthStartIso(), dateTo: todayIso() },
  columns,
  rowKey: (row) => row.promotionId,
  chart: {
    labelColumn: "nameAr",
    valueColumn: "net",
    maxPoints: 8,
    captionAr: "العروض مرتبة من الأعلى خصماً صافياً في الفترة.",
  },
};

export function OffersReportScreen() {
  return <ReportScreen definition={definition} apiPath="/sales/offers" />;
}
