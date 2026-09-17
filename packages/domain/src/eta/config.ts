/**
 * الفاتورة الإلكترونية المصرية (ETA) — configuration (docs/archive/catalog/04). Company
 * registration data, connection environment/credentials and the auto-submit
 * policy. The client secret is never stored in the clear — only a flag that a
 * secret is on file (the real secret lives encrypted in the persistence layer,
 * matching the catalog's "يحفظ السر مشفراً ولا يعرض مرة أخرى").
 */

export type EtaEnvironment = "preproduction" | "production";
/** Document version: 0.9 unsigned (test) or 1.0 signed (production e-seal). */
export type EtaDocumentVersion = "0.9" | "1.0";
export type EtaSigningMethod = "none" | "eseal";

/**
 * EXTERNAL CONTRACT — الإطار الزمني للإبلاغ عن الإيصال الإلكتروني. The tax
 * authority's own POS FAQ puts the e-receipt reporting window at 24 hours from
 * the sale; secondary compliance vendors publish 72. The primary source sets
 * the default here, and `EtaConfig.receiptReportingWindowHours` exists at all
 * because the enforced figure is disputed — a tenant told a different number
 * by their own inspector must be able to set it without a release.
 */
export const ETA_RECEIPT_REPORTING_WINDOW_HOURS = 24;

export interface EtaCompanyAddress {
  readonly governorate: string;
  readonly city: string;
  readonly street: string;
  readonly buildingNumber: string;
  readonly postalCode: string | null;
}

export interface EtaConfig {
  readonly environment: EtaEnvironment;
  /** رقم التسجيل الضريبي — taxpayer registration number. */
  readonly taxRegistrationNumber: string | null;
  /** كود النشاط — activity code. */
  readonly activityCode: string | null;
  readonly address: EtaCompanyAddress | null;
  /** حد بيانات المشتري — at/above this base-currency amount the buyer's national ID is legally required. */
  readonly buyerDataThreshold: number;
  readonly documentVersion: EtaDocumentVersion;
  /** الإرسال التلقائي عند التأكيد — auto-queue confirmed documents for submission. */
  readonly autoSubmitOnConfirm: boolean;
  readonly signingMethod: EtaSigningMethod;
  readonly clientId: string | null;
  /** True when a client secret is stored (encrypted); the secret itself is never returned. */
  readonly hasClientSecret: boolean;
  /** عناوين بوابة المصلحة — per-environment gateway addresses, configurable because the authority moves them. */
  readonly preproductionIdentityUrl: string;
  readonly preproductionApiUrl: string;
  readonly productionIdentityUrl: string;
  readonly productionApiUrl: string;
  /**
   * أمر التوقيع الخارجي — the program that talks to the taxpayer's hardware
   * token. Canonical JSON on stdin, the CAdES-BES signature on stdout. Null
   * means signing is not set up and a v1.0 document cannot be transmitted.
   */
  readonly signingCommand: string | null;
  readonly signingCommandArgs: readonly string[];
  /** مهلة الإبلاغ عن الإيصال — see {@link ETA_RECEIPT_REPORTING_WINDOW_HOURS}. */
  readonly receiptReportingWindowHours: number;
}

/** The authority's published addresses. Overridable per install; these are the defaults. */
export const ETA_DEFAULT_ENDPOINTS = {
  preproductionIdentityUrl: "https://id.preprod.eta.gov.eg",
  preproductionApiUrl: "https://api.preprod.invoicing.eta.gov.eg/api/v1",
  productionIdentityUrl: "https://id.eta.gov.eg",
  productionApiUrl: "https://api.invoicing.eta.gov.eg/api/v1",
} as const;

export interface EtaEndpoints {
  readonly identityUrl: string;
  readonly apiBaseUrl: string;
}

