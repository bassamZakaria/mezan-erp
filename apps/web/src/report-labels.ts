import type { ReportColumn, ReportParamField } from "@mezan/domain";
import { WEB_TRANSLATION_KEYS } from "./i18n/catalog";
import type { AppTranslationKey } from "./i18n";
import type { ReportScreenDefinition } from "./screens/reports/ReportScreen";

/**
 * Reports carry their copy from the server: a `ReportDefinition`'s title,
 * description, column headers and parameter labels are Arabic strings shared
 * with the API so screen and server can never drift. That sharing is the point
 * of the design, so the copy is NOT moved — it is overlaid here, keyed by the
 * ids the payload already carries (`report.<id>.title`,
 * `report.<id>.col.<columnKey>`). No server or protocol change.
 *
 * A key the catalogue lacks falls through to the definition's own Arabic.
 * `translate` humanizes an unknown key instead of leaking it, so without the
 * key set below a missing translation would silently read "Contribution
 * Percent" and look deliberate.
 */

type Translate = (key: AppTranslationKey) => string;

/** Same overlay the column headers use, exposed for the summary strip's KPI labels. */
export function tryReportLabel(key: string, fallback: string, t: Translate): string {
  return tryTranslate(key, fallback, t);
}

function tryTranslate(key: string, fallback: string, t: Translate): string {
  if (WEB_TRANSLATION_KEYS.has(key)) return t(key as AppTranslationKey);
  // A key derived from the WRONG identifier falls back to Arabic and looks
  // deliberate — the parameter keys here were first written from the labels
  // rather than the field keys, and the report read correctly in Arabic while
  // silently refusing to translate. Say so in dev.
  if (import.meta.env.DEV) console.warn(`[i18n] report copy has no catalogue key "${key}" — falling back to Arabic.`);
  return fallback;
}

function localizeParamField(id: string, field: ReportParamField, t: Translate): ReportParamField {
  if (field.kind === "branch") return field;
  const label = tryTranslate(`report.${id}.param.${paramKeyOf(field)}`, field.label, t);
  if (field.kind === "text") {
    const placeholder = field.placeholder ? tryTranslate(`report.${id}.ph.${field.key}`, field.placeholder, t) : field.placeholder;
    return { ...field, label, placeholder };
  }
  if (field.kind !== "select") return { ...field, label };
  return {
    ...field,
    label,
    options: field.options.map((option) => ({
      ...option,
      label: tryTranslate(`report.${id}.opt.${field.key}.${option.value}`, option.label, t),
    })),
  };
}

function paramKeyOf(field: ReportParamField): string {
  return field.kind === "dateRange" ? field.fromKey : field.key;
}

/**
 * Columns whose CELLS carry copy rather than data. A report row is computed
 * server-side, and a handful of columns hold a label the server already
 * resolved into Arabic ("180-365 يوم") next to columns holding real tenant data
 * (an item's name, a warehouse's name) that must stay Arabic in both locales.
 *
 * Some rows carry the underlying code and some carry only the label, so the
 * lookup goes through the Arabic string. That is deliberate but fragile: reword
 * the label in `@mezan/domain` and this stops matching. The dev warning below
 * is what makes that loud instead of silent.
 */
const CELL_LABEL_KEYS: Readonly<Record<string, string>> = {
  "أقل من 30 يوم": "reportCell.ageBucket.under30",
  "30-90 يوم": "reportCell.ageBucket.30to90",
  "90-180 يوم": "reportCell.ageBucket.90to180",
  "180-365 يوم": "reportCell.ageBucket.180to365",
  "أكثر من 365 يوم": "reportCell.ageBucket.over365",
  "منتهي الصلاحية": "reportCell.expiry.expired",
  "خلال 30 يوم": "reportCell.expiry.within30",
  "خلال 60 يوم": "reportCell.expiry.within60",
  "خلال 90 يوم": "reportCell.expiry.within90",
  "أكثر من 90 يوم": "reportCell.expiry.beyond90",
  "خفيف": "reportCell.severity.light",
  "متوسط": "reportCell.severity.medium",
  "حرج": "reportCell.severity.critical",
  "فارق قيمة فقط": "reportCell.driftType.value",
  "فارق كمية فقط": "reportCell.driftType.qty",
  "فارق قيمة وكمية": "reportCell.driftType.both",
  "التصنيع أرخص": "reportCell.verdict.make",
  "الشراء أرخص": "reportCell.verdict.buy",
  "متعادل": "reportCell.verdict.tie",
  "بيانات غير كافية": "reportCell.verdict.unknown",
  "وارد": "reportCell.direction.IN",
  "صادر": "reportCell.direction.OUT",
  "نشطة": "reportCell.planStatus.active",
  "مكتملة": "reportCell.planStatus.completed",
  "تسوية مخزون": "reportCell.sourceDoc.ADJUSTMENT",
  "تحويل مخزون": "reportCell.sourceDoc.TRANSFER",
  "فاتورة مشتريات": "reportCell.sourceDoc.PURCHASE_INVOICE",
  "استلام بضاعة": "reportCell.sourceDoc.PURCHASE_RECEIPT",
  "فاتورة مبيعات": "reportCell.sourceDoc.SALES_INVOICE",
  "مرتجع مبيعات": "reportCell.sourceDoc.SALES_RETURN",
  "مرتجع مشتريات": "reportCell.sourceDoc.PURCHASE_RETURN",
  "بيع نقطة بيع": "reportCell.sourceDoc.POS_SALE",
  "أمر إنتاج": "reportCell.sourceDoc.WORK_ORDER",
  "إلغاء استلام/فاتورة مشتريات": "reportCell.sourceDoc.PURCHASE_CANCELLATION",
  "غير محسوب": "reportCell.notComputed",
};

