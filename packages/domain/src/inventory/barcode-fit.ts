import type { LabelTemplate } from "./label-template.js";

/**
 * Barcode-fit validation (docs/catalog/03-inventory.md §"طباعة الملصقات"):
 * "الباركود لا يناسب هذا القالب — هذه الأصناف باركودها أطول من أن يطبع بحجم
 * قابل للقراءة على هذا المقاس. اختر قالباً أكبر." Estimates a Code128
 * barcode's printed width from its character count (a fixed per-module width
 * at legible print density, plus the quiet zones + label padding either side)
 * and compares it against the chosen template's printable width — the same
 * check the reference UI runs live as items/templates are picked, without
 * needing to actually rasterize the barcode first.
 */

/** Approximate printed width (mm) per Code128 character at a legible thermal-print density. */
const BARCODE_MM_PER_CHAR = 1.5;
/** Quiet zones (both sides) + the label's own padding, in mm. */
const BARCODE_MARGIN_MM = 6;

export const BARCODE_FIT_ERROR_AR = "الباركود لا يناسب هذا القالب";

export interface BarcodeFitResult {
  readonly fits: boolean;
  /** Estimated printed width of the barcode alone, in mm. */
  readonly requiredWidthMm: number;
  readonly messageAr: string | null;
}

/** Pure — estimates whether `barcode` prints legibly on `template`. Empty/blank barcodes always fit (nothing to print). */
export function checkBarcodeFit(barcode: string, template: LabelTemplate): BarcodeFitResult {
  const trimmed = barcode.trim();
  if (trimmed === "") {
    return { fits: true, requiredWidthMm: 0, messageAr: null };
  }
  const requiredWidthMm = trimmed.length * BARCODE_MM_PER_CHAR + BARCODE_MARGIN_MM;
  const fits = requiredWidthMm <= template.widthMm;
  return { fits, requiredWidthMm, messageAr: fits ? null : BARCODE_FIT_ERROR_AR };
}
