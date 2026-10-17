export enum SequenceGapExplanation {
  CounterAdjusted = "counter_adjusted",
  DraftDeleted = "draft_deleted",
  Unexplained = "unexplained",
}

export enum SequenceNumberAnomaly {
  Duplicate = "duplicate",
  BeyondCounter = "beyond_counter",
}

export enum SequenceSourceCoverage {
  Documents = "documents",
  CounterOnly = "counter_only",
}

export interface SequenceSeriesFormat {
  readonly prefixes: readonly string[];
  readonly suffix: string;
  readonly padLength: number;
}

export interface SequenceCounterState {
  readonly code: string;
  readonly labelAr: string;
  readonly period: number | null;
  readonly scope: string | null;
  readonly branchCode: string | null;
  readonly issued: number;
  readonly format: SequenceSeriesFormat;
  readonly coverage: SequenceSourceCoverage;
}

export interface NumberedDocumentRecord {
  readonly number: string;
  readonly date: string;
  readonly status: string;
  readonly voided: boolean;
  readonly source: string;
}

export interface CounterAdjustment {
  readonly code: string;
  readonly from: number;
  readonly to: number;
  readonly at: string;
  readonly actor: string;
}

export interface DeletedNumber {
  readonly code: string;
  readonly number: string;
  readonly at: string;
  readonly actor: string;
}

export interface SequenceGapWindow {
  readonly from: string;
  readonly to: string;
}

export interface SequenceGapRange {
  readonly first: number;
  readonly last: number;
  readonly count: number;
  readonly firstNumber: string;
  readonly lastNumber: string;
  readonly explanation: SequenceGapExplanation;
  readonly reference: string | null;
  readonly inWindow: boolean;
}

export interface SequenceVoidedNumber {
  readonly number: string;
  readonly date: string;
  readonly status: string;
  readonly source: string;
  readonly inWindow: boolean;
}

export interface SequenceAnomaly {
  readonly kind: SequenceNumberAnomaly;
  readonly number: string;
  readonly occurrences: number;
  readonly sources: readonly string[];
}

export interface SequenceSeriesReport {
  readonly code: string;
  readonly labelAr: string;
  readonly period: number | null;
  readonly scope: string | null;
  readonly series: string;
  readonly coverage: SequenceSourceCoverage;
  readonly issued: number;
  readonly documentsFound: number;
  readonly voidedCount: number;
  readonly missingCount: number;
  readonly unexplainedCount: number;
  readonly gaps: readonly SequenceGapRange[];
  readonly voided: readonly SequenceVoidedNumber[];
  readonly anomalies: readonly SequenceAnomaly[];
}

export interface SequenceGapReport {
  readonly window: SequenceGapWindow;
  readonly series: readonly SequenceSeriesReport[];
  readonly totals: {
    readonly sequences: number;
    readonly issued: number;
    readonly documentsFound: number;
    readonly voided: number;
    readonly missing: number;
    readonly unexplained: number;
    readonly anomalies: number;
  };
}

export interface SequenceGapInput {
  readonly window: SequenceGapWindow;
  readonly counters: readonly SequenceCounterState[];
  readonly documentsByCode: ReadonlyMap<string, readonly NumberedDocumentRecord[]>;
  readonly adjustments: readonly CounterAdjustment[];
  readonly deletions: readonly DeletedNumber[];
}

interface ParsedNumber {
  readonly branch: string;
  readonly value: number;
}

const BRANCHED = /^(?:(.+)-)?(\d+)$/;
const SERIES_PLACEHOLDER = "#";

export function parseSequenceNumber(number: string, format: SequenceSeriesFormat): ParsedNumber | null {
  const trimmed = number.trim();
  const prefix = [...format.prefixes].sort((a, b) => b.length - a.length).find((p) => trimmed.startsWith(p));
  if (prefix === undefined) return null;
  let rest = trimmed.slice(prefix.length);
  if (format.suffix) {
    if (!rest.endsWith(format.suffix)) return null;
    rest = rest.slice(0, rest.length - format.suffix.length);
  }
  const match = BRANCHED.exec(rest);
  if (!match) return null;
  return { branch: match[1] ?? "", value: Number.parseInt(match[2] ?? "", 10) };
}