/** Which pair of addresses this config's environment selects, trailing slashes trimmed. */
export function resolveEtaEndpoints(config: EtaConfig): EtaEndpoints {
  const trim = (url: string): string => url.replace(/\/+$/, "");
  return config.environment === "production"
    ? { identityUrl: trim(config.productionIdentityUrl), apiBaseUrl: trim(config.productionApiUrl) }
    : { identityUrl: trim(config.preproductionIdentityUrl), apiBaseUrl: trim(config.preproductionApiUrl) };
}

export const DEFAULT_ETA_CONFIG: EtaConfig = {
  environment: "preproduction",
  taxRegistrationNumber: null,
  activityCode: null,
  address: null,
  buyerDataThreshold: 25000,
  documentVersion: "1.0",
  autoSubmitOnConfirm: true,
  signingMethod: "none",
  clientId: null,
  hasClientSecret: false,
  ...ETA_DEFAULT_ENDPOINTS,
  signingCommand: null,
  signingCommandArgs: [],
  receiptReportingWindowHours: ETA_RECEIPT_REPORTING_WINDOW_HOURS,
};

/** One readiness checklist item (docs/archive/catalog/04 "الجاهزية: 22%"). */
export interface EtaReadinessItem {
  readonly key: string;
  readonly labelAr: string;
  readonly complete: boolean;
  /** How many records still lack the code. 0 once complete; 1 for a single config field. */
  readonly missing: number;
}

export interface EtaReadiness {
  readonly items: readonly EtaReadinessItem[];
  /** 0–100, rounded. */
  readonly percent: number;
}

/**
 * How many records of each kind are still unregistered with the authority.
 * Counted from the item, unit, branch and tax-rate masters, none of which the
 * ETA module owns — the caller reads them and passes the totals in.
 */
export interface EtaReadinessCounts {
  readonly branchesMissingCode: number;
  readonly itemsMissingCode: number;
  readonly unitsMissingMapping: number;
  readonly taxRatesMissingSubType: number;
}

/**
 * Compute the setup readiness percentage. Without `counts` only the config's
 * own fields are checked; with it, the four master-data prerequisites join the
 * checklist and each reports how many records are still missing a code.
 */
export function computeEtaReadiness(config: EtaConfig, counts?: EtaReadinessCounts): EtaReadiness {
  const field = (key: string, labelAr: string, complete: boolean): EtaReadinessItem => ({
    key,
    labelAr,
    complete,
    missing: complete ? 0 : 1,
  });
  const items: EtaReadinessItem[] = [
    field("taxRegistrationNumber", "رقم التسجيل الضريبي", !!config.taxRegistrationNumber),
    field("activityCode", "كود النشاط", !!config.activityCode),
    field("address", "عنوان المنشأة", !!config.address),
  ];
  if (counts) {
    const collection = (key: string, labelAr: string, missing: number): EtaReadinessItem => ({
      key,
      labelAr,
      complete: missing === 0,
      missing,
    });
    items.push(
      collection("branchCodes", "أكواد الفروع لدى المصلحة", counts.branchesMissingCode),
      collection("itemCodes", "أكواد الأصناف", counts.itemsMissingCode),
      collection("unitMappings", "ربط الوحدات", counts.unitsMissingMapping),
      collection("taxSubTypes", "أنواع الضريبة الفرعية", counts.taxRatesMissingSubType),
    );
  }
  items.push(
    field("clientId", "بيانات الربط (Client ID)", !!config.clientId),
    field("clientSecret", "السر (Client Secret)", config.hasClientSecret),
  );
  if (config.signingMethod === "eseal") {
    items.push(field("signingCommand", "أمر التوقيع الخارجي", !!config.signingCommand?.trim()));
  }
  const done = items.filter((i) => i.complete).length;
  return { items, percent: Math.round((done / items.length) * 100) };
}

/** Persistence port for the single ETA config row. */
export interface EtaConfigRepository {
  get(): Promise<EtaConfig>;
  save(config: EtaConfig): Promise<void>;
}
