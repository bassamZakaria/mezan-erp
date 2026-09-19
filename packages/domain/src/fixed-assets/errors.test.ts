import { describe, expect, it } from "vitest";
import {
  AssetCategoryNotFoundError,
  AssetNotFoundError,
  DepreciationRunNotDraftError,
  DepreciationRunNotFoundError,
  DepreciationRunNotPostedError,
  DuplicateAssetCategoryCodeError,
  DuplicateAssetCodeError,
  DuplicateDepreciationPeriodError,
  InvalidAssetCategoryError,
  InvalidAssetError,
  LaterDepreciationRunExistsError,
  NoDepreciableAssetsError,
} from "./errors.js";

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

/** guards D280 — every fixed-assets refusal reaches the Arabic UI in Arabic. */
describe("fixed-assets errors are bilingual (D280)", () => {
  const cases: readonly [string, Error & { code: string; messageEn: string }][] = [
    ["DuplicateAssetCategoryCodeError", new DuplicateAssetCategoryCodeError("CAT-1")],
    ["InvalidAssetCategoryError", new InvalidAssetCategoryError(["العمر الإنتاجي يجب أن يكون أكبر من صفر"])],
    ["AssetCategoryNotFoundError", new AssetCategoryNotFoundError("CAT-1")],
    ["DuplicateAssetCodeError", new DuplicateAssetCodeError("FA-1")],
    ["InvalidAssetError", new InvalidAssetError(["الأصول ذات النطاق (فرع) تتطلب تحديد الفرع"])],
    ["AssetNotFoundError", new AssetNotFoundError("FA-1")],
    ["DepreciationRunNotFoundError", new DepreciationRunNotFoundError("DR-1")],
    ["DepreciationRunNotDraftError", new DepreciationRunNotDraftError("DR-1", "posted")],
    ["DepreciationRunNotPostedError", new DepreciationRunNotPostedError("DR-1", "draft")],
    ["DuplicateDepreciationPeriodError", new DuplicateDepreciationPeriodError("2026-08", "BR-1")],
    ["NoDepreciableAssetsError", new NoDepreciableAssetsError("2026-08")],
    ["LaterDepreciationRunExistsError", new LaterDepreciationRunExistsError("DR-1", "2026-07", "DR-2", "2026-08")],
  ];

  it.each(cases)("%s: an Arabic message with no English words in it, and the English beside it", (_name, error) => {
    expect(error.message).toMatch(ARABIC);
    expect(error.message.replace(/"[^"]*"/g, "")).not.toMatch(LATIN_WORD);
    expect(error.messageEn).toMatch(LATIN_WORD);
    expect(error.code).toMatch(/^[A-Z_]+$/);
  });

  it("names a run's status in Arabic rather than its enum", () => {
    expect(new DepreciationRunNotPostedError("DR-1", "reversed").message).toContain("معكوس");
  });
});
