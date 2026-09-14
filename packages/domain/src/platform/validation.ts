export function isCount(n: number, min: number): boolean {
  return Number.isInteger(n) && n >= min;
}

export function isoTimestamp(value: string): string | null {
  if (Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
