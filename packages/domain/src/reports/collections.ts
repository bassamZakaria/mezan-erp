import { z } from "zod";
import { isoDateParamSchema } from "./iso-date.js";
import { Money, allocate } from "../money/index.js";
import { INVOICE_REP_ROLE_LABELS_AR, InvoiceRepRole, invoiceRepOf, type SalesInvoice } from "../sales-invoices/sales-invoice.js";
import type { ReportDefinition, ReportParamField } from "./types.js";
import { ReportParamKind } from "./types.js";
import { countDistinct, sumMoneyStrings } from "./kpi.js";
import { periodBucketKey, withinDateRange } from "./period-bucket.js";
import { BRANCH_PARAM_FIELD, branchIdParamSchema, matchesBranch } from "./branch-filter.js";

export const UNASSIGNED_COLLECTION_KEY = "__unassigned__";
const UNASSIGNED_LABEL_AR = "غير محدد";
const UNALLOCATED_LABEL_AR = "غير مخصص على فاتورة";

export type CollectionInvoiceReps = Pick<
  SalesInvoice,
  "docNo" | "salespersonId" | "salespersonNameAr" | "salesManagerId" | "salesManagerNameAr" | "promotionRepId" | "promotionRepNameAr" | "promotionManagerId" | "promotionManagerNameAr"
>;

export interface CollectionReportVoucher {
  readonly voucherId: string;
  readonly voucherNo: string | null;
  readonly date: string;
  readonly branchId: string | null;
  readonly customerId: string | null;
  readonly customerNameAr: string;
  readonly gross: Money;
  readonly commission: Money;
  readonly allocations: readonly { readonly invoiceId: string; readonly amount: Money }[];
  readonly postedCredit: Money;
}

export interface CollectionsContext {
  readonly vouchers: readonly CollectionReportVoucher[];
  readonly invoices: ReadonlyMap<string, CollectionInvoiceReps>;
}

export interface CollectionsParams {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly customerId: string;
  readonly repRole: InvoiceRepRole;
  readonly repId: string;
  readonly branchId: string;
}

export interface CollectionShareRow {
  readonly key: string;
  readonly voucherId: string;
  readonly voucherNo: string;
  readonly date: string;
  readonly customerId: string | null;
  readonly customerNameAr: string;
  readonly invoiceNo: string;
  readonly repId: string;
  readonly repNameAr: string;
  readonly gross: string;
  readonly commission: string;
  readonly net: string;
}

export interface MonthlyCollectionRow {
  readonly key: string;
  readonly month: string;
  readonly repId: string;
  readonly repNameAr: string;
  readonly voucherCount: number;
  readonly gross: string;
  readonly commission: string;
  readonly net: string;
}

export interface CollectionFilterOption {
  readonly value: string;
  readonly label: string;
}

export interface CollectionFilterOptions {
  readonly customers: readonly CollectionFilterOption[];
  readonly reps: readonly CollectionFilterOption[];
}

const paramsSchema = z
  .object({
    dateFrom: isoDateParamSchema,
    dateTo: isoDateParamSchema,
    customerId: z.string().default(""),
    repRole: z.nativeEnum(InvoiceRepRole).default(InvoiceRepRole.SalesRep),
    repId: z.string().default(""),
    branchId: branchIdParamSchema,
  })
  .refine((p) => p.dateFrom <= p.dateTo, { message: "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية" });

function paramFields(options: CollectionFilterOptions): ReportParamField[] {
  return [
    { kind: ReportParamKind.DateRange, fromKey: "dateFrom", toKey: "dateTo", label: "الفترة" },
    { kind: ReportParamKind.Select, key: "customerId", label: "العميل", options: [{ value: "", label: "كل العملاء" }, ...options.customers] },
    {
      kind: ReportParamKind.Select,
      key: "repRole",
      label: "المندوب حسب",
      options: Object.values(InvoiceRepRole).map((role) => ({ value: role, label: INVOICE_REP_ROLE_LABELS_AR[role] })),
    },
    {
      kind: ReportParamKind.Select,
      key: "repId",
      label: "المندوب",
      options: [{ value: "", label: "كل المندوبين" }, ...options.reps, { value: UNASSIGNED_COLLECTION_KEY, label: UNASSIGNED_LABEL_AR }],
    },
    BRANCH_PARAM_FIELD,
  ];
}

interface Share {
  readonly voucher: CollectionReportVoucher;
  readonly invoiceId: string | null;
  readonly invoiceNo: string;
  readonly repId: string;
  readonly repNameAr: string;
  readonly gross: Money;
  readonly commission: Money;
}

