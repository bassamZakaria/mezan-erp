/**
 * The API carries percentages as scale-6 decimal strings ("3.750000"). Printed
 * as-is they read as «التأمينات الاجتماعية — 3.750000%» — six decimals nobody
 * asked for. Round to at most two and drop trailing zeros so "5.000000"
 * prints "5" and "3.750000" prints "3.75".
 */
export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toFixed(2).replace(/\.?0+$/, "");
}
