import { Money } from "../../money/index.js";
import { percentOf } from "../certificates/amounts.js";
import type { WorksContract } from "./contract.js";

/**
 * التأمين النهائي — the 5% a Law 182/2018 employer takes as a LETTER, not as
 * cash held back from the certificates (design §06 «Retention ages from its
 * release date»).
 *
 * A public works contract therefore has no retention column at all: the
 * security is a performance bond posted up front, its release event is the
 * letter's expiry, and the whole of it is a contract-type flag rather than a
 * posting.
 */

/** One outstanding خطاب حسن تنفيذ as the contract reads it. */
export interface ContractPerformanceGuarantee {
  readonly id: string;
  readonly docNo: string | null;
  readonly currentValue: Money;
  readonly expiryDate: string;
}

/**
 * سجل خطابات الضمان, as the contract sees it. Omitted, a public contract's
 * final security reads as entirely uncovered — which refuses activation rather
 * than waving it through, because the register is the only place the letter
 * can be known to exist.
 */
export interface ContractGuaranteePort {
  listPerformanceGuarantees(contractId: string): Promise<readonly ContractPerformanceGuarantee[]>;
}

export interface FinalSecurityStatus {
  readonly required: Money;
  readonly covered: Money;
  readonly shortfall: Money;
  readonly guaranteeId: string | null;
  readonly guaranteeDocNo: string | null;
  /** The letter's expiry — the release event a public contract ages against. */
  readonly expiryDate: string | null;
}

type FinalSecurityTerms = Pick<WorksContract, "contractType" | "finalSecurityPercent">;

/** A public contract carrying a تأمين نهائي percentage. Everything else retains cash from certificates. */
export function requiresFinalSecurity(contract: FinalSecurityTerms): boolean {
  if (contract.contractType !== "public") return false;
  try {
    return Money.fromMajor(contract.finalSecurityPercent).scaled > 0n;
  } catch {
    return false;
  }
}

/** A money figure as a person reads it — two places, not the ledger's six. */
function minor(amount: Money): string {
  const text = amount.toString();
  const dot = text.indexOf(".");
  return dot === -1 ? text : text.slice(0, dot + 3);
}

/**
 * What the employer requires against what the register actually holds. Null on
 * any contract the flag does not apply to, so a caller never has to repeat the
 * contract-type test.
 */
export function finalSecurityStatusOf(
  contract: FinalSecurityTerms,
  contractValue: Money,
  guarantees: readonly ContractPerformanceGuarantee[],
): FinalSecurityStatus | null {
  if (!requiresFinalSecurity(contract)) return null;
  const required = percentOf(contractValue, contract.finalSecurityPercent);
  const covered = Money.sum(guarantees.map((g) => g.currentValue));
  const shortfallScaled = required.scaled - covered.scaled;
  const largest = [...guarantees].sort((a, b) => (b.currentValue.scaled > a.currentValue.scaled ? 1 : -1))[0] ?? null;
  return {
    required,
    covered,
    shortfall: Money.fromScaled(shortfallScaled > 0n ? shortfallScaled : 0n),
    guaranteeId: largest?.id ?? null,
    guaranteeDocNo: largest?.docNo ?? null,
    expiryDate: largest?.expiryDate ?? null,
  };
}

/** The Arabic refusal a shortfall produces; null when the letter covers the requirement. */
export function finalSecurityShortfallReason(status: FinalSecurityStatus | null): string | null {
  if (status === null || status.shortfall.scaled <= 0n) return null;
  return `تأمين نهائي ناقص: المطلوب ${minor(status.required)}، القائم ${minor(status.covered)}`;
}
