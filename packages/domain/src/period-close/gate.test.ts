import { describe, expect, it } from "vitest";
import {
  PeriodCloseBlockedError,
  PeriodCloseChecksUnavailableError,
  PeriodCloseContendedError,
  PeriodCloseDecision,
  PeriodCloseErrorCode,
  PeriodCloseOverrideNotPermittedError,
  PeriodCloseUnauditableError,
  PeriodLockOverrideSameUserError,
  decidePeriodClose,
  lockedUnderSingleOperatorWaiver,
} from "./gate.js";
import { findSequenceGapsInWindow, seriesRangesInWindow, SequenceSpanTooWideError } from "./sequence-gaps.js";
import { PeriodCloseAction, PeriodCloseCheckCode } from "./types.js";

const JUNE_PERIOD = { id: "fp-2026-06", year: 2026, periodNumber: 6 };
const BLOCKING = [PeriodCloseCheckCode.Drafts, PeriodCloseCheckCode.BankStatements];
const REASON = "اعتماد المدير المالي لإقفال مبكر";

const CLOSE = { action: PeriodCloseAction.Close, actor: "U-1", closedBy: null, singleOperatorMode: false, wildcardAdmin: false } as const;
const LOCK = { action: PeriodCloseAction.Lock, actor: "U-1", singleOperatorMode: false, wildcardAdmin: false } as const;

