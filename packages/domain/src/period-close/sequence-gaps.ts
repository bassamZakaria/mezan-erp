import type { PeriodCloseWindow } from "./types.js";

export interface NumberedDocument {
  readonly number: string;
  readonly date: string;
}

export interface SeriesGap {
  readonly series: string;
  readonly missing: readonly string[];
}

const NUMBER_PATTERN = /^(.*?)(\d+)(\D*)$/;
const MAX_SPAN = 1_000_000;
const SERIES_PLACEHOLDER = "#";

interface SeriesBucket {
  readonly prefix: string;
  readonly suffix: string;
  width: number;
  readonly used: Set<number>;
  readonly inWindow: number[];
  readonly before: number[];
}

export interface ParsedDocumentNumber {
  readonly prefix: string;
  readonly value: number;
  readonly width: number;
  readonly suffix: string;
}

export function parseDocumentNumber(number: string): ParsedDocumentNumber | null {
  const match = NUMBER_PATTERN.exec(number.trim());
  if (!match) return null;
  const digits = match[2] ?? "";
  return { prefix: match[1] ?? "", value: Number.parseInt(digits, 10), width: digits.length, suffix: match[3] ?? "" };
}

export interface SeriesRange {
  readonly prefix: string;
  readonly suffix: string;
  readonly low: number;
  readonly high: number;
}

export function seriesRangesInWindow(documents: readonly NumberedDocument[], window: Pick<PeriodCloseWindow, "startDate" | "endDate">): SeriesRange[] {
  const ranges = new Map<string, { prefix: string; suffix: string; low: number; high: number }>();
  for (const doc of documents) {
    if (doc.date < window.startDate || doc.date > window.endDate) continue;
    const parsed = parseDocumentNumber(doc.number);
    if (!parsed) continue;
    const key = JSON.stringify([parsed.prefix, parsed.suffix]);
    const range = ranges.get(key);
    if (!range) ranges.set(key, { prefix: parsed.prefix, suffix: parsed.suffix, low: parsed.value, high: parsed.value });
    else {
      if (parsed.value < range.low) range.low = parsed.value;
      if (parsed.value > range.high) range.high = parsed.value;
    }
  }
  return [...ranges.values()];
}

export class SequenceSpanTooWideError extends Error {
  readonly code = "SEQUENCE_SPAN_TOO_WIDE";
  constructor(
    readonly series: string,
    readonly span: number,
  ) {
    super(`Series "${series}" spans ${span} numbers inside one period; its gaps cannot be enumerated.`);
    this.name = "SequenceSpanTooWideError";
  }
}

export function findSequenceGapsInWindow(documents: readonly NumberedDocument[], window: Pick<PeriodCloseWindow, "startDate" | "endDate">): SeriesGap[] {
  const buckets = new Map<string, SeriesBucket>();
  for (const doc of documents) {
    const parsed = parseDocumentNumber(doc.number);
    if (!parsed) continue;
    const { prefix, suffix, value, width } = parsed;
    const key = JSON.stringify([prefix, suffix]);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { prefix, suffix, width, used: new Set(), inWindow: [], before: [] };
      buckets.set(key, bucket);
    }
    bucket.width = Math.min(bucket.width, width);
    bucket.used.add(value);
    if (doc.date >= window.startDate && doc.date <= window.endDate) bucket.inWindow.push(value);
    else if (doc.date < window.startDate) bucket.before.push(value);
  }

  const gaps: SeriesGap[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.inWindow.length === 0) continue;
    let low = bucket.inWindow[0] ?? 0;
    let high = low;
    let previous: number | null = null;
    for (const value of bucket.inWindow) {
      if (value < low) low = value;
      if (value > high) high = value;
    }
    for (const value of bucket.before) {
      if (value < low && (previous === null || value > previous)) previous = value;
    }
    if (previous !== null) low = previous;
    const series = `${bucket.prefix}${SERIES_PLACEHOLDER}${bucket.suffix}`;
    if (high - low > MAX_SPAN) throw new SequenceSpanTooWideError(series, high - low);
    const missing: string[] = [];
    for (let n = low + 1; n < high; n += 1) {
      if (!bucket.used.has(n)) missing.push(`${bucket.prefix}${String(n).padStart(bucket.width, "0")}${bucket.suffix}`);
    }
    if (missing.length > 0) gaps.push({ series, missing });
  }
  return gaps.sort((a, b) => a.series.localeCompare(b.series));
}
