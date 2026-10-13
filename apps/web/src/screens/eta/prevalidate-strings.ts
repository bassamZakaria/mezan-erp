import { useAppTranslation, type Locale } from "../../i18n";

/**
 * ENH-011b pre-validation / bulk-resubmit / rejections-report strings.
 *
 * Kept beside the screen (see `strings.ts` for the same reasoning) rather
 * than in the shared app catalog, which several other lanes are editing at
 * the same time.
 */
const strings = {
  ar: {
    tabReadiness: "الجاهزية والفحص المسبق",
    tabRejections: "تقرير أسباب الرفض",
    findingsColumn: "نتائج الفحص المسبق",
    findingsNone: "لا توجد ملاحظات — المستند جاهز للإرسال.",
    findingsBlocking: "يمنع الإرسال",
    findingsWarning: "تنبيه",
    fixLink: "إصلاح",
    requeue: "إصلاح وإعادة الطابور",
    recordUuid: "تسجيل رقم المستند (UUID)",
    recordUuidHelp: "أُرسل هذا المستند ولم يُسجَّل ردّ المصلحة. إن وجدته مسجَّلًا على بوابة الفواتير الإلكترونية فاكتب رقمه هنا؛ وإن لم تجده فاختر «إصلاح وإعادة الطابور» ليُرسَل من جديد.",
    recordUuidField: "رقم المستند (UUID) من بوابة الفواتير الإلكترونية",
    recordUuidConfirm: "تأكيد تسجيل الرقم",
    requeueNotAvailable: "لا يمكن إعادة بناء هذا المستند تلقائياً.",
    bulkRequeueSubmit: "إصلاح وإرسال المحدد",
    bulkRequeueSubmitNone: "اختر صفاً واحداً على الأقل.",
    bulkResultSubmitted: "أُرسل",
    bulkResultQueued: "بانتظار الاتصال",
    bulkResultBlocked: "ما زال يحتاج إصلاحاً",
    bulkResultError: "تعذّر",
    bulkResultNotAvailable: "غير قابل لإعادة البناء",
    bulkSummary: "{submitted} أُرسل، {blocked} ما زال يحتاج إصلاحاً، {queued} بانتظار الاتصال، {failed} تعذّر.",
    selectAll: "تحديد الكل في هذه الصفحة",
    selectedCount: "محدد: {count}",
    rejectionsTitle: "أسباب الرفض مجمّعة حسب الكود",
    rejectionsNone: "لا توجد مستندات مرفوضة حالياً.",
    rejectionsTotal: "إجمالي المرفوض: {count}",
    rejectionsCode: "الكود",
    rejectionsCount: "العدد",
    rejectionsSample: "نموذج السبب",
    rejectionsExamples: "أمثلة",
    rejectionsUnknown: "غير مصنّف",
  },
  en: {
    tabReadiness: "Readiness & pre-validation",
    tabRejections: "Rejections report",
    findingsColumn: "Pre-validation findings",
    findingsNone: "No findings — ready to submit.",
    findingsBlocking: "Blocks submit",
    findingsWarning: "Warning",
    fixLink: "Fix",
    requeue: "Fix & requeue",
    recordUuid: "Record the document number (UUID)",
    recordUuidHelp: "This document was sent and the authority's answer was never recorded. If the e-invoicing portal shows it, type its number here; if it does not, choose “Fix & requeue” to send it again.",
    recordUuidField: "Document number (UUID) from the e-invoicing portal",
    recordUuidConfirm: "Record the number",
    requeueNotAvailable: "This document cannot be rebuilt automatically.",
    bulkRequeueSubmit: "Fix & submit selected",
    bulkRequeueSubmitNone: "Select at least one row.",
    bulkResultSubmitted: "Submitted",
    bulkResultQueued: "Queued offline",
    bulkResultBlocked: "Still needs a fix",
    bulkResultError: "Failed",
    bulkResultNotAvailable: "Cannot be rebuilt",
    bulkSummary: "{submitted} submitted, {blocked} still need a fix, {queued} queued offline, {failed} failed.",
    selectAll: "Select all on this page",
    selectedCount: "Selected: {count}",
    rejectionsTitle: "Rejection reasons grouped by code",
    rejectionsNone: "No rejected documents right now.",
    rejectionsTotal: "Total rejected: {count}",
    rejectionsCode: "Code",
    rejectionsCount: "Count",
    rejectionsSample: "Sample reason",
    rejectionsExamples: "Examples",
    rejectionsUnknown: "Unclassified",
  },
} satisfies Record<Locale, Record<string, string>>;

export type EtaPrevalidationStringKey = keyof (typeof strings)["ar"];

export function useEtaPrevalidationStrings(): (key: EtaPrevalidationStringKey, params?: Record<string, string>) => string {
  const { locale } = useAppTranslation();
  return (key, params) => {
    const template = strings[locale][key];
    if (!params) return template;
    return Object.entries(params).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), template);
  };
}