describe("decidePeriodClose", () => {
  it("allows a clear period, with or without a reason, whoever asks", () => {
    for (const canOverride of [true, false]) {
      expect(decidePeriodClose({ ...CLOSE, blocking: [], overrideReason: null, canOverride })).toBe(PeriodCloseDecision.Allowed);
      expect(decidePeriodClose({ ...CLOSE, blocking: [], overrideReason: REASON, canOverride })).toBe(PeriodCloseDecision.Allowed);
      expect(decidePeriodClose({ ...LOCK, closedBy: "U-1", blocking: [], overrideReason: null, canOverride })).toBe(PeriodCloseDecision.Allowed);
    }
  });

  it("blocks a failing period when no reason is given — holding the permission is not itself an override", () => {
    expect(decidePeriodClose({ ...CLOSE, blocking: BLOCKING, overrideReason: null, canOverride: true })).toBe(PeriodCloseDecision.Blocked);
    expect(decidePeriodClose({ ...CLOSE, blocking: BLOCKING, overrideReason: null, canOverride: false })).toBe(PeriodCloseDecision.Blocked);
  });

  it("a reason overrides a CLOSE only for a caller who holds the override permission, and one person is enough", () => {
    expect(decidePeriodClose({ ...CLOSE, blocking: BLOCKING, overrideReason: REASON, canOverride: true })).toBe(PeriodCloseDecision.Overridden);
    expect(decidePeriodClose({ ...CLOSE, blocking: BLOCKING, overrideReason: REASON, canOverride: false })).toBe(PeriodCloseDecision.OverrideNotPermitted);
  });

  it("overriding a LOCK takes a different user from the one who closed the period", () => {
    const override = { ...LOCK, blocking: BLOCKING, overrideReason: REASON, canOverride: true };
    expect(decidePeriodClose({ ...override, closedBy: "U-1" })).toBe(PeriodCloseDecision.LockOverrideNeedsSecondPerson);
    expect(decidePeriodClose({ ...override, closedBy: "U-2" })).toBe(PeriodCloseDecision.Overridden);
    expect(decidePeriodClose({ ...override, closedBy: "U-1", canOverride: false })).toBe(PeriodCloseDecision.OverrideNotPermitted);
  });

  it("a period nobody is on record as closing can be locked over a failing check, but only with a permitted override reason", () => {
    const unknownCloser = { ...LOCK, blocking: BLOCKING, closedBy: null };
    expect(decidePeriodClose({ ...unknownCloser, overrideReason: REASON, canOverride: true })).toBe(PeriodCloseDecision.Overridden);
    expect(decidePeriodClose({ ...unknownCloser, overrideReason: null, canOverride: true })).toBe(PeriodCloseDecision.Blocked);
    expect(decidePeriodClose({ ...unknownCloser, overrideReason: REASON, canOverride: false })).toBe(PeriodCloseDecision.OverrideNotPermitted);
    expect(lockedUnderSingleOperatorWaiver({ ...unknownCloser, overrideReason: REASON, canOverride: true, singleOperatorMode: true, wildcardAdmin: true })).toBe(false);
  });

  it("the single-operator switch lets the closer lock over a failing check only when the closer is the wildcard admin", () => {
    const override = { ...LOCK, blocking: BLOCKING, overrideReason: REASON, canOverride: true, closedBy: "U-1" };
    expect(decidePeriodClose({ ...override, singleOperatorMode: true, wildcardAdmin: true })).toBe(PeriodCloseDecision.Overridden);
    expect(decidePeriodClose({ ...override, singleOperatorMode: true, wildcardAdmin: false })).toBe(PeriodCloseDecision.LockOverrideNeedsSecondPerson);
    expect(decidePeriodClose({ ...override, singleOperatorMode: false, wildcardAdmin: true })).toBe(PeriodCloseDecision.LockOverrideNeedsSecondPerson);
    expect(decidePeriodClose({ ...override, singleOperatorMode: true, wildcardAdmin: true, canOverride: false })).toBe(PeriodCloseDecision.OverrideNotPermitted);
  });

  it("names the single-operator waiver only when it is what let the lock through", () => {
    const override = { ...LOCK, blocking: BLOCKING, overrideReason: REASON, canOverride: true, singleOperatorMode: true, wildcardAdmin: true };
    expect(lockedUnderSingleOperatorWaiver({ ...override, closedBy: "U-1" })).toBe(true);
    expect(lockedUnderSingleOperatorWaiver({ ...override, closedBy: "U-2" })).toBe(false);
    expect(lockedUnderSingleOperatorWaiver({ ...override, closedBy: "U-1", blocking: [] })).toBe(false);
    expect(lockedUnderSingleOperatorWaiver({ ...override, closedBy: "U-1", action: PeriodCloseAction.Close })).toBe(false);
  });

  it("every refusal speaks Arabic first, carries an English twin and a stable code", () => {
    const refusals = [
      new PeriodCloseBlockedError(JUNE_PERIOD, BLOCKING),
      new PeriodCloseOverrideNotPermittedError(JUNE_PERIOD, BLOCKING),
      new PeriodLockOverrideSameUserError(JUNE_PERIOD, BLOCKING),
      new PeriodCloseChecksUnavailableError(JUNE_PERIOD),
      new PeriodCloseUnauditableError(JUNE_PERIOD),
      new PeriodCloseContendedError(JUNE_PERIOD),
    ];
    for (const error of refusals) {
      expect(error.message).toMatch(/[\u0600-\u06FF]/);
      expect(error.messageEn).toMatch(/^[\x20-\x7E“”]+$/);
      expect(error.message).toContain("«يونيو 2026»");
      expect(error.messageEn).toContain("June 2026");
      expect(`${error.message} ${error.messageEn}`).not.toContain("fp-2026-06");
      expect(error.periodId).toBe("fp-2026-06");
    }
    expect(new Set(refusals.map((e) => e.code)).size).toBe(refusals.length);
    expect(refusals.map((e) => e.code).sort()).toEqual(Object.values(PeriodCloseErrorCode).sort());
  });
});

