import type { Account, AccountRepository } from "../accounts/account.js";
import type { TreasuryAccount } from "./treasury-account.js";

/** The headers a cash or bank ledger account sits under in the standard chart («النقدية»). */
export const CASH_AND_BANK_PARENT_ACCOUNT_IDS: readonly string[] = ["1300"];

export enum TreasuryLedgerAccountFault {
  Missing = "missing",
  Inactive = "inactive",
  Header = "header",
  NotCashOrBank = "not_cash_or_bank",
  OtherCurrency = "other_currency",
}

const FAULT_AR: Readonly<Record<TreasuryLedgerAccountFault, string>> = {
  [TreasuryLedgerAccountFault.Missing]: "الحساب الدفتري غير موجود في دليل الحسابات",
  [TreasuryLedgerAccountFault.Inactive]: "الحساب الدفتري غير نشط",
  [TreasuryLedgerAccountFault.Header]: "الحساب الدفتري حساب رئيسي لا يُرحَّل عليه",
  [TreasuryLedgerAccountFault.NotCashOrBank]: "الحساب الدفتري ليس من حسابات النقدية والبنوك",
  [TreasuryLedgerAccountFault.OtherCurrency]: "الحساب الدفتري مربوط بحساب خزينة آخر بعملة مختلفة",
};

const FAULT_EN: Readonly<Record<TreasuryLedgerAccountFault, string>> = {
  [TreasuryLedgerAccountFault.Missing]: "the ledger account is not in the chart of accounts",
  [TreasuryLedgerAccountFault.Inactive]: "the ledger account is inactive",
  [TreasuryLedgerAccountFault.Header]: "the ledger account is a header and cannot be posted to",
  [TreasuryLedgerAccountFault.NotCashOrBank]: "the ledger account is not a cash or bank account",
  [TreasuryLedgerAccountFault.OtherCurrency]: "the ledger account is linked to another treasury account in a different currency",
};

export class InvalidTreasuryLedgerAccountError extends Error {
  readonly code = "TREASURY_LEDGER_ACCOUNT_INVALID";
  readonly messageEn: string;
  constructor(
    readonly glAccountId: string,
    readonly fault: TreasuryLedgerAccountFault,
  ) {
    super(`لا يمكن ربط حساب الخزينة بالحساب "${glAccountId}": ${FAULT_AR[fault]}.`);
    this.messageEn = `The treasury account cannot be linked to "${glAccountId}": ${FAULT_EN[fault]}.`;
    this.name = "InvalidTreasuryLedgerAccountError";
  }
}

export interface TreasuryLedgerAccountDeps {
  readonly accounts: Pick<AccountRepository, "findById">;
}

const MAX_CHART_DEPTH = 32;

async function sitsUnderCashOrBank(account: Account, accounts: Pick<AccountRepository, "findById">): Promise<boolean> {
  let parentId = account.parentId;
  for (let depth = 0; parentId && depth < MAX_CHART_DEPTH; depth++) {
    if (CASH_AND_BANK_PARENT_ACCOUNT_IDS.includes(parentId)) return true;
    parentId = (await accounts.findById(parentId))?.parentId ?? null;
  }
  return false;
}

/**
 * LEDGER INVARIANT: the ledger account a treasury account names is where its
 * cash is posted and what the negative-cash guard reads, so it is a live cash
 * or bank leaf, and one ledger account never carries two currencies.
 */
export async function assertTreasuryLedgerAccount(
  candidate: Pick<TreasuryAccount, "id" | "glAccountId" | "currency">,
  others: readonly TreasuryAccount[],
  deps: TreasuryLedgerAccountDeps,
): Promise<void> {
  const glAccountId = candidate.glAccountId;
  if (glAccountId === null) return;
  const refuse = (fault: TreasuryLedgerAccountFault): never => {
    throw new InvalidTreasuryLedgerAccountError(glAccountId, fault);
  };
  const account = await deps.accounts.findById(glAccountId);
  if (!account) return refuse(TreasuryLedgerAccountFault.Missing);
  if (account.status !== "active") refuse(TreasuryLedgerAccountFault.Inactive);
  if (account.isHeader) refuse(TreasuryLedgerAccountFault.Header);
  if (account.type !== "asset" || !(await sitsUnderCashOrBank(account, deps.accounts))) refuse(TreasuryLedgerAccountFault.NotCashOrBank);
  const clash = others.some((other) => other.id !== candidate.id && other.glAccountId === glAccountId && other.currency !== candidate.currency);
  if (clash) refuse(TreasuryLedgerAccountFault.OtherCurrency);
}
