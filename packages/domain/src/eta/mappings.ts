/**
 * ETA registration mappings — the tenant's own codes translated into the codes
 * the authority recognises: a branch code per branch, a unit code per unit of
 * measure. Item codes live on the item itself (`Item.etaItemCode`) and tax
 * sub-types on the tax rate (`TaxRate.etaSubType`); only these two have no home
 * elsewhere.
 */

/**
 * One branch as the authority knows it: its branch code, and the POS device
 * registered for that branch.
 *
 * The device identity belongs HERE and not on the request that issues a
 * receipt. The authority treats the registered device as the issuing till and
 * binds every receipt to it, so a caller-supplied serial lets any client claim
 * any till's identity — and issues the POS credentials per device, not per
 * company, which is why they sit beside the serial rather than in `EtaConfig`.
 */
export interface EtaBranchCode {
  readonly branchId: string;
  /** كود الفرع لدى المصلحة — the branch code registered with the authority. */
  readonly etaBranchCode: string;
  /** الرقم التسلسلي لجهاز نقطة البيع — null until the device is registered. */
  readonly deviceSerialNumber: string | null;
  /** POS client id the authority issues for this device. */
  readonly posClientId: string | null;
  /**
   * True when a per-device client secret is on file (sealed). The secret
   * itself is never read back, exactly as `EtaConfig.hasClientSecret`.
   */
  readonly hasPosClientSecret: boolean;
}

export interface EtaBranchCodeRepository {
  list(): Promise<EtaBranchCode[]>;
  /** Writes everything but the secret — `hasPosClientSecret` is read-only. */
  save(mapping: EtaBranchCode): Promise<void>;
  setPosClientSecret(branchId: string, secret: string): Promise<void>;
}

export interface EtaUnitMapping {
  /** The tenant's own unit code (`ItemUnit.code`). */
  readonly unitCode: string;
  /** The authority's unit-of-measure code (EA, KGM, LTR…). */
  readonly etaUnitCode: string;
}

export interface EtaUnitMappingRepository {
  list(): Promise<EtaUnitMapping[]>;
  save(mapping: EtaUnitMapping): Promise<void>;
}

export interface EtaUnitCodeDefinition {
  readonly code: string;
  readonly labelAr: string;
  readonly labelEn: string;
}

/** The authority's unit-of-measure codes a general-trade tenant needs. */
export const ETA_UNIT_CODES: readonly EtaUnitCodeDefinition[] = [
  { code: "EA", labelAr: "قطعة", labelEn: "Each" },
  { code: "KGM", labelAr: "كيلوجرام", labelEn: "Kilogram" },
  { code: "GRM", labelAr: "جرام", labelEn: "Gram" },
  { code: "TNE", labelAr: "طن", labelEn: "Tonne" },
  { code: "LTR", labelAr: "لتر", labelEn: "Litre" },
  { code: "MLT", labelAr: "مليلتر", labelEn: "Millilitre" },
  { code: "MTR", labelAr: "متر", labelEn: "Metre" },
  { code: "CMT", labelAr: "سنتيمتر", labelEn: "Centimetre" },
  { code: "MTK", labelAr: "متر مربع", labelEn: "Square metre" },
  { code: "MTQ", labelAr: "متر مكعب", labelEn: "Cubic metre" },
  { code: "BX", labelAr: "صندوق", labelEn: "Box" },
  { code: "PK", labelAr: "عبوة", labelEn: "Pack" },
  { code: "DZN", labelAr: "دستة", labelEn: "Dozen" },
  { code: "SET", labelAr: "طقم", labelEn: "Set" },
  { code: "ROL", labelAr: "لفة", labelEn: "Roll" },
  { code: "HUR", labelAr: "ساعة", labelEn: "Hour" },
  { code: "DAY", labelAr: "يوم", labelEn: "Day" },
] as const;

const BY_TENANT_CODE: Record<string, string> = {
  PCS: "EA", PC: "EA", PIECE: "EA", EA: "EA", EACH: "EA", UNIT: "EA", NO: "EA",
  KG: "KGM", KGM: "KGM", KILO: "KGM",
  G: "GRM", GM: "GRM", GRM: "GRM", GRAM: "GRM",
  TON: "TNE", TONNE: "TNE", TNE: "TNE",
  L: "LTR", LT: "LTR", LTR: "LTR", LITER: "LTR", LITRE: "LTR",
  ML: "MLT", MLT: "MLT",
  M: "MTR", MTR: "MTR", METER: "MTR", METRE: "MTR",
  CM: "CMT", CMT: "CMT",
  M2: "MTK", SQM: "MTK", MTK: "MTK",
  M3: "MTQ", CBM: "MTQ", MTQ: "MTQ",
  BOX: "BX", BX: "BX", CTN: "BX", CARTON: "BX",
  PACK: "PK", PK: "PK", PKT: "PK",
  DZ: "DZN", DOZ: "DZN", DZN: "DZN", DOZEN: "DZN",
  SET: "SET",
  ROLL: "ROL", ROL: "ROL",
  HR: "HUR", HOUR: "HUR", HUR: "HUR",
  DAY: "DAY", D: "DAY",
};

const BY_ARABIC_NAME: readonly (readonly [string, string])[] = [
  ["قطعة", "EA"], ["عدد", "EA"], ["وحدة", "EA"],
  ["كيلو", "KGM"], ["كجم", "KGM"],
  ["جرام", "GRM"], ["جم", "GRM"],
  ["طن", "TNE"],
  ["لتر", "LTR"], ["مليلتر", "MLT"],
  ["متر مربع", "MTK"], ["متر مكعب", "MTQ"], ["سنتيمتر", "CMT"], ["متر", "MTR"],
  ["كرتونة", "BX"], ["صندوق", "BX"], ["كرتون", "BX"],
  ["علبة", "PK"], ["عبوة", "PK"],
  ["دستة", "DZN"],
  ["طقم", "SET"],
  ["لفة", "ROL"],
  ["ساعة", "HUR"],
  ["يوم", "DAY"],
] as const;

/**
 * Suggest the authority's unit code for one of the tenant's units, by code
 * first and Arabic name second. Returns null when nothing matches — a guess
 * the user has to confirm is worse than an empty cell.
 */
export function suggestEtaUnitCode(unitCode: string, unitNameAr: string): string | null {
  const byCode = BY_TENANT_CODE[unitCode.trim().toUpperCase()];
  if (byCode) return byCode;
  const name = unitNameAr.trim();
  for (const [needle, code] of BY_ARABIC_NAME) {
    if (name.includes(needle)) return code;
  }
  return null;
}

export function isEtaUnitCode(code: string): boolean {
  return ETA_UNIT_CODES.some((u) => u.code === code);
}
