import { Money } from "../money/index.js";
import {
  PricingGuardBreachKind,
  PricingGuardCostBasis,
  PricingGuardLineOutcome,
  PricingGuardMode,
  PricingGuardRuleStatus,
  type PricingGuardBreach,
  type PricingGuardEvaluation,
  type PricingGuardEvaluationLineInput,
  type PricingGuardLineEvaluation,
  type PricingGuardRule,
} from "./types.js";

const SCALE = 1_000_000n;
const BASIS_POINTS = 10_000n;

export interface PricingGuardRuleContext {
  readonly customerCategory: string | null;
}

export function ruleApplies(rule: PricingGuardRule, line: Pick<PricingGuardEvaluationLineInput, "itemId" | "categoryIds">, context: PricingGuardRuleContext): boolean {
  if (rule.status !== PricingGuardRuleStatus.Active) return false;
  if (rule.itemId && rule.itemId !== line.itemId) return false;
  if (rule.categoryId && !line.categoryIds.includes(rule.categoryId)) return false;
  if (rule.customerCategory && rule.customerCategory !== context.customerCategory) return false;
  return true;
}

function percentScaled(percent: number): bigint {
  return Money.fromMajor(percent.toFixed(4)).scaled;
}

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) return 0n;
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const rounded = (n % d) * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Gross margin on the net selling price, in basis points: (net − cost) ÷ net — the same figure the invoice detail prints as الهامش. */
export function marginBasisPointsOf(net: Money, cost: Money): bigint | null {
  if (net.scaled <= 0n) return null;
  return divHalfUp((net.scaled - cost.scaled) * BASIS_POINTS, net.scaled);
}

function lineCostOf(line: PricingGuardEvaluationLineInput): Money | null {
  if (!line.unitCostBase || line.costBasis === PricingGuardCostBasis.None) return null;
  return Money.fromScaled(divHalfUp(line.baseQty.scaled * line.unitCostBase.scaled, SCALE));
}

function breachesOf(rule: PricingGuardRule, line: PricingGuardEvaluationLineInput, net: Money, cost: Money | null): PricingGuardBreach[] {
  const found: PricingGuardBreach[] = [];
  const base = { ruleId: rule.id, ruleNameAr: rule.nameAr, mode: rule.mode, floorPrice: rule.floorPrice, minMarginPercent: rule.minMarginPercent };
  // net < floor × qty, cross-multiplied so no division or rounding enters the comparison.
  if (rule.floorPrice && net.scaled * SCALE < rule.floorPrice.scaled * line.baseQty.scaled) {
    found.push({ ...base, kind: PricingGuardBreachKind.BelowFloor });
  }
  // (net − cost) ÷ net < m%, i.e. (net − cost) × 100 < m × net; a line at or below zero fails any positive minimum.
  if (rule.minMarginPercent !== null && cost) {
    const minimum = percentScaled(rule.minMarginPercent);
    const belowMargin = net.scaled <= 0n ? minimum > 0n : (net.scaled - cost.scaled) * 100n * SCALE < minimum * net.scaled;
    if (belowMargin) found.push({ ...base, kind: PricingGuardBreachKind.BelowMinMargin });
  }
  return found;
}

function outcomeOf(breaches: readonly PricingGuardBreach[]): PricingGuardLineOutcome {
  if (breaches.length === 0) return PricingGuardLineOutcome.Pass;
  return breaches.some((breach) => breach.mode === PricingGuardMode.Block) ? PricingGuardLineOutcome.Blocked : PricingGuardLineOutcome.NeedsApproval;
}

const OUTCOME_RANK: Record<PricingGuardLineOutcome, number> = {
  [PricingGuardLineOutcome.Pass]: 0,
  [PricingGuardLineOutcome.NeedsApproval]: 1,
  [PricingGuardLineOutcome.Blocked]: 2,
};

export function strictestOutcome(outcomes: readonly PricingGuardLineOutcome[]): PricingGuardLineOutcome {
  return outcomes.reduce((worst, next) => (OUTCOME_RANK[next] > OUTCOME_RANK[worst] ? next : worst), PricingGuardLineOutcome.Pass);
}

/**
 * Every matching active rule applies and the line must satisfy all of them; a
 * line breaching any Block rule is blocked, otherwise any breach needs approval.
 * A line whose net in base currency is unknown is not judged here — the confirm
 * that would post it refuses a missing exchange rate on its own.
 */
export function evaluatePricingGuard(
  rules: readonly PricingGuardRule[],
  lines: readonly PricingGuardEvaluationLineInput[],
  context: PricingGuardRuleContext,
): PricingGuardEvaluation {
  const evaluated: PricingGuardLineEvaluation[] = lines.map((line) => {
    const cost = lineCostOf(line);
    const net = line.netBase;
    const breaches = net === null ? [] : rules.filter((rule) => ruleApplies(rule, line, context)).flatMap((rule) => breachesOf(rule, line, net, cost));
    return {
      lineId: line.lineId,
      itemId: line.itemId,
      outcome: outcomeOf(breaches),
      breaches,
      netBase: net,
      netUnitPrice: net === null || line.baseQty.scaled === 0n ? null : Money.fromScaled(divHalfUp(net.scaled * SCALE, line.baseQty.scaled)),
      unitCost: cost === null ? null : line.unitCostBase,
      costBasis: cost === null ? PricingGuardCostBasis.None : line.costBasis,
      marginBasisPoints: net === null || cost === null ? null : marginBasisPointsOf(net, cost),
    };
  });
  return { outcome: strictestOutcome(evaluated.map((line) => line.outcome)), lines: evaluated };
}

export function formatBasisPoints(basisPoints: bigint): string {
  const negative = basisPoints < 0n;
  const magnitude = negative ? -basisPoints : basisPoints;
  const whole = magnitude / 100n;
  const fraction = (magnitude % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
