/**
 * Label Printing (docs/catalog/03-inventory.md §"طباعة الملصقات") — the 3
 * preset label sizes the reference builder offers. This screen is a
 * stateless print builder (the reference catalog notes: "nothing persisted
 * until printed" — no document, no lifecycle), so unlike the rest of
 * Inventory there is no repository/SQLite table here: `LABEL_TEMPLATES` is
 * static reference data and `barcode-fit.ts`/`label-batch.ts` are pure
 * functions the web layer calls directly against live item data (already
 * served by the existing `/items` API).
 */

export type LabelTemplateCode = "THERMAL_40x30" | "SHELF_50x25" | "PRODUCT_100x50";

export interface LabelTemplate {
  readonly code: LabelTemplateCode;
  readonly labelAr: string;
  readonly widthMm: number;
  readonly heightMm: number;
}

export const LABEL_TEMPLATES: readonly LabelTemplate[] = [
  { code: "THERMAL_40x30", labelAr: "ملصق حراري — 40×30mm", widthMm: 40, heightMm: 30 },
  { code: "SHELF_50x25", labelAr: "ملصق رف — 50×25mm", widthMm: 50, heightMm: 25 },
  { code: "PRODUCT_100x50", labelAr: "ملصق منتج — 100×50mm", widthMm: 100, heightMm: 50 },
];

const BY_CODE: ReadonlyMap<LabelTemplateCode, LabelTemplate> = new Map(LABEL_TEMPLATES.map((t) => [t.code, t]));

export function isLabelTemplateCode(code: string): code is LabelTemplateCode {
  return BY_CODE.has(code as LabelTemplateCode);
}

export function getLabelTemplate(code: LabelTemplateCode): LabelTemplate {
  const template = BY_CODE.get(code);
  if (!template) throw new RangeError(`Unknown label template code: "${code}"`);
  return template;
}