describe("findSequenceGapsInWindow — the boundary between two months", () => {
  const FEBRUARY = { startDate: "2026-02-01", endDate: "2026-02-28" };
  const documents = [
    { number: "INV-0009", date: "2026-01-20" },
    { number: "INV-0010", date: "2026-01-31" },
    { number: "INV-0013", date: "2026-02-02" },
    { number: "INV-0014", date: "2026-02-11" },
  ];

  it("anchors on the last number dated before the month, so numbers skipped at the boundary belong to the month that follows", () => {
    expect(findSequenceGapsInWindow(documents, FEBRUARY)).toEqual([{ series: "INV-#", missing: ["INV-0011", "INV-0012"] }]);
    expect(findSequenceGapsInWindow(documents, { startDate: "2026-01-01", endDate: "2026-01-31" })).toEqual([]);
  });

  it("is not a gap when the skipped numbers exist with any other date", () => {
    const filled = [...documents, { number: "INV-0011", date: "2026-03-01" }, { number: "INV-0012", date: "2026-01-05" }];
    expect(findSequenceGapsInWindow(filled, FEBRUARY)).toEqual([]);
  });

  it("ignores an earlier-dated document numbered above the month's first — that is back-dating, not the previous number", () => {
    const backdated = [{ number: "INV-0050", date: "2026-01-10" }, { number: "INV-0013", date: "2026-02-02" }, { number: "INV-0014", date: "2026-02-11" }];
    expect(findSequenceGapsInWindow(backdated, FEBRUARY)).toEqual([]);
  });

  it("names the anchor a store has to fetch: the series' range in the month", () => {
    expect(seriesRangesInWindow(documents, FEBRUARY)).toEqual([{ prefix: "INV-", suffix: "", low: 13, high: 14 }]);
  });
});

describe("findSequenceGapsInWindow", () => {
  const JUNE = { startDate: "2026-06-01", endDate: "2026-06-30" };

  it("reports the numbers missing between the period's lowest and highest", () => {
    const gaps = findSequenceGapsInWindow(
      [
        { number: "INV-0007", date: "2026-06-02" },
        { number: "INV-0008", date: "2026-06-03" },
        { number: "INV-0011", date: "2026-06-20" },
      ],
      JUNE,
    );
    expect(gaps).toEqual([{ series: "INV-#", missing: ["INV-0009", "INV-0010"] }]);
  });

  it("does not call a number a gap when a document dated in another month holds it", () => {
    const gaps = findSequenceGapsInWindow(
      [
        { number: "JE-000010", date: "2026-06-01" },
        { number: "JE-000011", date: "2026-07-04" },
        { number: "JE-000012", date: "2026-06-30" },
      ],
      JUNE,
    );
    expect(gaps).toEqual([]);
  });

  it("keeps series with different prefixes or suffixes apart, and ignores a series with nothing in the period", () => {
    const gaps = findSequenceGapsInWindow(
      [
        { number: "RV-001", date: "2026-06-05" },
        { number: "RV-003", date: "2026-06-06" },
        { number: "PV-001", date: "2026-06-05" },
        { number: "PV-002", date: "2026-06-06" },
        { number: "SO-001/A", date: "2026-05-01" },
        { number: "SO-009/A", date: "2026-05-02" },
      ],
      JUNE,
    );
    expect(gaps).toEqual([{ series: "RV-#", missing: ["RV-002"] }]);
  });

  it("reads numbers as numbers: a series that outgrows its padding has no gap where the next number is dated in another month", () => {
    const gaps = findSequenceGapsInWindow(
      [
        { number: "INV-9999", date: "2026-06-29" },
        { number: "INV-10000", date: "2026-07-01" },
        { number: "INV-10001", date: "2026-06-30" },
      ],
      JUNE,
    );
    expect(gaps).toEqual([]);
    expect(seriesRangesInWindow([{ number: "INV-9999", date: "2026-06-29" }, { number: "INV-10001", date: "2026-06-30" }], JUNE)).toEqual([
      { prefix: "INV-", suffix: "", low: 9999, high: 10001 },
    ]);
  });

  it("refuses to guess when one period spans more numbers than it can enumerate", () => {
    expect(() =>
      findSequenceGapsInWindow(
        [
          { number: "JE-0000001", date: "2026-06-01" },
          { number: "JE-5000000", date: "2026-06-02" },
        ],
        JUNE,
      ),
    ).toThrow(SequenceSpanTooWideError);
  });
});
