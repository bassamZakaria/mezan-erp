import { Money } from "../money/index.js";
import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";

export const POS_WALK_IN_CUSTOMER_ID = "CUST-POS-WALKIN";
export const POS_WALK_IN_CUSTOMER_CODE = "WALKIN";

export interface PosMealSection {
  readonly id: string;
  readonly name: string;
}

/** A discount ceiling: whichever of the two is reached first needs an approval. */
export interface PosDiscountLimit {
  /** Basis points — 1000 is 10%. Zero disables that discount type at the till. */
  readonly percentBp: number;
  readonly amount: Money;
}

export interface PosSettings {
  readonly receiptScreenSeconds: number;
  readonly allowArCollection: boolean;
  readonly cashierDiscountLimit: PosDiscountLimit;
  readonly managerDiscountLimit: PosDiscountLimit;
  readonly approvalExpiryMinutes: number;
  /** Fixed: the seeded «زبون عابر». A POS sale with no named customer is invoiced to it. */
  readonly walkInCustomerId: string;
  readonly pricesIncludeTax: boolean;
  readonly mealSections: readonly PosMealSection[];
}

export function defaultPosSettings(): PosSettings {
  return {
    receiptScreenSeconds: 30,
    allowArCollection: true,
    cashierDiscountLimit: { percentBp: 1000, amount: Money.fromMajor("50") },
    managerDiscountLimit: { percentBp: 3000, amount: Money.fromMajor("500") },
    approvalExpiryMinutes: 5,
    walkInCustomerId: POS_WALK_IN_CUSTOMER_ID,
    pricesIncludeTax: true,
    mealSections: [],
  };
}

export class InvalidPosSettingsError extends Error {
  readonly code = "INVALID_POS_SETTINGS";
  readonly reasons: readonly string[];
  readonly messageEn: string;
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "The POS settings are invalid.");
    super(split.ar.join("، "));
    this.reasons = split.ar;
    this.messageEn = split.en;
    this.name = "InvalidPosSettingsError";
  }
}

const PERCENT_PATTERN = /^(\d{1,3})(?:\.(\d{1,2}))?$/;

/** "12.5" → 1250. Parsed as digits, never through a float. Null when it is not a 0–100 percentage. */
export function percentBpFromString(value: string): number | null {
  const match = PERCENT_PATTERN.exec(value.trim());
  if (!match) return null;
  const whole = Number.parseInt(match[1] ?? "0", 10);
  const fraction = Number.parseInt(((match[2] ?? "") + "00").slice(0, 2), 10);
  const bp = whole * 100 + fraction;
  return bp > 10000 ? null : bp;
}

export function percentBpToString(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = bp % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

export interface PosSettingsPatch {
  readonly receiptScreenSeconds?: number;
  readonly allowArCollection?: boolean;
  readonly cashierDiscountLimit?: PosDiscountLimit;
  readonly managerDiscountLimit?: PosDiscountLimit;
  readonly approvalExpiryMinutes?: number;
  readonly pricesIncludeTax?: boolean;
  readonly mealSections?: readonly { readonly id?: string | null; readonly name: string }[];
}

function normalizeMealSections(sections: PosSettingsPatch["mealSections"], current: readonly PosMealSection[]): PosMealSection[] {
  if (sections === undefined) return [...current];
  const used = new Set<string>();
  let next = 1;
  const out: PosMealSection[] = [];
  for (const section of sections) {
    let id = section.id?.trim() ?? "";
    if (id === "" || used.has(id)) {
      while (used.has(`MS-${next}`) || sections.some((s) => s.id === `MS-${next}`)) next += 1;
      id = `MS-${next}`;
    }
    used.add(id);
    out.push({ id, name: section.name.trim() });
  }
  return out;
}

export function updatePosSettings(current: PosSettings, patch: PosSettingsPatch): PosSettings {
  const next: PosSettings = {
    ...current,
    receiptScreenSeconds: patch.receiptScreenSeconds ?? current.receiptScreenSeconds,
    allowArCollection: patch.allowArCollection ?? current.allowArCollection,
    cashierDiscountLimit: patch.cashierDiscountLimit ?? current.cashierDiscountLimit,
    managerDiscountLimit: patch.managerDiscountLimit ?? current.managerDiscountLimit,
    approvalExpiryMinutes: patch.approvalExpiryMinutes ?? current.approvalExpiryMinutes,
    pricesIncludeTax: patch.pricesIncludeTax ?? current.pricesIncludeTax,
    mealSections: normalizeMealSections(patch.mealSections, current.mealSections),
  };
  const reasons: ReasonInput[] = [];
  if (!Number.isInteger(next.receiptScreenSeconds) || next.receiptScreenSeconds < 0 || next.receiptScreenSeconds > 600) {
    reasons.push({ ar: "مدة عرض الإيصال بين 0 و600 ثانية", en: "The receipt display time must be between 0 and 600 seconds" });
  }
  if (!Number.isInteger(next.approvalExpiryMinutes) || next.approvalExpiryMinutes < 1 || next.approvalExpiryMinutes > 60) {
    reasons.push({ ar: "صلاحية طلب الاعتماد بين دقيقة و60 دقيقة", en: "The approval request validity must be between 1 and 60 minutes" });
  }
  for (const [label, labelEn, limit] of [
    ["الكاشير", "cashier", next.cashierDiscountLimit],
    ["المدير", "manager", next.managerDiscountLimit],
  ] as const) {
    if (!Number.isInteger(limit.percentBp) || limit.percentBp < 0 || limit.percentBp > 10000) {
      reasons.push({ ar: `نسبة خصم ${label} بين 0 و100%`, en: `The ${labelEn} discount percentage must be between 0 and 100%` });
    }
    if (limit.amount.scaled < 0n) reasons.push({ ar: `مبلغ خصم ${label} لا يكون سالباً`, en: `The ${labelEn} discount amount cannot be negative` });
  }
  if (next.managerDiscountLimit.percentBp < next.cashierDiscountLimit.percentBp) {
    reasons.push({ ar: "حد المدير (النسبة) لا يقل عن حد الكاشير", en: "The manager limit (percentage) cannot be lower than the cashier limit" });
  }
  if (next.managerDiscountLimit.amount.scaled < next.cashierDiscountLimit.amount.scaled) {
    reasons.push({ ar: "حد المدير (المبلغ) لا يقل عن حد الكاشير", en: "The manager limit (amount) cannot be lower than the cashier limit" });
  }
  const names = new Set<string>();
  for (const section of next.mealSections) {
    if (section.name === "") reasons.push({ ar: "اسم قسم الوجبة مطلوب", en: "The meal section name is required" });
    else if (names.has(section.name)) reasons.push({ ar: `قسم الوجبة «${section.name}» مكرر`, en: `The meal section "${section.name}" is duplicated` });
    names.add(section.name);
  }
  if (reasons.length > 0) throw new InvalidPosSettingsError(reasons);
  return next;
}

/**
 * The discount the caller may grant at the till without asking anyone. The
 * manager ceiling belongs to whoever holds `pos.discount.approve`; it is
 * resolved from the caller's session on the server, never sent by the till.
 */
export function discountLimitFor(settings: PosSettings, canApprove: boolean): PosDiscountLimit & { readonly tier: "cashier" | "manager" } {
  return canApprove ? { ...settings.managerDiscountLimit, tier: "manager" } : { ...settings.cashierDiscountLimit, tier: "cashier" };
}
