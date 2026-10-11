/**
 * Tax rates — core entity (docs/archive/catalog/04-accounting-treasury.md "الضرائب").
 * A `TaxRate` is the master record used when building sales/purchase invoice
 * lines: it carries the percentage applied, whether that percentage is
 * exclusive (added on top of the line price) or inclusive (already baked into
 * the price), optional GL posting-account overrides, and the Egyptian ETA
 * e-invoice VAT sub-type classification (V001–V009).
 */

export enum TaxCalculationTypeCode {
  Exclusive = "exclusive",
  Inclusive = "inclusive",
}
export type TaxCalculationType = `${TaxCalculationTypeCode}`;
export enum TaxRateStatusCode {
  Active = "active",
  Inactive = "inactive",
}
export type TaxRateStatus = `${TaxRateStatusCode}`;

/**
 * Egyptian ETA e-invoice VAT sub-type codes (docs/archive/catalog/04's "الضرائب"
 * section transcribes V001–V009 from the tax dialog's helper text). "auto"
 * mirrors the mockup's default option — "تلقائي (أساسي عند وجود ضريبة، غير
 * خاضع عند 0%)" — which lets the invoicing engine pick V009 (basic sales) or
 * V004 (not subject) itself based on the line's rate at submission time.
 */
export enum EtaVatSubTypeCode {
  Auto = "auto",
  ExportGoods = "V001",
  ExportServices = "V002",
  Exempt = "V003",
  NotSubject = "V004",
  V005 = "V005",
  V006 = "V006",
  V007 = "V007",
  V008 = "V008",
  BasicSales = "V009",
}
export const ETA_VAT_SUBTYPES: readonly EtaVatSubTypeCode[] = Object.values(EtaVatSubTypeCode);
// EXTERNAL CONTRACT: the wire carries these as plain strings, so the value
// type is the enum's own values — derived from it, never listed a second time.
export type EtaVatSubType = `${EtaVatSubTypeCode}`;

export interface EtaVatSubTypeDefinition {
  readonly code: EtaVatSubType;
  readonly labelAr: string;
}

/** Only the four codes the catalog documents a meaning for carry a specific label; the rest are listed generically. */
export const ETA_VAT_SUBTYPE_DEFINITIONS: readonly EtaVatSubTypeDefinition[] = [
  { code: EtaVatSubTypeCode.Auto, labelAr: "تلقائي (أساسي عند وجود ضريبة، غير خاضع عند 0%)" },
  { code: EtaVatSubTypeCode.ExportGoods, labelAr: "V001 — تصدير (سلع)" },
  { code: EtaVatSubTypeCode.ExportServices, labelAr: "V002 — تصدير (خدمات)" },
  { code: EtaVatSubTypeCode.Exempt, labelAr: "V003 — معفى" },
  { code: EtaVatSubTypeCode.NotSubject, labelAr: "V004 — غير خاضع للضريبة" },
  { code: EtaVatSubTypeCode.V005, labelAr: "V005" },
  { code: EtaVatSubTypeCode.V006, labelAr: "V006" },
  { code: EtaVatSubTypeCode.V007, labelAr: "V007" },
  { code: EtaVatSubTypeCode.V008, labelAr: "V008" },
  { code: EtaVatSubTypeCode.BasicSales, labelAr: "V009 — ضريبة أساسية على المبيعات" },
] as const;

export function getEtaVatSubTypeLabel(code: EtaVatSubType): string {
  return ETA_VAT_SUBTYPE_DEFINITIONS.find((d) => d.code === code)?.labelAr ?? code;
}

export interface TaxRate {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /** Percentage, e.g. 14 for 14%. Stored as a plain number — not a ledger Money amount. */
  readonly rate: number;
  readonly calculationType: TaxCalculationType;
  /** At most one tax rate may be `isDefault` at a time (enforced in create/update). */
  readonly isDefault: boolean;
  /** Output/sales tax payable GL account override. Null = fall back to the tenant default (2200). */
  readonly outputTaxAccountId: string | null;
  /** Input/purchases tax receivable GL account override. Null = fall back to the tenant default (1400). */
  readonly inputTaxAccountId: string | null;
  readonly etaSubType: EtaVatSubType;
  readonly status: TaxRateStatus;
}

/** Persistence port for tax rates. The domain depends on this interface only — no SQL, no driver. */
export interface TaxRateUsage {
  isReferenced(taxRateId: string): Promise<boolean>;
}

export const ASSUME_TAX_RATE_REFERENCED: TaxRateUsage = { isReferenced: async () => true };

export interface TaxRateRepository {
  findById(id: string): Promise<TaxRate | null>;
  findByCode(code: string): Promise<TaxRate | null>;
  list(): Promise<TaxRate[]>;
  /** INVARIANT: inserts only. An id that already exists is an error, never an overwrite. */
  create(taxRate: TaxRate): Promise<void>;
  update(taxRate: TaxRate): Promise<void>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
