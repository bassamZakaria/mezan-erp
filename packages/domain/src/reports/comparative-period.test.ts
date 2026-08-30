import { describe, it, expect } from "vitest";
import { COMPARISON_LABEL_AR, comparativeRange } from "./comparative-period.js";

describe("comparativeRange — previous", () => {
  it("returns the equal-length window ending the day before the current one starts", () => {
    expect(comparativeRange({ from: "2026-03-01", to: "2026-03-10" }, "previous")).toEqual({
      from: "2026-02-19",
      to: "2026-02-28",
    });
  });

  it("keeps the window at exactly one day for a one-day current range", () => {
    expect(comparativeRange({ from: "2026-03-01", to: "2026-03-01" }, "previous")).toEqual({
      from: "2026-02-28",
      to: "2026-02-28",
    });
  });

  it("crosses a year boundary correctly", () => {
    expect(comparativeRange({ from: "2026-01-01", to: "2026-01-05" }, "previous")).toEqual({
      from: "2025-12-27",
      to: "2025-12-31",
    });
  });
});

describe("comparativeRange — lastYear", () => {
  it("returns the same month/day one calendar year earlier", () => {
    expect(comparativeRange({ from: "2026-03-01", to: "2026-03-31" }, "lastYear")).toEqual({
      from: "2025-03-01",
      to: "2025-03-31",
    });
  });

  it("clamps 29 Feb to the prior year's last day of February when that year is not a leap year", () => {
    // 2028 is a leap year (29 Feb exists); 2027 is not, so it clamps to 28 Feb rather than rolling into March.
    expect(comparativeRange({ from: "2028-02-29", to: "2028-02-29" }, "lastYear")).toEqual({
      from: "2027-02-28",
      to: "2027-02-28",
    });
  });

  it("clamps for a run FROM a leap-year 29 Feb TO a non-leap prior year", () => {
    expect(comparativeRange({ from: "2024-02-29", to: "2024-02-29" }, "lastYear")).toEqual({
      from: "2023-02-28",
      to: "2023-02-28",
    });
  });
});

describe("COMPARISON_LABEL_AR", () => {
  it("carries the exact Arabic labels for both comparison modes", () => {
    expect(COMPARISON_LABEL_AR).toEqual({
      previous: "الفترة السابقة",
      lastYear: "نفس الفترة من العام الماضي",
    });
  });
});
