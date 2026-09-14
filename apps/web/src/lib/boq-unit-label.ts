import type { BoqUnitDTO } from "@mezan/contracts";
import type { AppTranslationKey } from "../i18n";

/**
 * One map from the stored BOQ unit code to its i18n key, shared by every
 * screen that shows a unit — a certificate grid rendering the raw code
 * ("m3") instead of «م٣» is the recurring cosmetic defect this closes.
 */
export const BOQ_UNIT_TRANSLATION_KEY: Record<BoqUnitDTO, AppTranslationKey> = {
  m: "boq.unit.m",
  m2: "boq.unit.m2",
  m3: "boq.unit.m3",
  linear_m: "boq.unit.linear_m",
  ton: "boq.unit.ton",
  kg: "boq.unit.kg",
  piece: "boq.unit.piece",
  lump_sum: "boq.unit.lump_sum",
  day: "boq.unit.day",
  hour: "boq.unit.hour",
  bag: "boq.unit.bag",
  litre: "boq.unit.litre",
  set: "boq.unit.set",
};

export const BOQ_UNITS: readonly BoqUnitDTO[] = [
  "m",
  "m2",
  "m3",
  "linear_m",
  "ton",
  "kg",
  "piece",
  "lump_sum",
  "day",
  "hour",
  "bag",
  "litre",
  "set",
];

/** Falls back to the raw stored code for a value the enum doesn't recognise. */
export function unitLabel(unit: string | null | undefined, t: (key: AppTranslationKey) => string): string {
  if (!unit) return "";
  const key = (BOQ_UNIT_TRANSLATION_KEY as Record<string, AppTranslationKey | undefined>)[unit];
  return key ? t(key) : unit;
}
