import { describe, it, expect } from "vitest";
import { Money } from "../../money/index.js";
import {
  addMonthsToDate,
  isEarlyRelease,
  nextRetentionEvent,
  releaseCapOf,
  releaseEventDateOf,
  retentionPayablePositionOf,
  retentionPositionOf,
} from "./retention-math.js";

const m = (v: string) => Money.fromMajor(v);

describe("retention position", () => {
  it("reads the receivable side as debits less credits", () => {
    const position = retentionPositionOf(m("53269.90"), m("5000"));
    expect(position.held.toString()).toBe("53269.900000");
    expect(position.released.toString()).toBe("5000.000000");
    expect(position.balance.toString()).toBe("48269.900000");
  });

  it("reads the payable side the other way round — a subcontractor's retention is a credit", () => {
    const position = retentionPayablePositionOf(m("2000"), m("9000"));
    expect(position.held.toString()).toBe("9000.000000");
    expect(position.released.toString()).toBe("2000.000000");
    expect(position.balance.toString()).toBe("7000.000000");
  });
});

describe("the release event", () => {
  const contract = {
    provisionalHandoverDate: "2027-03-31",
    finalHandoverDate: "2027-09-30",
    defectsLiabilityMonths: 12,
  };

  it("is the provisional handover for the first tranche", () => {
    expect(releaseEventDateOf("provisional", contract)).toBe("2027-03-31");
  });

  it("is the final handover plus فترة الضمان for the last", () => {
    expect(releaseEventDateOf("final", contract)).toBe("2028-09-30");
  });

  it("is unknown — not today — when the handover has not been recorded", () => {
    expect(releaseEventDateOf("final", { ...contract, finalHandoverDate: null })).toBeNull();
    expect(releaseEventDateOf("other", contract)).toBeNull();
  });

  it("keeps month arithmetic on the calendar, never on 30-day blocks", () => {
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2026-12-15", 12)).toBe("2027-12-15");
  });

  it("flags a release dated before its event and only then", () => {
    expect(isEarlyRelease("2026-09-01", "2027-03-31")).toBe(true);
    expect(isEarlyRelease("2027-03-31", "2027-03-31")).toBe(false);
    expect(isEarlyRelease("2026-09-01", null)).toBe(false);
  });
});

describe("the release cap", () => {
  const position = retentionPositionOf(m("100000"), m("0"));

  it("caps the provisional tranche at its percentage of what was HELD", () => {
    const cap = releaseCapOf({
      kind: "provisional",
      position,
      provisionalReleasePercent: "50",
      provisionalReleasedToDate: Money.zero(),
    });
    expect(cap.toString()).toBe("50000.000000");
  });

  it("treats the percentage as a cumulative ceiling, not a per-document allowance", () => {
    const cap = releaseCapOf({
      kind: "provisional",
      position: retentionPositionOf(m("100000"), m("40000")),
      provisionalReleasePercent: "50",
      provisionalReleasedToDate: m("40000"),
    });
    expect(cap.toString()).toBe("10000.000000");
  });

  it("never exceeds the remaining balance", () => {
    const cap = releaseCapOf({
      kind: "provisional",
      position: retentionPositionOf(m("100000"), m("95000")),
      provisionalReleasePercent: "50",
      provisionalReleasedToDate: Money.zero(),
    });
    expect(cap.toString()).toBe("5000.000000");
  });

  it("lets the final tranche take the whole balance", () => {
    const cap = releaseCapOf({
      kind: "final",
      position: retentionPositionOf(m("100000"), m("50000")),
      provisionalReleasePercent: "50",
      provisionalReleasedToDate: m("50000"),
    });
    expect(cap.toString()).toBe("50000.000000");
  });
});

describe("the retention calendar's ageing", () => {
  const base = {
    provisionalHandoverDate: "2027-03-31",
    finalHandoverDate: null,
    defectsLiabilityMonths: 12,
    position: retentionPositionOf(m("53269.90"), m("0")),
    provisionalReleasePercent: "50",
    provisionalReleasedToDate: Money.zero(),
  };

  it("counts down to the event and does not age before it", () => {
    const event = nextRetentionEvent({ ...base, asOfDate: "2026-09-13" });
    expect(event.kind).toBe("provisional");
    expect(event.date).toBe("2027-03-31");
    expect(event.daysToEvent).toBe(199);
    expect(event.due).toBe(false);
    expect(event.ageDays).toBeNull();
  });

  it("ages from the RELEASE date once the event has passed — never from the certificate", () => {
    const event = nextRetentionEvent({ ...base, asOfDate: "2027-05-30" });
    expect(event.due).toBe(true);
    expect(event.ageDays).toBe(60);
  });

  it("moves to the final tranche once the provisional ceiling is exhausted", () => {
    const event = nextRetentionEvent({
      ...base,
      finalHandoverDate: "2027-09-30",
      position: retentionPositionOf(m("100000"), m("50000")),
      provisionalReleasedToDate: m("50000"),
      asOfDate: "2027-06-01",
    });
    expect(event.kind).toBe("final");
    expect(event.date).toBe("2028-09-30");
  });

  it("names no event at all when nothing is held and nothing is due", () => {
    const event = nextRetentionEvent({
      ...base,
      position: retentionPositionOf(m("50000"), m("50000")),
      asOfDate: "2027-06-01",
    });
    expect(event.kind).toBeNull();
    expect(event.due).toBe(false);
  });

  it("says the event is unknown rather than guessing one when no handover is recorded", () => {
    const event = nextRetentionEvent({ ...base, provisionalHandoverDate: null, asOfDate: "2026-09-13" });
    expect(event.date).toBeNull();
    expect(event.due).toBe(false);
  });
});
