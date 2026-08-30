import { describe, expect, it } from "vitest";
import { ETA_ACTIVITY_CODES, findEtaActivityCode, searchEtaActivityCodes } from "./activity-codes.js";

describe("the activity-code table", () => {
  it("carries a distinct code and both labels for every activity", () => {
    const codes = ETA_ACTIVITY_CODES.map((a) => a.code);
    expect(codes.length).toBeGreaterThan(0);
    expect(new Set(codes).size).toBe(codes.length);
    for (const activity of ETA_ACTIVITY_CODES) {
      expect(/^\d{4}$/.test(activity.code)).toBe(true);
      expect(activity.labelAr.trim().length).toBeGreaterThan(0);
      expect(activity.labelEn.trim().length).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(activity.labelAr)).toBe(true);
    }
  });
});

describe("findEtaActivityCode", () => {
  it("finds an activity by its exact code", () => {
    const first = ETA_ACTIVITY_CODES[0];
    expect(findEtaActivityCode(first?.code as string)).toEqual(first);
  });

  it("returns nothing for a code the table does not carry", () => {
    expect(findEtaActivityCode("0000")).toBeNull();
    expect(findEtaActivityCode("")).toBeNull();
    expect(findEtaActivityCode("47")).toBeNull();
  });
});

describe("searchEtaActivityCodes", () => {
  it("returns the whole table for an empty query, up to the limit", () => {
    expect(searchEtaActivityCodes("", 1000)).toHaveLength(ETA_ACTIVITY_CODES.length);
    expect(searchEtaActivityCodes("   ", 1000)).toHaveLength(ETA_ACTIVITY_CODES.length);
  });

  it("honours the limit, and defaults to twenty", () => {
    expect(searchEtaActivityCodes("", 3)).toHaveLength(3);
    expect(searchEtaActivityCodes("").length).toBeLessThanOrEqual(20);
  });

  it("matches on a code prefix, not on a code fragment", () => {
    const sample = ETA_ACTIVITY_CODES[0]?.code as string;
    expect(searchEtaActivityCodes(sample.slice(0, 2)).some((a) => a.code === sample)).toBe(true);
    expect(searchEtaActivityCodes(sample.slice(2)).some((a) => a.code === sample)).toBe(false);
  });

  it("matches an Arabic label the way an operator would type it", () => {
    const withArabic = ETA_ACTIVITY_CODES[0];
    const word = (withArabic?.labelAr ?? "").split(" ")[0] as string;
    expect(searchEtaActivityCodes(word).some((a) => a.code === withArabic?.code)).toBe(true);
  });

  it("matches an English label regardless of case", () => {
    const activity = ETA_ACTIVITY_CODES[0];
    const word = (activity?.labelEn ?? "").split(" ")[0] as string;
    expect(searchEtaActivityCodes(word.toUpperCase()).some((a) => a.code === activity?.code)).toBe(true);
    expect(searchEtaActivityCodes(word.toLowerCase()).some((a) => a.code === activity?.code)).toBe(true);
  });

  it("returns nothing for a query that matches neither a code nor a label", () => {
    expect(searchEtaActivityCodes("zzzzz-not-an-activity")).toEqual([]);
  });

  it("ignores the padding around a query", () => {
    const activity = ETA_ACTIVITY_CODES[0];
    expect(searchEtaActivityCodes(`  ${activity?.code}  `).some((a) => a.code === activity?.code)).toBe(true);
  });
});
