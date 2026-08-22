export type ClassValue = string | number | null | undefined | false | ClassValue[];

function flatten(value: ClassValue, out: string[]): void {
  if (!value && value !== 0) return;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out);
    return;
  }
  out.push(String(value));
}

/** Minimal `clsx`-style class name joiner — no dependency needed for this. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const value of values) flatten(value, out);
  return out.join(" ");
}
