/**
 * Tax rates — core entity (docs/archive/catalog/04-accounting-treasury.md "الضرائب").
 * A `TaxRate` is the master record used when building sales/purchase invoice
 * lines: it carries the percentage applied, whether that percentage is
 * exclusive (added on top of the line price) or inclusive (already baked into
 * the price), optional GL posting-account overrides, and the Egyptian ETA
 * e-invoice VAT sub-type classification (V001–V009).
 */

export type TaxCalculationType = "exclusive" | "inclusive";
export type TaxRateStatus = "active" | "inactive";

/**
 * Egyptian ETA e-invoice VAT sub-type codes (docs/archive/catalog/04's "الضرائب"
 * section transcribes V001–V009 from the tax dialog's helper text). "auto"
 * mirrors the mockup's default option — "تلقائي (أساسي عند وجود ضريبة، غير
 * خاضع عند 0%)" — which lets the invoicing engine pick V009 (basic sales) or
 * V004 (not subject) itself based on the line's rate at submission time.
 */
export const ETA_VAT_SUBTYPES = [
  "auto",
  "V001",
  "V002",
  "V003",
  "V004",
  "V005",
  "V006",
  "V007",
  "V008",
  "V009",
] as const;
export type EtaVatSubType = (typeof ETA_VAT_SUBTYPES)[number];

export interface EtaVatSubTypeDefinition {
  readonly code: EtaVatSubType;
  readonly labelAr: string;
}

/** Only the four codes the catalog documents a meaning for carry a specific label; the rest are listed generically. */
export const ETA_VAT_SUBTYPE_DEFINITIONS: readonly EtaVatSubTypeDefinition[] = [
  { code: "auto", labelAr: "تلقائي (أساسي عند وجود ضريبة، غير خاضع عند 0%)" },
  { code: "V001", labelAr: "V001 — تصدير (سلع)" },
  { code: "V002", labelAr: "V002 — تصدير (خدمات)" },
  { code: "V003", labelAr: "V003 — معفى" },
  { code: "V004", labelAr: "V004 — غير خاضع للضريبة" },
  { code: "V005", labelAr: "V005" },
  { code: "V006", labelAr: "V006" },
  { code: "V007", labelAr: "V007" },
  { code: "V008", labelAr: "V008" },
  { code: "V009", labelAr: "V009 — ضريبة أساسية على المبيعات" },
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
export interface TaxRateRepository {
  findById(id: string): Promise<TaxRate | null>;
  findByCode(code: string): Promise<TaxRate | null>;
  list(): Promise<TaxRate[]>;
  create(taxRate: TaxRate): Promise<void>;
  update(taxRate: TaxRate): Promise<void>;
}