function formatNumber(counter: SequenceCounterState, value: number): string {
  const branch = counter.branchCode ? `${counter.branchCode}-` : "";
  return `${counter.format.prefixes[0] ?? ""}${branch}${String(value).padStart(counter.format.padLength, "0")}${counter.format.suffix}`;
}

function seriesLabel(counter: SequenceCounterState): string {
  const branch = counter.branchCode ? `${counter.branchCode}-` : "";
  const period = counter.period === null ? "" : ` (${counter.period})`;
  return `${counter.format.prefixes[0] ?? ""}${branch}${SERIES_PLACEHOLDER}${counter.format.suffix}${period}`;
}

function belongsToCounter(counter: SequenceCounterState, doc: NumberedDocumentRecord, parsed: ParsedNumber): boolean {
  if (counter.period !== null && Number.parseInt(doc.date.slice(0, 4), 10) !== counter.period) return false;
  return parsed.branch === (counter.branchCode ?? "");
}

interface Explained {
  readonly first: number;
  readonly last: number;
  readonly explanation: SequenceGapExplanation;
  readonly reference: string | null;
}

function explainRange(first: number, last: number, adjustments: readonly CounterAdjustment[], deleted: ReadonlyMap<number, DeletedNumber>): Explained[] {
  const out: Explained[] = [];
  let cursor = first;
  const sorted = [...adjustments].sort((a, b) => a.from - b.from);
  while (cursor <= last) {
    const adjustment = sorted.find((a) => cursor > a.from && cursor <= a.to);
    if (adjustment) {
      const end = Math.min(last, adjustment.to);
      out.push({ first: cursor, last: end, explanation: SequenceGapExplanation.CounterAdjusted, reference: `${adjustment.at} ${adjustment.actor}` });
      cursor = end + 1;
      continue;
    }
    const removal = deleted.get(cursor);
    if (removal) {
      out.push({ first: cursor, last: cursor, explanation: SequenceGapExplanation.DraftDeleted, reference: `${removal.at} ${removal.actor}` });
      cursor += 1;
      continue;
    }
    const nextAdjustment = sorted.filter((a) => a.from + 1 > cursor).map((a) => a.from + 1);
    const nextDeleted = [...deleted.keys()].filter((n) => n > cursor);
    const stop = Math.min(last, ...nextAdjustment.map((n) => n - 1), ...nextDeleted.map((n) => n - 1));
    out.push({ first: cursor, last: stop, explanation: SequenceGapExplanation.Unexplained, reference: null });
    cursor = stop + 1;
  }
  const merged: Explained[] = [];
  for (const range of out) {
    const previous = merged[merged.length - 1];
    if (previous && previous.explanation === range.explanation && previous.reference === range.reference && previous.last + 1 === range.first) {
      merged[merged.length - 1] = { ...previous, last: range.last };
    } else merged.push(range);
  }
  return merged;
}

function windowBounds(entries: readonly { value: number; date: string }[], window: SequenceGapWindow, issued: number): { low: number; high: number } {
  let before = 0;
  let after = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    if (entry.date < window.from && entry.value > before) before = entry.value;
    if (entry.date > window.to && entry.value < after) after = entry.value;
  }
  return { low: before + 1, high: Number.isFinite(after) ? after - 1 : Math.max(issued, before) };
}

