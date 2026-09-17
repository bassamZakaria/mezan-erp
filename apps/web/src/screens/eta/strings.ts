import { useAppTranslation, type Locale } from "../../i18n";

/**
 * Strings for the e-receipt and e-seal surfaces.
 *
 * They live beside the screen rather than in the app catalog so this work can
 * land without touching a file three other efforts are also editing; folding
 * them into `apps/web/src/i18n/catalog.ts` is a mechanical move.
 */
const strings = {
  ar: {
    receiptsTitle: "الإيصالات الإلكترونية (تجزئة)",
    receiptsPending: "في انتظار الإبلاغ",
    receiptsOverdue: "تجاوزت مهلة الإبلاغ",
    receiptsDueSoon: "يقترب موعد إبلاغها",
    receiptsWindow: "مهلة الإبلاغ {hours} ساعة من وقت البيع.",
    receiptsOfflineOk: "البيع دون إنترنت مسموح — تُرسل الإيصالات تلقائياً عند عودة الاتصال.",
    receiptsOverdueWarning:
      "{count} إيصال تجاوز مهلة الإبلاغ إلى مصلحة الضرائب. أرسلها فور توفر الاتصال.",
    receiptsOldest: "أقدم إيصال لم يُبلَّغ: {date}",
    receiptsNone: "لا توجد إيصالات في انتظار الإبلاغ.",
    receiptsLoadFailed: "تعذّر قراءة قائمة الإيصالات الإلكترونية.",
    typeReceipt: "إيصال إلكتروني",
    badgeTestMode: "وضع الاختبار",
    badgeAwaitingSeal: "في انتظار الختم الإلكتروني",
    esealNotWiredTitle: "الختم الإلكتروني غير مُفعَّل في هذه النسخة",
    esealNotWiredBody:
      "طريقة التوقيع مضبوطة على الختم الإلكتروني، ولا توجد خدمة ختم موصولة، فتبقى الوثيقة في انتظار الختم ولا تُرسل. غيِّر طريقة التوقيع أو صِل خدمة الختم قبل الاعتماد على هذه الإرسالات.",
    testModeTitle: "بيئة الاختبار (Preproduction)",
    testModeBody:
      "الإرسالات تُبنى وتُحفظ، لكنها لا تُقدَّم إلى المصلحة في بيئة الاختبار. لا تعتمد على هذه النتائج في إقرار ضريبي.",
  },
  en: {
    receiptsTitle: "E-receipts (retail)",
    receiptsPending: "Awaiting reporting",
    receiptsOverdue: "Past the reporting window",
    receiptsDueSoon: "Reporting deadline near",
    receiptsWindow: "The reporting window is {hours} hours from the sale.",
    receiptsOfflineOk: "Selling offline is fine — receipts are forwarded automatically once the connection returns.",
    receiptsOverdueWarning:
      "{count} receipt(s) have passed the reporting window to the tax authority. Send them as soon as you are online.",
    receiptsOldest: "Oldest unreported receipt: {date}",
    receiptsNone: "No receipts are waiting to be reported.",
    receiptsLoadFailed: "The e-receipt queue could not be read.",
    typeReceipt: "E-receipt",
    badgeTestMode: "Test mode",
    badgeAwaitingSeal: "Awaiting e-seal",
    esealNotWiredTitle: "The e-seal is not wired in this build",
    esealNotWiredBody:
      "The signing method is set to e-seal and no signing service is connected, so documents park in «awaiting e-seal» and are never sent. Change the signing method or connect a signing service before relying on these submissions.",
    testModeTitle: "Pre-production environment",
    testModeBody:
      "Submissions are built and stored, but they are not filed with the authority in the test environment. Do not rely on these results for a tax return.",
  },
} satisfies Record<Locale, Record<string, string>>;

export type EtaStringKey = keyof (typeof strings)["ar"];

export function useEtaStrings(): (key: EtaStringKey, params?: Record<string, string>) => string {
  const { locale } = useAppTranslation();
  return (key, params) => {
    const template = strings[locale][key];
    if (!params) return template;
    return Object.entries(params).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, value), template);
  };
}
