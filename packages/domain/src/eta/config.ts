/**
 * الفاتورة الإلكترونية المصرية (ETA) — configuration (docs/catalog/04). Company
 * registration data, connection environment/credentials and the auto-submit
 * policy. The client secret is never stored in the clear — only a flag that a
 * secret is on file (the real secret lives encrypted in the persistence layer,
 * matching the catalog's "يحفظ السر مشفراً ولا يعرض مرة أخرى").
 */

export type EtaEnvironment = "preproduction" | "production";
/** Document version: 0.9 unsigned (test) or 1.0 signed (production e-seal). */
export type EtaDocumentVersion = "0.9" | "1.0";
export type EtaSigningMethod = "none" | "eseal";

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
};

/** One readiness checklist item (docs/catalog/04 "الجاهزية: 22%"). */
export interface EtaReadinessItem {
  readonly key: string;
  readonly labelAr: string;
  readonly complete: boolean;
}

export interface EtaReadiness {
  readonly items: readonly EtaReadinessItem[];
  /** 0–100, rounded. */
  readonly percent: number;
}

/** Compute the setup readiness percentage across the core config fields. */
export function computeEtaReadiness(config: EtaConfig): EtaReadiness {
  const items: EtaReadinessItem[] = [
    { key: "taxRegistrationNumber", labelAr: "رقم التسجيل الضريبي", complete: !!config.taxRegistrationNumber },
    { key: "activityCode", labelAr: "كود النشاط", complete: !!config.activityCode },
    { key: "address", labelAr: "عنوان المنشأة", complete: !!config.address },
    { key: "clientId", labelAr: "بيانات الربط (Client ID)", complete: !!config.clientId },
    { key: "clientSecret", labelAr: "السر (Client Secret)", complete: config.hasClientSecret },
  ];
  const done = items.filter((i) => i.complete).length;
  return { items, percent: Math.round((done / items.length) * 100) };
}

/** Persistence port for the single ETA config row. */
export interface EtaConfigRepository {
  get(): Promise<EtaConfig>;
  save(config: EtaConfig): Promise<void>;
}
