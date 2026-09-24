/**
 * Which VAT sub-type a submitted line carries.
 *
 * The sub-type is a statement about the TREATMENT of the sale, not about the
 * number on the line: معفى (V003) and تصدير بنسبة صفر (V001) both carry a rate
 * of zero and are different filings, and غير خاضع (V004) is a third thing
 * again. Deciding from the rate alone — which is all this used to do — files
 * any of the three as any other (D79).
 *
 * So the treatment decides, and the rate is only consulted when nothing else
 * is known. A rate left on "auto" therefore carries no treatment, which is
 * exactly the condition the readiness checklist counts as
 * `taxRatesMissingSubType` and `etaVatSubTypeIsAmbiguous` reports per rate.
 */

/** المعاملة الضريبية — what kind of sale this is, in the authority's terms. */
export type EtaVatTreatment =
  | "standard" // خاضع بالنسبة الأساسية
  | "export_goods" // تصدير سلع بنسبة صفر
  | "export_services" // تصدير خدمات بنسبة صفر
  | "exempt" // معفى
  | "not_subject"; // غير خاضع للضريبة

/** EXTERNAL CONTRACT: the authority's V-codes for each treatment. */
const TREATMENT_SUBTYPES: Record<EtaVatTreatment, string> = {
  standard: "V009",
  export_goods: "V001",
  export_services: "V002",
  exempt: "V003",
  not_subject: "V004",
};

const TREATMENT_LABELS_AR: Record<EtaVatTreatment, string> = {
  standard: "خاضع بالنسبة الأساسية",
  export_goods: "تصدير سلع (نسبة صفر)",
  export_services: "تصدير خدمات (نسبة صفر)",
  exempt: "معفى",
  not_subject: "غير خاضع للضريبة",
};

export function getEtaVatTreatmentLabel(treatment: EtaVatTreatment): string {
  return TREATMENT_LABELS_AR[treatment];
}

function isConfigured(configured: string | null | undefined): configured is string {
  return !!configured && configured !== "auto";
}

/**
 * The sub-type to file. An explicitly classified tax rate wins; otherwise the
 * treatment decides; and only with neither does the rate value get a say.
 */
export function resolveEtaVatSubType(
  configured: string | null | undefined,
  taxRatePercent: number,
  treatment?: EtaVatTreatment | null,
): string {
  if (isConfigured(configured)) return configured;
  if (treatment) return TREATMENT_SUBTYPES[treatment];
  return taxRatePercent > 0 ? "V009" : "V004";
}

/**
 * True when the resolver had to guess — nothing classified the rate, no
 * treatment was supplied, and the rate is zero, which is the one case where
 * V001, V002, V003 and V004 are all plausible and only one is correct.
 *
 * A taxed line is not ambiguous: whatever else it might be, a rate above zero
 * is basic sales tax.
 */
export function etaVatSubTypeIsAmbiguous(
  configured: string | null | undefined,
  taxRatePercent: number,
  treatment?: EtaVatTreatment | null,
): boolean {
  if (isConfigured(configured)) return false;
  if (treatment) return false;
  return taxRatePercent <= 0;
}
