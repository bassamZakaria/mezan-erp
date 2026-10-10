import { describe, expect, it } from "vitest";
import { PeriodCloseBlockedError, PeriodCloseDecision, PeriodCloseOverrideNotPermittedError, decidePeriodClose } from "./gate.js";
import { findSequenceGapsInWindow, SequenceSpanTooWideError } from "./sequence-gaps.js";
import { PeriodCloseCheckCode } from "./types.js";

const BLOCKING = [PeriodCloseCheckCode.Drafts, PeriodCloseCheckCode.BankStatements];
const REASON = "اعتماد المدير المالي لإقفال مبكر";

describe("decidePeriodClose", () => {
  it("allows a clear period, with or without a reason, whoever asks", () => {
    for (const canOverride of [true, false]) {
      expect(decidePeriodClose({ blocking: [], overrideReason: null, canOverride })).toBe(PeriodCloseDecision.Allowed);
      expect(decidePeriodClose({ blocking: [], overrideReason: REASON, canOverride })).toBe(PeriodCloseDecision.Allowed);
    }
  });

  it("blocks a failing period when no reason is given — holding the permission is not itself an override", () => {
    expect(decidePeriodClose({ blocking: BLOCKING, overrideReason: null, canOverride: true })).toBe(PeriodCloseDecision.Blocked);
    expect(decidePeriodClose({ blocking: BLOCKING, overrideReason: null, canOverride: false })).toBe(PeriodCloseDecision.Blocked);
  });

  it("a reason overrides only for a caller who holds the override permission", () => {
    expect(decidePeriodClose({ blocking: BLOCKING, overrideReason: REASON, canOverride: true })).toBe(PeriodCloseDecision.Overridden);
    expect(decidePeriodClose({ blocking: BLOCKING, overrideReason: REASON, canOverride: false })).toBe(PeriodCloseDecision.OverrideNotPermitted);
  });

  it("both refusals speak Arabic first and carry an English twin", () => {
    for (const error of [new PeriodCloseBlockedError("fp-2026-06", BLOCKING), new PeriodCloseOverrideNotPermittedError("fp-2026-06", BLOCKING)]) {
      expect(error.message).toMatch(/[؀-ۿ]/);
      expect(error.messageEn).toMatch(/^[\x20-\x7E“”]+$/);
      expect(error.blocking).toEqual(BLOCKING);
    }
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
