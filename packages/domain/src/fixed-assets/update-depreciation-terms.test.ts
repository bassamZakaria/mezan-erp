import { describe, expect, it } from "vitest";
import { Money } from "../money/index.js";
import type { Asset } from "./asset.js";
import { AssetDepreciationTermsLockedError, InvalidDepreciationTermsError, updateDepreciationTerms } from "./update-depreciation-terms.js";

const asset = {
  id: "a1",
  code: "VEH-001",
  acquisitionDate: "2026-10-31",
  acquisitionCost: Money.fromMajor("270000"),
  depreciationStartDate: "2026-10-31",
  usefulLifeMonths: 60,
  salvageValue: Money.zero(),
  accumulatedDepreciation: Money.zero(),
} as unknown as Asset;

describe("updateDepreciationTerms", () => {
  it("moves the start date, life and salvage while nothing has posted", () => {
    const next = updateDepreciationTerms(asset, { depreciationStartDate: "2026-11-01", usefulLifeMonths: 120, salvageValue: Money.fromMajor("27000") }, { inOpenDraftRun: false });
    expect([next.depreciationStartDate, next.usefulLifeMonths, next.salvageValue.toString()]).toEqual(["2026-11-01", 120, "27000.000000"]);
  });

  it("keeps the fields it was not given", () => {
    const next = updateDepreciationTerms(asset, { depreciationStartDate: "2027-01-01" }, { inOpenDraftRun: false });
    expect(next.usefulLifeMonths).toBe(60);
  });

  it("refuses once depreciation has posted, and while a draft run holds the asset", () => {
    expect(() => updateDepreciationTerms({ ...asset, accumulatedDepreciation: Money.fromMajor("4500") }, { usefulLifeMonths: 120 }, { inOpenDraftRun: false })).toThrow(AssetDepreciationTermsLockedError);
    expect(() => updateDepreciationTerms(asset, { usefulLifeMonths: 120 }, { inOpenDraftRun: true })).toThrow(AssetDepreciationTermsLockedError);
  });

  it("refuses an impossible date, a non-positive life, and a salvage above cost", () => {
    expect(() => updateDepreciationTerms(asset, { depreciationStartDate: "2026-13-01" }, { inOpenDraftRun: false })).toThrow(InvalidDepreciationTermsError);
    expect(() => updateDepreciationTerms(asset, { usefulLifeMonths: 0 }, { inOpenDraftRun: false })).toThrow(InvalidDepreciationTermsError);
    expect(() => updateDepreciationTerms(asset, { salvageValue: Money.fromMajor("300000") }, { inOpenDraftRun: false })).toThrow(InvalidDepreciationTermsError);
  });
});
