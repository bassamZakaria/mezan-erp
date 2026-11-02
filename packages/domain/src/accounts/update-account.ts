import type { Account, AccountRepository, AccountStatus, AccountType, NaturalBalance } from "./account.js";
import {
  AccountHasPostingsError,
  AccountNotFoundError,
  CircularParentAccountError,
  HeaderAccountHasChildrenError,
  InvalidParentAccountError,
} from "./errors.js";
import { hasChildren, isDescendantOf } from "./hierarchy.js";

export interface UpdateAccountCommand {
  readonly nameAr?: string;
  readonly nameEn?: string | null;
  readonly type?: AccountType;
  readonly naturalBalance?: NaturalBalance;
  readonly parentId?: string | null;
  readonly isHeader?: boolean;
  readonly status?: AccountStatus;
}

/**
 * The single question the account editor has to ask the ledger: has anything
 * ever been posted to this account? Structurally satisfied by
 * `LedgerRepository.accountLedger`, so the GL ledger drops straight in without
 * the chart of accounts depending on the GL module.
 */
export interface PostedAccountLookup {
  accountLedger(accountId: string, asOfDate?: string): Promise<readonly unknown[]>;
}

/**
 * Edits an existing account (the "Add Account" dialog doubles as the edit form).
 * Re-validates the hierarchy rules that still apply after the change:
 *   - a new parent must exist and must be a header account,
 *   - reparenting must not create a cycle,
 *   - a header account with children may not be flipped to a postable detail
 *     account (it would strand its children).
 *
 * And, when a `ledger` is supplied, the rule the hierarchy checks cannot see:
 * an account that has already been POSTED TO may not become a header and may
 * not change type. Both edits leave the money in the ledger while moving it out
 * of the report that reads it, so the trial balance stops footing and the
 * year-end close stops carrying the right result. Renaming, reparenting and
 * deactivating stay open — none of them changes what a posted line means.
 */
export async function updateAccount(
  accountId: string,
  command: UpdateAccountCommand,
  repo: AccountRepository,
  ledger?: PostedAccountLookup,
): Promise<Account> {
  const current = await repo.findById(accountId);
  if (!current) throw new AccountNotFoundError(accountId);

  const existing = await repo.list();

  const nextParentId = command.parentId !== undefined ? command.parentId : current.parentId;
  if (nextParentId !== null) {
    if (nextParentId === accountId) {
      throw new CircularParentAccountError(accountId);
    }
    const parent = existing.find((a) => a.id === nextParentId);
    if (!parent) {
      throw new InvalidParentAccountError(
        `الحساب الأصل "${nextParentId}" غير موجود.`,
        `Parent account "${nextParentId}" was not found.`,
      );
    }
    if (!parent.isHeader) {
      throw new InvalidParentAccountError(
        `الحساب الأصل "${nextParentId}" (${parent.code}) حساب تفصيلي، ولا يمكن أن يكون له حسابات فرعية.`,
        `Parent account "${nextParentId}" (${parent.code}) is a detail account and cannot own children.`,
      );
    }
    if (isDescendantOf(existing, nextParentId, accountId)) {
      throw new CircularParentAccountError(accountId);
    }
  }

  const nextIsHeader = command.isHeader !== undefined ? command.isHeader : current.isHeader;
  if (current.isHeader && !nextIsHeader && hasChildren(existing, accountId)) {
    throw new HeaderAccountHasChildrenError(accountId);
  }

  const becomesHeader = !current.isHeader && nextIsHeader;
  const changesType = command.type !== undefined && command.type !== current.type;
  if (ledger && (becomesHeader || changesType)) {
    const movements = await ledger.accountLedger(accountId);
    if (movements.length > 0) {
      throw new AccountHasPostingsError(
        accountId,
        becomesHeader ? "تحويله إلى حساب رئيسي" : "تغيير نوعه",
        becomesHeader ? "turned into a header account" : "changed to another type",
      );
    }
  }

  const updated: Account = {
    ...current,
    nameAr: command.nameAr ?? current.nameAr,
    nameEn: command.nameEn !== undefined ? command.nameEn : current.nameEn,
    type: command.type ?? current.type,
    naturalBalance: command.naturalBalance ?? current.naturalBalance,
    parentId: nextParentId,
    isHeader: nextIsHeader,
    status: command.status ?? current.status,
  };

  await repo.update(updated);
  return updated;
}
