/**
 * Rows out of pasted or uploaded tabular text (R5.8).
 *
 * Excel's "Export as CSV" gives commas; copying a range to the clipboard gives
 * TABS. Both arrive as text through the same paths, so the delimiter is
 * detected per file rather than configured — asking the user which one their
 * clipboard used is a question they cannot answer.
 *
 * Quoted fields are honoured because an Arabic item name may legitimately
 * contain a comma, and a doubled quote inside a quoted field is one quote —
 * that is the CSV convention Excel itself writes.
 */
export function parseDelimited(text: string): string[][] {
  const source = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (source.trim() === "") return [];
  const delimiter = pickDelimiter(source);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  rows.push(row);

  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/** Whichever of tab/comma/semicolon appears on the first non-empty line most. */
function pickDelimiter(source: string): string {
  const line = source.split("\n").find((l) => l.trim() !== "") ?? "";
  const counts = ["\t", ",", ";"].map((d) => [d, line.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ",";
}

/**
 * Arabic-Indic digits reach us whenever the sheet was typed on an Arabic
 * keyboard; the Arabic decimal separator is U+066B. Without this every such
 * quantity parses as NaN and the whole import reads as malformed data.
 */
export function normalizeNumeral(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/٬|,/g, "")
    .trim();
}
