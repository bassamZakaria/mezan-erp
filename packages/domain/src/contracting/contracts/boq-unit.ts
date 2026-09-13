/**
 * وحدات جدول الكميات — a STORED enum, never free text
 * (docs/archive/contracting/02-terminology.md §"Units and the numeric grid":
 * free text gives you «طن»، «طن.» and «طن » as three different units). The
 * Arabic label is one atomic string and is never composed from fragments at
 * render time — «م.ط» with its internal period inside a mixed run is the
 * classic bidi failure.
 */

export type BoqUnit =
  | "m"
  | "m2"
  | "m3"
  | "linear_m"
  | "ton"
  | "kg"
  | "piece"
  | "lump_sum"
  | "day"
  | "hour"
  | "bag"
  | "litre"
  | "set";

export interface BoqUnitDefinition {
  readonly code: BoqUnit;
  readonly labelAr: string;
  readonly labelEn: string;
}

export const BOQ_UNIT_DEFINITIONS: readonly BoqUnitDefinition[] = [
  { code: "m", labelAr: "م", labelEn: "m" },
  { code: "m2", labelAr: "م٢", labelEn: "m²" },
  { code: "m3", labelAr: "م٣", labelEn: "m³" },
  { code: "linear_m", labelAr: "م.ط", labelEn: "linear m" },
  { code: "ton", labelAr: "طن", labelEn: "ton" },
  { code: "kg", labelAr: "كجم", labelEn: "kg" },
  { code: "piece", labelAr: "عدد", labelEn: "piece" },
  { code: "lump_sum", labelAr: "مقطوعية", labelEn: "lump sum" },
  { code: "day", labelAr: "يوم", labelEn: "day" },
  { code: "hour", labelAr: "ساعة", labelEn: "hour" },
  { code: "bag", labelAr: "شيكارة", labelEn: "bag" },
  { code: "litre", labelAr: "لتر", labelEn: "litre" },
  { code: "set", labelAr: "طقم", labelEn: "set" },
] as const;

export const BOQ_UNITS: readonly BoqUnit[] = BOQ_UNIT_DEFINITIONS.map((d) => d.code);

export function isBoqUnit(value: unknown): value is BoqUnit {
  return typeof value === "string" && (BOQ_UNITS as readonly string[]).includes(value);
}

export function getBoqUnitLabel(code: BoqUnit): string {
  return BOQ_UNIT_DEFINITIONS.find((d) => d.code === code)?.labelAr ?? code;
}

/**
 * Resolves an imported cell to a stored unit: the enum code, the Arabic label,
 * or the English label. An Excel sheet written by a quantity surveyor carries
 * «م٣», not "m3", and the import must not silently invent a unit for it.
 */
export function parseBoqUnit(value: string): BoqUnit | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const normalised = trimmed.toLowerCase();
  const match = BOQ_UNIT_DEFINITIONS.find(
    (d) =>
      d.code === normalised ||
      d.labelAr === trimmed ||
      d.labelEn.toLowerCase() === normalised,
  );
  return match?.code ?? null;
}
