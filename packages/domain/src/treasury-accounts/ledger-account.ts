import type { Account, AccountRepository } from "../accounts/account.js";
import { routedAccountId } from "../accounts/account-routing.js";
import { createAccount } from "../accounts/create-account.js";
import { DuplicateAccountCodeError, InvalidParentAccountError } from "../accounts/errors.js";
import { DuplicateRecordIdError } from "../records/duplicate-record-id.js";
import { CASH_AND_BANK_ROUTING_KEY } from "./cash-and-bank-accounts.js";
import type { TreasuryAccount } from "./treasury-account.js";

export enum TreasuryLedgerAccountFault {
  Missing = "missing",
  Inactive = "inactive",
  Header = "header",
  NotCashOrBank = "not_cash_or_bank",
}

const FAULT_AR: Readonly<Record<TreasuryLedgerAccountFault, string>> = {
  [TreasuryLedgerAccountFault.Missing]: "الحساب الدفتري غير موجود في دليل الحسابات",
  [TreasuryLedgerAccountFault.Inactive]: "الحساب الدفتري غير نشط",
  [TreasuryLedgerAccountFault.Header]: "الحساب الدفتري حساب رئيسي لا يُرحَّل عليه",
  [TreasuryLedgerAccountFault.NotCashOrBank]: "الحساب الدفتري ليس من حسابات النقدية والبنوك",
};

const FAULT_EN: Readonly<Record<TreasuryLedgerAccountFault, string>> = {
  [TreasuryLedgerAccountFault.Missing]: "the ledger account is not in the chart of accounts",
  [TreasuryLedgerAccountFault.Inactive]: "the ledger account is inactive",
  [TreasuryLedgerAccountFault.Header]: "the ledger account is a header and cannot be posted to",
  [TreasuryLedgerAccountFault.NotCashOrBank]: "the ledger account is not a cash or bank account",
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

interface TreasuryLedgerAccountLookup {
  readonly accounts: Pick<AccountRepository, "findById">;
  readonly cashAndBankParentAccountId?: () => Promise<string | null>;
}

export class TreasuryLedgerAccountUnlinkError extends Error {
  readonly code = "TREASURY_LEDGER_ACCOUNT_REQUIRED";
  readonly messageEn: string;
  constructor(readonly accountId: string) {
    super("لا يمكن فك ربط حساب الخزينة بحسابه الدفتري — اختر حساباً دفترياً آخر من النقدية والبنوك بدلاً من تركه فارغاً.");
    this.messageEn = "A treasury account cannot be unlinked from its ledger account — choose another cash or bank ledger account instead of leaving it empty.";
    this.name = "TreasuryLedgerAccountUnlinkError";
  }
}

export interface TreasuryLedgerAccountDeps extends TreasuryLedgerAccountLookup {
  readonly accounts: Pick<AccountRepository, "findById" | "list" | "create">;
  readonly onOpened?: (account: Account) => Promise<void>;
}

async function cashAndBankParentId(deps: TreasuryLedgerAccountLookup): Promise<string | null> {
  return deps.cashAndBankParentAccountId ? await deps.cashAndBankParentAccountId() : routedAccountId(null, CASH_AND_BANK_ROUTING_KEY);
}

// INVARIANT: one leaf per treasury account, never a shared one — a ledger account carries one currency and one drawer's balance.
export async function openTreasuryLedgerAccount(
  treasury: Pick<TreasuryAccount, "name" | "nameEn">,
  deps: TreasuryLedgerAccountDeps,
): Promise<string> {
  const parentId = await cashAndBankParentId(deps);
  const parent = parentId ? await deps.accounts.findById(parentId) : null;
  if (!parent) {
    throw new InvalidParentAccountError(
      "لا يوجد حساب رئيسي للنقدية والبنوك في دليل الحسابات لفتح حساب الخزينة تحته — حدده في توجيه الحسابات أو اختر الحساب الدفتري يدوياً.",
      "No cash-and-bank header exists in the chart of accounts to open the treasury account under — set it in account routing or choose the ledger account yourself.",
    );
  }
  const open = async (): Promise<Account> => {
    const taken = new Set((await deps.accounts.list()).flatMap((account) => [account.id, account.code]));
    let n = 1;
    while (taken.has(`${parent.code}-${n}`)) n += 1;
    const code = `${parent.code}-${n}`;
    return createAccount(
      { id: code, code, nameAr: treasury.name, nameEn: treasury.nameEn, type: "asset", naturalBalance: "debit", parentId: parent.id, isHeader: false },
      deps.accounts,
    );
  };
  let account: Account;
  try {
    account = await open();
  } catch (error) {
    if (!(error instanceof DuplicateRecordIdError)) throw error;
    try {
      account = await open();
    } catch (retryError) {
      if (retryError instanceof DuplicateRecordIdError) throw new DuplicateAccountCodeError(retryError.recordId);
      throw retryError;
    }
  }
  await deps.onOpened?.(account);
  return account.id;
}

const MAX_CHART_DEPTH = 32;

async function sitsUnderCashOrBank(account: Account, deps: TreasuryLedgerAccountLookup): Promise<boolean> {
  const headerId = await cashAndBankParentId(deps);
  let parentId = account.parentId;
  for (let depth = 0; parentId && depth < MAX_CHART_DEPTH; depth++) {
    if (parentId === headerId) return true;
    parentId = (await deps.accounts.findById(parentId))?.parentId ?? null;
  }
  return false;
}

/**
 * LEDGER INVARIANT: the ledger account a treasury account names is where its
 * cash is posted and what the negative-cash guard reads, so it is a live cash
 * or bank leaf. That one ledger account never carries two currencies is
 * `assertGlAccountHoldsOneCurrency`'s to refuse.
 */
export async function assertTreasuryLedgerAccount(
  candidate: Pick<TreasuryAccount, "glAccountId">,
  deps: TreasuryLedgerAccountLookup,
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
  if (account.type !== "asset" || !(await sitsUnderCashOrBank(account, deps))) refuse(TreasuryLedgerAccountFault.NotCashOrBank);
}