function sharesOf(voucher: CollectionReportVoucher, ctx: CollectionsContext, role: InvoiceRepRole): Share[] {
  const allocated = voucher.allocations.reduce((sum, a) => sum + a.amount.scaled, 0n);
  const remainder = voucher.gross.scaled - allocated;
  const parts = [
    ...voucher.allocations.map((a) => ({ invoiceId: a.invoiceId as string | null, gross: a.amount })),
    ...(remainder > 0n ? [{ invoiceId: null as string | null, gross: Money.fromScaled(remainder) }] : []),
  ].filter((p) => p.gross.scaled > 0n);
  if (parts.length === 0) return [];
  const commissions = allocate(voucher.commission, parts.map((p) => p.gross.scaled));
  return parts.map((part, i) => {
    const invoice = part.invoiceId ? ctx.invoices.get(part.invoiceId) : undefined;
    const rep = invoice ? invoiceRepOf(invoice, role) : { id: null, nameAr: null };
    return {
      voucher,
      invoiceId: part.invoiceId,
      invoiceNo: part.invoiceId ? (invoice?.docNo ?? part.invoiceId) : UNALLOCATED_LABEL_AR,
      repId: rep.id ?? UNASSIGNED_COLLECTION_KEY,
      repNameAr: rep.id ? (rep.nameAr ?? rep.id) : UNASSIGNED_LABEL_AR,
      gross: part.gross,
      commission: commissions[i]!,
    };
  });
}

function vouchersInWindow(params: CollectionsParams, ctx: CollectionsContext): CollectionReportVoucher[] {
  return ctx.vouchers.filter(
    (v) =>
      withinDateRange(v.date, params.dateFrom, params.dateTo) &&
      matchesBranch(v.branchId ?? "", params.branchId) &&
      (params.customerId === "" || v.customerId === params.customerId),
  );
}

function filteredShares(params: CollectionsParams, ctx: CollectionsContext): Share[] {
  return vouchersInWindow(params, ctx)
    .flatMap((v) => sharesOf(v, ctx, params.repRole))
    .filter((s) => params.repId === "" || s.repId === params.repId);
}

const net = (s: { gross: Money; commission: Money }) => Money.fromScaled(s.gross.scaled - s.commission.scaled);

const reconciliation = {
  labelAr: "إجمالي التحصيل = ما سُجّل دائناً على العملاء من سندات التحصيل في الفترة",
  computeExactTotals: (rows: readonly { gross: string }[], ctx: CollectionsContext, params: CollectionsParams) =>
    params.repId !== ""
      ? null
      : {
          report: Money.fromMajor(sumMoneyStrings(rows, (r) => [r.gross])),
          reference: Money.sum(vouchersInWindow(params, ctx).map((v) => v.postedCredit)),
        },
};

const moneyKpis = [
  { key: "gross", labelAr: "إجمالي التحصيل", format: "money" as const, value: (rows: readonly { gross: string }[]) => sumMoneyStrings(rows, (r) => [r.gross]) },
  { key: "commission", labelAr: "عمولات التحويل", format: "money" as const, value: (rows: readonly { commission: string }[]) => sumMoneyStrings(rows, (r) => [r.commission]) },
  { key: "net", labelAr: "صافي ما وصل الخزينة", format: "money" as const, value: (rows: readonly { net: string }[]) => sumMoneyStrings(rows, (r) => [r.net]) },
];

const NO_OPTIONS: CollectionFilterOptions = { customers: [], reps: [] };

export function createCollectionsReport(
  defaultDateFrom: string,
  defaultDateTo: string,
  options: CollectionFilterOptions = NO_OPTIONS,
): ReportDefinition<CollectionsParams, CollectionShareRow, CollectionsContext> {
  return {
    id: "treasury.collections",
    titleAr: "تقرير التحصيلات",
    descriptionAr:
      "سندات تحصيل العملاء في الفترة موزعة على الفواتير التي سددتها، ومنسوبة لمندوب كل فاتورة: الإجمالي المخصوم من العميل، وعمولة التحويل، والصافي الذي وصل الخزينة.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, customerId: "", repRole: InvoiceRepRole.SalesRep, repId: "", branchId: "" },
    paramFields: paramFields(options),
    rowKey: (row) => row.key,
    columns: [
      { key: "date", header: "التاريخ", format: "date", value: (row) => row.date },
      { key: "voucherNo", header: "رقم السند", format: "text", value: (row) => row.voucherNo },
      { key: "customerNameAr", header: "العميل", format: "text", value: (row) => row.customerNameAr, entity: { kind: "customer", id: (row) => row.customerId } },
      { key: "invoiceNo", header: "الفاتورة", format: "text", value: (row) => row.invoiceNo },
      { key: "repNameAr", header: "المندوب", format: "text", value: (row) => row.repNameAr },
      { key: "gross", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.gross },
      { key: "commission", header: "عمولة التحويل", format: "money", align: "end", total: true, value: (row) => row.commission },
      { key: "net", header: "الصافي", format: "money", align: "end", total: true, value: (row) => row.net },
    ],
    reconciliation,
    kpis: [...moneyKpis, { key: "voucherCount", labelAr: "عدد السندات", format: "qty", value: (rows) => countDistinct(rows, (r) => r.voucherId) }],
    chart: { labelColumn: "repNameAr", valueColumn: "gross", aggregate: true, maxPoints: 8, captionAr: "التحصيل منسوباً لمندوب الفواتير التي سددها." },
    run: (params, ctx) =>
      filteredShares(params, ctx)
        .sort((a, b) => (a.voucher.date < b.voucher.date ? -1 : a.voucher.date > b.voucher.date ? 1 : a.voucher.voucherId.localeCompare(b.voucher.voucherId)))
        .map((s) => ({
          key: `${s.voucher.voucherId}:${s.invoiceId ?? UNASSIGNED_COLLECTION_KEY}`,
          voucherId: s.voucher.voucherId,
          voucherNo: s.voucher.voucherNo ?? s.voucher.voucherId,
          date: s.voucher.date,
          customerId: s.voucher.customerId,
          customerNameAr: s.voucher.customerNameAr,
          invoiceNo: s.invoiceNo,
          repId: s.repId,
          repNameAr: s.repNameAr,
          gross: s.gross.toString(),
          commission: s.commission.toString(),
          net: net(s).toString(),
        })),
  };
}