function reportCounter(counter: SequenceCounterState, input: SequenceGapInput): SequenceSeriesReport {
  const documents = input.documentsByCode.get(counter.code) ?? [];
  const entries: { value: number; doc: NumberedDocumentRecord }[] = [];
  for (const doc of documents) {
    const parsed = parseSequenceNumber(doc.number, counter.format);
    if (parsed && belongsToCounter(counter, doc, parsed)) entries.push({ value: parsed.value, doc });
  }
  const byValue = new Map<number, NumberedDocumentRecord[]>();
  for (const entry of entries) byValue.set(entry.value, [...(byValue.get(entry.value) ?? []), entry.doc]);

  const bounds = windowBounds(entries.map((e) => ({ value: e.value, date: e.doc.date.slice(0, 10) })), input.window, counter.issued);
  const inWindow = (first: number, last: number) => last >= bounds.low && first <= bounds.high;

  const anomalies: SequenceAnomaly[] = [];
  for (const [value, docs] of [...byValue].sort((a, b) => a[0] - b[0])) {
    const number = formatNumber(counter, value);
    if (docs.length > 1) anomalies.push({ kind: SequenceNumberAnomaly.Duplicate, number, occurrences: docs.length, sources: [...new Set(docs.map((d) => d.source))] });
    if (value > counter.issued) anomalies.push({ kind: SequenceNumberAnomaly.BeyondCounter, number, occurrences: docs.length, sources: [...new Set(docs.map((d) => d.source))] });
  }

  const voided: SequenceVoidedNumber[] = entries
    .filter((e) => e.doc.voided)
    .sort((a, b) => a.value - b.value)
    .map((e) => ({ number: e.doc.number, date: e.doc.date.slice(0, 10), status: e.doc.status, source: e.doc.source, inWindow: inWindow(e.value, e.value) }));

  const gaps: SequenceGapRange[] = [];
  if (counter.coverage === SequenceSourceCoverage.Documents) {
    const adjustments = input.adjustments.filter((a) => a.code === counter.code);
    const deleted = new Map<number, DeletedNumber>();
    for (const removal of input.deletions) {
      if (removal.code !== counter.code) continue;
      const parsed = parseSequenceNumber(removal.number, counter.format);
      if (parsed && parsed.branch === (counter.branchCode ?? "")) deleted.set(parsed.value, removal);
    }
    const used = [...byValue.keys()].filter((v) => v >= 1 && v <= counter.issued).sort((a, b) => a - b);
    let expected = 1;
    const holes: [number, number][] = [];
    for (const value of used) {
      if (value > expected) holes.push([expected, value - 1]);
      expected = value + 1;
    }
    if (expected <= counter.issued) holes.push([expected, counter.issued]);
    for (const [first, last] of holes) {
      for (const range of explainRange(first, last, adjustments, deleted)) {
        gaps.push({
          first: range.first,
          last: range.last,
          count: range.last - range.first + 1,
          firstNumber: formatNumber(counter, range.first),
          lastNumber: formatNumber(counter, range.last),
          explanation: range.explanation,
          reference: range.reference,
          inWindow: inWindow(range.first, range.last),
        });
      }
    }
  }

  return {
    code: counter.code,
    labelAr: counter.labelAr,
    period: counter.period,
    scope: counter.scope,
    series: seriesLabel(counter),
    coverage: counter.coverage,
    issued: counter.issued,
    documentsFound: entries.length,
    voidedCount: voided.length,
    missingCount: gaps.reduce((n, g) => n + g.count, 0),
    unexplainedCount: gaps.filter((g) => g.explanation === SequenceGapExplanation.Unexplained).reduce((n, g) => n + g.count, 0),
    gaps,
    voided,
    anomalies,
  };
}

/**
 * Issued numbers (the counter's high-water mark) against the documents that
 * carry them. A number at or below the counter with no document is a gap; one
 * whose document is voided is accounted for; one above the counter, or held by
 * two documents, was not issued by the counter at all. Unlike a walk between
 * the lowest and highest numbers found, the counter also exposes the TAIL: the
 * numbers handed out after the last document that still exists.
 */
export function buildSequenceGapReport(input: SequenceGapInput): SequenceGapReport {
  const series = input.counters
    .filter((counter) => counter.issued > 0)
    .map((counter) => reportCounter(counter, input))
    .sort((a, b) => a.code.localeCompare(b.code) || (a.period ?? 0) - (b.period ?? 0) || (a.scope ?? "").localeCompare(b.scope ?? ""));
  return {
    window: input.window,
    series,
    totals: {
      sequences: series.length,
      issued: series.reduce((n, s) => n + s.issued, 0),
      documentsFound: series.reduce((n, s) => n + s.documentsFound, 0),
      voided: series.reduce((n, s) => n + s.voidedCount, 0),
      missing: series.reduce((n, s) => n + s.missingCount, 0),
      unexplained: series.reduce((n, s) => n + s.unexplainedCount, 0),
      anomalies: series.reduce((n, s) => n + s.anomalies.length, 0),
    },
  };
}
