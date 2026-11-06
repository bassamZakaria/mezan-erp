/**
 * شروط الإهلاك — change when an asset starts depreciating, over how long, and
 * to what salvage value.
 *
 * A business moving its history in registers assets on the dates it bought
 * them, but depreciation starts when the asset is ready for use — often a
 * date nobody knows on the day of the import. So the terms stay editable
 * until the books have relied on them, and no longer:
 *
 *   - once any depreciation has posted for the asset, changing the terms
 *     would leave the posted months computed under different terms than the
 *     months still to come; reverse those runs first;
 *   - an open draft run already holds amounts computed under the old terms,
 *     so it must be discarded (or posted) before the terms move.
 */
import { Money } from "../money/index.js";
import type { Asset } from "./asset.js";

export interface DepreciationTermsChange {
  readonly depreciationStartDate?: string;
  readonly usefulLifeMonths?: number;
  readonly salvageValue?: Money;
}

export class AssetDepreciationTermsLockedError extends Error {
  readonly code = "ASSET_DEPRECIATION_TERMS_LOCKED";
  readonly messageEn: string;
  constructor(
    readonly assetCode: string,
    readonly reason: "posted" | "draft",
  ) {
    super(
      reason === "posted"
        ? `لا يمكن تعديل شروط إهلاك الأصل «${assetCode}» بعد ترحيل إهلاك عليه — اعكس قيود الإهلاك المرحّلة أولاً.`
        : `يوجد إهلاك مسودة يشمل الأصل «${assetCode}» — احذف المسودة أو رحّلها قبل تعديل شروط الإهلاك.`,
    );
    this.messageEn =
      reason === "posted"
        ? `The depreciation terms of asset "${assetCode}" cannot change after depreciation has posted on it; reverse the posted runs first.`
        : `A draft depreciation run includes asset "${assetCode}"; discard or post it before changing the depreciation terms.`;
    this.name = "AssetDepreciationTermsLockedError";
  }
}

export class InvalidDepreciationTermsError extends Error {
  readonly code = "INVALID_DEPRECIATION_TERMS";
  readonly messageEn: string;
  constructor(ar: string, en: string) {
    super(ar);
    this.messageEn = en;
    this.name = "InvalidDepreciationTermsError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function updateDepreciationTerms(asset: Asset, change: DepreciationTermsChange, context: { readonly inOpenDraftRun: boolean }): Asset {
  if (asset.accumulatedDepreciation.scaled !== 0n) throw new AssetDepreciationTermsLockedError(asset.code, "posted");
  if (context.inOpenDraftRun) throw new AssetDepreciationTermsLockedError(asset.code, "draft");

  const depreciationStartDate = change.depreciationStartDate ?? asset.depreciationStartDate;
  const usefulLifeMonths = change.usefulLifeMonths ?? asset.usefulLifeMonths;
  const salvageValue = change.salvageValue ?? asset.salvageValue;

  if (!ISO_DATE.test(depreciationStartDate) || Number.isNaN(Date.parse(depreciationStartDate))) {
    throw new InvalidDepreciationTermsError(`تاريخ بدء الإهلاك «${depreciationStartDate}» غير صحيح.`, `The depreciation start date "${depreciationStartDate}" is not a valid date.`);
  }
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0) {
    throw new InvalidDepreciationTermsError("العمر الإنتاجي (بالأشهر) يجب أن يكون عدداً صحيحاً أكبر من صفر.", "The useful life (in months) must be a whole number greater than zero.");
  }
  if (salvageValue.scaled < 0n || salvageValue.scaled > asset.acquisitionCost.scaled) {
    throw new InvalidDepreciationTermsError("القيمة التخريدية يجب أن تكون بين صفر وتكلفة الاقتناء.", "The salvage value must be between zero and the acquisition cost.");
  }
  return { ...asset, depreciationStartDate, usefulLifeMonths, salvageValue: Money.fromScaled(salvageValue.scaled) };
}
