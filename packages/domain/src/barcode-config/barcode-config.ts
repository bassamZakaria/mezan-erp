/**
 * Barcode configuration — tenant-wide settings for how item barcodes work.
 * Not barcode rendering/label printing (a separate concern): this covers the
 * default symbology, whether an item's barcode is assigned automatically or
 * entered manually, and the embedded-barcode parsing rules retail scanners
 * rely on (a scanned code that encodes a price or a weight alongside a short
 * item code — common in Egyptian retail scales/PLU barcodes). Pure domain —
 * no I/O, mirrors `packages/domain/src/customers/customer.ts`'s
 * validate/update shape and `packages/domain/src/inventory/reasons.ts`'s
 * typed-catalog style.
 */

export type BarcodeSymbology = "EAN13" | "EAN8" | "UPC_A" | "CODE128" | "CODE39";

export const BARCODE_SYMBOLOGIES: readonly BarcodeSymbology[] = [
  "EAN13",
  "EAN8",
  "UPC_A",
  "CODE128",
  "CODE39",
];

export type ItemBarcodeMode = "AUTO" | "MANUAL";

export type EmbeddedValueType = "PRICE" | "WEIGHT";

/**
 * One embedded-barcode parsing rule. `prefix` is the digit string a scanned
 * code must start with to be considered for this rule; `totalLength` is the
 * exact scanned-code length the rule applies to. `itemCodeStart` /
 * `valueStart` are 0-based character offsets into the scanned code.
 */
export interface EmbeddedBarcodeRule {
  readonly id: string;
  readonly nameAr: string;
  readonly prefix: string;
  readonly totalLength: number;
  readonly itemCodeStart: number;
  readonly itemCodeLength: number;
  readonly valueStart: number;
  readonly valueLength: number;
  readonly valueType: EmbeddedValueType;
  readonly valueDecimals: number;
  readonly active: boolean;
}

export interface BarcodeConfig {
  readonly defaultSymbology: BarcodeSymbology;
  readonly itemBarcodeMode: ItemBarcodeMode;
  readonly autoGeneratePrefix: string | null;
  readonly embeddedRules: readonly EmbeddedBarcodeRule[];
}

export class InvalidBarcodeConfigError extends Error {
  readonly code = "INVALID_BARCODE_CONFIG";
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join("، "));
    this.name = "InvalidBarcodeConfigError";
  }
}

/** The catalog's default: EAN13, manual entry, no auto-prefix, no embedded rules — nothing is invented beyond what's universal. */
export function createDefaultBarcodeConfig(): BarcodeConfig {
  return {
    defaultSymbology: "EAN13",
    itemBarcodeMode: "MANUAL",
    autoGeneratePrefix: null,
    embeddedRules: [],
  };
}

const DIGITS_ONLY = /^\d+$/;

function validateRule(rule: EmbeddedBarcodeRule, reasons: string[]): void {
  const label = rule.id || rule.nameAr || "قاعدة بدون معرف";
  if (!DIGITS_ONLY.test(rule.prefix)) {
    reasons.push(`قاعدة "${label}": البادئة يجب أن تتكون من أرقام فقط`);
  }
  if (rule.totalLength <= 0) {
    reasons.push(`قاعدة "${label}": الطول الكلي يجب أن يكون أكبر من صفر`);
  }
  if (rule.itemCodeLength <= 0) {
    reasons.push(`قاعدة "${label}": طول كود الصنف يجب أن يكون أكبر من صفر`);
  }
  if (rule.valueLength <= 0) {
    reasons.push(`قاعدة "${label}": طول القيمة يجب أن يكون أكبر من صفر`);
  }
  if (rule.valueDecimals < 0) {
    reasons.push(`قاعدة "${label}": عدد الخانات العشرية لا يمكن أن يكون سالبًا`);
  }
  if (rule.itemCodeStart < rule.prefix.length) {
    reasons.push(`قاعدة "${label}": بداية كود الصنف يجب أن تكون بعد البادئة`);
  }
  if (rule.valueStart < rule.itemCodeStart + rule.itemCodeLength) {
    reasons.push(`قاعدة "${label}": بداية القيمة يجب أن تكون بعد كود الصنف`);
  }
  if (rule.valueStart + rule.valueLength > rule.totalLength) {
    reasons.push(`قاعدة "${label}": القيمة تتجاوز الطول الكلي للباركود`);
  }
  if (rule.prefix.length + rule.itemCodeLength + rule.valueLength > rule.totalLength) {
    reasons.push(`قاعدة "${label}": مجموع أطوال البادئة وكود الصنف والقيمة يتجاوز الطول الكلي`);
  }
}

/** Pure validation — returns Arabic reason strings, reports every violation instead of stopping at the first. */
export function validateBarcodeConfig(config: BarcodeConfig): string[] {
  const reasons: string[] = [];

  if (!BARCODE_SYMBOLOGIES.includes(config.defaultSymbology)) {
    reasons.push("نوع الباركود الافتراضي غير صالح");
  }
  if (
    config.itemBarcodeMode === "AUTO" &&
    config.autoGeneratePrefix != null &&
    !DIGITS_ONLY.test(config.autoGeneratePrefix)
  ) {
    reasons.push("بادئة الترقيم التلقائي يجب أن تتكون من أرقام فقط");
  }

  const seenIds = new Set<string>();
  for (const rule of config.embeddedRules) {
    validateRule(rule, reasons);
    if (seenIds.has(rule.id)) {
      reasons.push(`معرف القاعدة "${rule.id}" مكرر`);
    }
    seenIds.add(rule.id);
  }

  return reasons;
}

/** Merges a patch onto the current config and re-validates, throwing `InvalidBarcodeConfigError` on any violation. */
export function updateBarcodeConfig(current: BarcodeConfig, patch: Partial<BarcodeConfig>): BarcodeConfig {
  const next: BarcodeConfig = { ...current, ...patch };
  const reasons = validateBarcodeConfig(next);
  if (reasons.length > 0) throw new InvalidBarcodeConfigError(reasons);
  return next;
}

export type EmbeddedBarcodeMatch =
  | {
      readonly matched: true;
      readonly ruleId: string;
      readonly itemCode: string;
      readonly value: number;
      readonly valueType: EmbeddedValueType;
    }
  | { readonly matched: false };

/**
 * Parses a scanned barcode against the configured embedded-barcode rules,
 * in array order, considering only `active` rules. Never throws — arbitrary
 * scanner input (wrong length, non-digit characters, no matching rule) just
 * yields `{ matched: false }`.
 */
export function parseEmbeddedBarcode(
  rules: readonly EmbeddedBarcodeRule[],
  scannedCode: string,
): EmbeddedBarcodeMatch {
  if (!DIGITS_ONLY.test(scannedCode)) {
    return { matched: false };
  }

  for (const rule of rules) {
    if (!rule.active) continue;
    if (scannedCode.length !== rule.totalLength) continue;
    if (!scannedCode.startsWith(rule.prefix)) continue;

    const itemCode = scannedCode.slice(rule.itemCodeStart, rule.itemCodeStart + rule.itemCodeLength);
    const valueDigits = scannedCode.slice(rule.valueStart, rule.valueStart + rule.valueLength);
    const intValue = Number.parseInt(valueDigits, 10);
    if (!Number.isFinite(intValue)) continue;

    return {
      matched: true,
      ruleId: rule.id,
      itemCode,
      value: intValue / 10 ** rule.valueDecimals,
      valueType: rule.valueType,
    };
  }

  return { matched: false };
}
