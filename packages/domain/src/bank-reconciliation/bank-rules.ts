import type { StatementLine } from "./bank-statement.js";

export enum BankRuleDirection {
  Any = "any",
  MoneyIn = "in",
  MoneyOut = "out",
}

export enum BankRuleMatchType {
  Contains = "contains",
  StartsWith = "starts_with",
  Equals = "equals",
}

/**
 * A memo pattern that decides the counter account (and cost centre) of the
 * entry a statement line creates — QuickBooks' bank rules, Odoo's
 * reconciliation models. `treasuryAccountId` null applies to every bank account.
 */
export interface BankRule {
  readonly id: string;
  readonly name: string;
  readonly treasuryAccountId: string | null;
  readonly pattern: string;
  readonly matchType: BankRuleMatchType;
  readonly direction: BankRuleDirection;
  readonly accountId: string;
  readonly costCenterId: string | null;
  readonly priority: number;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BankRuleRepository {
  list(): Promise<readonly BankRule[]>;
  findById(id: string): Promise<BankRule | null>;
  save(rule: BankRule): Promise<void>;
  update(rule: BankRule): Promise<void>;
  delete(id: string): Promise<void>;
}

function fold(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[\u0623\u0625\u0622\u0671]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function ruleMatchesLine(rule: BankRule, line: Pick<StatementLine, "description" | "reference" | "amount" | "counterparty">, treasuryAccountId: string): boolean {
  if (!rule.active) return false;
  if (rule.treasuryAccountId !== null && rule.treasuryAccountId !== treasuryAccountId) return false;
  if (rule.direction === BankRuleDirection.MoneyIn && line.amount.scaled <= 0n) return false;
  if (rule.direction === BankRuleDirection.MoneyOut && line.amount.scaled >= 0n) return false;
  const pattern = fold(rule.pattern);
  if (pattern === "") return false;
  const haystacks = [line.description, line.reference ?? "", line.counterparty ?? ""].map(fold);
  return haystacks.some((text) => {
    if (rule.matchType === BankRuleMatchType.Equals) return text === pattern;
    if (rule.matchType === BankRuleMatchType.StartsWith) return text.startsWith(pattern);
    return text.includes(pattern);
  });
}

/** The first matching rule by priority (lower first), then the more specific account-bound rule, then the oldest. */
export function findMatchingRule(
  rules: readonly BankRule[],
  line: Pick<StatementLine, "description" | "reference" | "amount" | "counterparty">,
  treasuryAccountId: string,
): BankRule | null {
  const ordered = [...rules].sort(
    (a, b) =>
      a.priority - b.priority ||
      Number(b.treasuryAccountId !== null) - Number(a.treasuryAccountId !== null) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  return ordered.find((rule) => ruleMatchesLine(rule, line, treasuryAccountId)) ?? null;
}