/** Columns holding copy. Everything not named here is data and is left alone. */
const LABEL_COLUMN_KEYS: ReadonlySet<string> = new Set([
  "ageBucketLabel",
  "statusLabel",
  "severityLabel",
  "typeLabel",
  "verdictLabel",
  "direction",
  "sourceDocTypeLabel",
  // Normally numeric (format: "money"); the server sends the "غير محسوب"
  // label in its place for a payslip whose employer cost predates D191 — a
  // number stays untouched, only that one Arabic string is looked up.
  "employerCost",
]);

const ARABIC = /[\u0600-\u06FF]/;

function localizeCell(value: string | number | null, t: Translate): string | number | null {
  if (typeof value !== "string" || !ARABIC.test(value)) return value;
  const key = CELL_LABEL_KEYS[value];
  if (key) return t(key as AppTranslationKey);
  if (import.meta.env.DEV) console.warn(`[i18n] report cell "${value}" has no catalogue key — falling back to Arabic.`);
  return value;
}

/**
 * A report SECTION's own name — the trial balance's account types, the balance
 * sheet's sections, the cash-flow activities. These are domain enums, not
 * tenant data, so they must translate; the section headers, their subtotal rows
 * and the group-sourced charts all read this one map.
 */
const GROUP_LABEL_KEYS: Readonly<Record<string, string>> = {
  "الأصول": "reportGroup.accountType.asset",
  "الالتزامات": "reportGroup.accountType.liability",
  "حقوق الملكية": "reportGroup.accountType.equity",
  "الإيرادات": "reportGroup.accountType.revenue",
  "المصروفات": "reportGroup.accountType.expense",
  "حسابات نظامية": "reportGroup.accountType.memorandum",
  "تكلفة البضاعة المباعة": "reportGroup.section.cogs",
  "المصاريف التشغيلية": "reportGroup.section.opex",
  "الإيرادات والمكاسب الأخرى": "reportGroup.section.otherIncome",
  "المصروفات والخسائر الأخرى": "reportGroup.section.otherExpense",
  "النقدية وما في حكمها": "reportGroup.section.cash",
  "الأصول المتداولة": "reportGroup.section.currentAsset",
  "الأصول غير المتداولة": "reportGroup.section.nonCurrentAsset",
  "الالتزامات المتداولة": "reportGroup.section.currentLiability",
  "الالتزامات غير المتداولة": "reportGroup.section.nonCurrentLiability",
  "الأنشطة التشغيلية": "reportGroup.activity.operating",
  "الأنشطة الاستثمارية": "reportGroup.activity.investing",
  "الأنشطة التمويلية": "reportGroup.activity.financing",
  "ضريبة المخرجات (المبيعات)": "reportGroup.vat.output",
  "ضريبة المدخلات (المشتريات)": "reportGroup.vat.input",
  "جارية": "reportGroup.vanTrip.ongoing",
  "مسواة": "reportGroup.vanTrip.settled",
  "ملغاة": "reportGroup.vanTrip.cancelled",
};

/** A section name the map does not know is tenant data (an account, a customer) and stays as it is. */
export function localizeGroupLabel(label: string, t: Translate): string {
  const key = GROUP_LABEL_KEYS[label];
  return key ? t(key as AppTranslationKey) : label;
}

export function localizeReportDefinition<TParams, Row>(
  definition: ReportScreenDefinition<TParams, Row>,
  t: Translate,
): ReportScreenDefinition<TParams, Row> {
  const { id } = definition;
  return {
    ...definition,
    titleAr: tryTranslate(`report.${id}.title`, definition.titleAr, t),
    descriptionAr:
      definition.descriptionAr === undefined
        ? undefined
        : tryTranslate(`report.${id}.description`, definition.descriptionAr, t),
    paramFields: definition.paramFields.map((field) => localizeParamField(id, field, t)),
    columns: definition.columns.map(
      (column): ReportColumn<Row> => ({
        ...column,
        header: tryTranslate(`report.${id}.col.${column.key}`, column.header, t),
        value: LABEL_COLUMN_KEYS.has(column.key) ? (row: Row) => localizeCell(column.value(row), t) : column.value,
      }),
    ),
  };
}
