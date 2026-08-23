/**
 * Minimal RFC-4180-ish CSV parser for the data-migration wizard's
 * upload/paste step. Handles quoted fields (embedded commas, newlines,
 * escaped `""`), CRLF/LF line endings, and a header row. No external
 * dependency — this repo has no CSV library and the shape is small enough
 * not to warrant one.
 */
export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    pushField();
    if (row.some((f) => f.trim() !== "")) rows.push(row);
    row = [];
  }

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== "" || row.length > 0) pushRow();

  const [headerRow, ...dataRows] = rows;
  return { headers: headerRow ?? [], rows: dataRows };
}

/** Loose header→field-key auto-match: normalizes both sides (lowercase, strip spaces/underscores) and compares. */
export function guessColumnIndex(headers: readonly string[], candidates: readonly string[]): number {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const normalizedHeaders = headers.map(normalize);
  for (const candidate of candidates) {
    const target = normalize(candidate);
    const idx = normalizedHeaders.findIndex((h) => h === target);
    if (idx !== -1) return idx;
  }
  return -1;
}
