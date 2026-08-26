import { InvalidTaxGroupError } from "./errors.js";
import type { TaxRateStatus } from "./tax-rate.js";

/**
 * مجموعات الضرائب — a named set of tax rates applied together (R6.4).
 *
 * A single rate is not enough where more than one tax lands on the same line:
 * VAT plus a table tax, VAT plus a development levy. Modelling that as one
 * combined percentage loses which authority is owed what, and the VAT return
 * cannot be produced from a figure that has two taxes melted into it.
 *
 * A group is an ordered list of rate ids. Order matters because a compounding
 * member is charged on the running total rather than on the line's base.
 */
export interface TaxGroupMember {
  readonly taxRateId: string;
  /**
   * Charge this member on the base PLUS everything before it, rather than on
   * the base alone. Egypt's table tax on top of VAT is the usual case.
   */
  readonly compounding: boolean;
}

export interface TaxGroup {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly members: readonly TaxGroupMember[];
  readonly status: TaxRateStatus;
}

export interface TaxGroupRepository {
  findById(id: string): Promise<TaxGroup | null>;
  list(): Promise<TaxGroup[]>;
  create(group: TaxGroup): Promise<void>;
  update(group: TaxGroup): Promise<void>;
}

export function collectTaxGroupErrors(group: TaxGroup): string[] {
  const reasons: string[] = [];
  if (group.code.trim() === "") reasons.push("كود المجموعة مطلوب");
  if (group.nameAr.trim() === "") reasons.push("اسم المجموعة مطلوب");
  // A group with no members is not a group; it would silently apply no tax at
  // all to every line that chose it.
  if (group.members.length === 0) reasons.push("المجموعة يجب أن تحتوي على ضريبة واحدة على الأقل");

  const seen = new Set<string>();
  for (const member of group.members) {
    if (member.taxRateId.trim() === "") reasons.push("معرف الضريبة مطلوب");
    // The same rate twice would double-charge it with nothing on screen
    // explaining why the total is wrong.
    else if (seen.has(member.taxRateId)) reasons.push(`الضريبة ${member.taxRateId} مكررة داخل المجموعة`);
    seen.add(member.taxRateId);
  }
  return reasons;
}

export function validateTaxGroup(group: TaxGroup): void {
  const reasons = collectTaxGroupErrors(group);
  if (reasons.length > 0) throw new InvalidTaxGroupError(reasons);
}

export interface TaxGroupRateView {
  readonly id: string;
  readonly ratePercent: number;
}

export interface TaxGroupComponent {
  readonly taxRateId: string;
  readonly ratePercent: number;
  readonly compounding: boolean;
  /** The percentage of the ORIGINAL base this member actually costs. */
  readonly effectivePercent: number;
}

export interface TaxGroupBreakdown {
  readonly components: readonly TaxGroupComponent[];
  /** What the whole group costs as a percentage of the base. */
  readonly effectivePercent: number;
}

/**
 * What a group actually charges, member by member.
 *
 * Kept as a breakdown rather than a single total because the whole reason a
 * group exists is that the parts are owed to different authorities: the VAT
 * return needs the VAT member alone, not the combined figure.
 *
 * Percentages, not money — rounding happens once, at the line-extension
 * boundary, never here.
 */
export function taxGroupBreakdown(
  group: TaxGroup,
  rateById: (id: string) => TaxGroupRateView | null,
): TaxGroupBreakdown {
  const components: TaxGroupComponent[] = [];
  let runningPercent = 100;
  for (const member of group.members) {
    const rate = rateById(member.taxRateId);
    if (!rate) continue;
    const basePercent = member.compounding ? runningPercent : 100;
    const effectivePercent = (basePercent * rate.ratePercent) / 100;
    components.push({
      taxRateId: member.taxRateId,
      ratePercent: rate.ratePercent,
      compounding: member.compounding,
      effectivePercent,
    });
    runningPercent += effectivePercent;
  }
  return {
    components,
    effectivePercent: components.reduce((sum, component) => sum + component.effectivePercent, 0),
  };
}