export function createMonthlyCollectionsByRepReport(
  defaultDateFrom: string,
  defaultDateTo: string,
  options: CollectionFilterOptions = NO_OPTIONS,
): ReportDefinition<CollectionsParams, MonthlyCollectionRow, CollectionsContext> {
  return {
    id: "treasury.collections-monthly-by-rep",
    titleAr: "التحصيل الشهري لكل مندوب",
    descriptionAr: "ما حصّله كل مندوب في كل شهر، منسوباً عبر الفواتير التي سددتها سندات التحصيل، بالإجمالي والعمولة والصافي.",
    paramsSchema,
    defaultParams: { dateFrom: defaultDateFrom, dateTo: defaultDateTo, customerId: "", repRole: InvoiceRepRole.SalesRep, repId: "", branchId: "" },
    paramFields: paramFields(options),
    rowKey: (row) => row.key,
    group: { key: (row) => row.month, label: (row) => row.month },
    columns: [
      { key: "month", header: "الشهر", format: "text", value: (row) => row.month },
      { key: "repNameAr", header: "المندوب", format: "text", value: (row) => row.repNameAr },
      { key: "voucherCount", header: "عدد السندات", format: "qty", align: "end", value: (row) => row.voucherCount },
      { key: "gross", header: "الإجمالي", format: "money", align: "end", total: true, value: (row) => row.gross },
      { key: "commission", header: "عمولة التحويل", format: "money", align: "end", total: true, value: (row) => row.commission },
      { key: "net", header: "الصافي", format: "money", align: "end", total: true, value: (row) => row.net },
    ],
    reconciliation,
    kpis: [...moneyKpis, { key: "repCount", labelAr: "عدد المندوبين", format: "qty", value: (rows) => countDistinct(rows, (r) => r.repId) }],
    chart: { labelColumn: "repNameAr", valueColumn: "gross", aggregate: true, maxPoints: 8, captionAr: "إجمالي ما حصّله كل مندوب في الفترة." },
    run: (params, ctx) => {
      const buckets = new Map<string, { month: string; repId: string; repNameAr: string; vouchers: Set<string>; gross: bigint; commission: bigint }>();
      for (const s of filteredShares(params, ctx)) {
        const month = periodBucketKey(s.voucher.date, "month");
        const key = `${month}:${s.repId}`;
        const bucket = buckets.get(key) ?? { month, repId: s.repId, repNameAr: s.repNameAr, vouchers: new Set<string>(), gross: 0n, commission: 0n };
        bucket.vouchers.add(s.voucher.voucherId);
        bucket.gross += s.gross.scaled;
        bucket.commission += s.commission.scaled;
        buckets.set(key, bucket);
      }
      return [...buckets.entries()]
        .sort(([a, x], [b, y]) => (x.month !== y.month ? (x.month < y.month ? -1 : 1) : x.repId === UNASSIGNED_COLLECTION_KEY ? 1 : y.repId === UNASSIGNED_COLLECTION_KEY ? -1 : a.localeCompare(b)))
        .map(([key, b]) => ({
          key,
          month: b.month,
          repId: b.repId,
          repNameAr: b.repNameAr,
          voucherCount: b.vouchers.size,
          gross: Money.fromScaled(b.gross).toString(),
          commission: Money.fromScaled(b.commission).toString(),
          net: Money.fromScaled(b.gross - b.commission).toString(),
        }));
    },
  };
}
