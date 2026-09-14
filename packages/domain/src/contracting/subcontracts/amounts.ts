import { Money } from "../../money/index.js";
import { extendQty, subtract, type CertificateComputationInput } from "../certificates/amounts.js";
import { addMonthsToDate } from "../controls/retention-math.js";
import type {
  Subcontract,
  SubcontractLine,
  SubcontractRetentionReleaseKind,
  SubcontractTerms,
} from "./subcontract.js";

/**
 * The subcontract's arithmetic — all of it, and pure.
 *
 * There is deliberately very little of it: the certificate block is the CLIENT
 * certificate's block (`computeCertificate` in ../certificates/amounts.ts),
 * struck against the subcontractor's own percentages. Re-deriving it here would
 * give two implementations of the same cumulative-then-difference rule and one
 * of them would drift.
 */

/** Σ qty × rate over the lines. */
export function computeSubcontractValue(lines: readonly Pick<SubcontractLine, "qty" | "unitRate">[]): Money {
  return Money.sum(lines.map((l) => extendQty(l.qty, l.unitRate)));
}

/** What the same quantities are worth at the CLIENT's rates — the other half of the margin. */
export function computeSubcontractClientValue(
  lines: readonly Pick<SubcontractLine, "qty" | "clientUnitRate">[],
): Money {
  return Money.sum(lines.map((l) => extendQty(l.qty, l.clientUnitRate)));
}

/** clientUnitRate − unitRate, per line. Negative is legal and is exactly what the grid must show. */
export function lineMarginVsClient(clientUnitRate: Money, unitRate: Money): Money {
  return subtract(clientUnitRate, unitRate);
}

/**
 * The subcontract's terms as the certificate engine reads them.
 *
 * Three of them are fixed rather than parameters: a subcontract carries no
 * نسبة ممارسة (the tender discount is the EMPLOYER's, already struck on the
 * client certificate) and no دمغات (the contractor does not stamp its own
 * subcontractor's bill), and التأمينات الاجتماعية collapses to zero unless the
 * contractor actually withholds it — `withholdSocialInsurance` off must mean
 * NO deduction, not a deduction at a rate nobody applied.
 */
export function subcontractCertificateTerms(
  terms: SubcontractTerms,
): CertificateComputationInput["terms"] {
  return {
    tenderDiscountPercent: "0",
    retentionPercent: terms.retentionPercent,
    retentionCapPercent: terms.retentionCapPercent,
    advanceRecoveryPercent: terms.advanceRecoveryPercent,
    deemedWagePercent: terms.withholdSocialInsurance ? terms.deemedWagePercent : "0",
    socialInsuranceRatePercent: terms.withholdSocialInsurance ? terms.socialInsuranceRatePercent : "0",
    withholdingTaxPercent: terms.withholdingTaxPercent,
    stampDutyPercent: "0",
    vatBasis: terms.vatBasis,
  };
}

/** The value of a subcontract as stored, for the header and the list. */
export function subcontractValue(subcontract: Pick<Subcontract, "lines">): Money {
  return computeSubcontractValue(subcontract.lines);
}

/**
 * ميعاد الإفراج — the release event a subcontract's retention is waiting on.
 *
 * The clock is the COMPLETION of the package, not the certificate that
 * withheld the money: the provisional tranche falls due when the sub finishes,
 * the final one when the defects-liability period it signed for has run. Null
 * while the subcontract is not completed, because a date invented for an
 * unfinished package is one a collector would chase.
 */
export function subcontractReleaseEventDate(
  kind: SubcontractRetentionReleaseKind,
  subcontract: Pick<Subcontract, "completedAt" | "defectsLiabilityMonths">,
): string | null {
  if (subcontract.completedAt === null) return null;
  if (kind === "provisional") return subcontract.completedAt;
  return addMonthsToDate(subcontract.completedAt, subcontract.defectsLiabilityMonths);
}

/** Released before its event fell due. False while the event is unknown — an unknown date is not evidence. */
export function isEarlySubcontractRelease(date: string, releaseEventDate: string | null): boolean {
  return releaseEventDate !== null && date < releaseEventDate;
}

/** التكلفة الملتزم بها — Σ qty × rate still ahead of the contractor on a live package. */
export function remainingCommitmentOf(value: Money, certifiedToDate: Money): Money {
  const remaining = Money.fromScaled(value.scaled - certifiedToDate.scaled);
  return remaining.scaled < 0n ? Money.zero() : remaining;
}
