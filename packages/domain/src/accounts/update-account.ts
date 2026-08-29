import type { Account, AccountRepository, AccountStatus, AccountType, NaturalBalance } from "./account.js";
import {
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
 * Edits an existing account (docs/archive/catalog/04's "Add Account" dialog doubles
 * as the edit form). Re-validates the hierarchy rules that still apply after
 * the change:
 *   - a new parent must exist and must be a header account,
 *   - reparenting must not create a cycle (an account can't become its own
 *     ancestor),
 *   - a header account with children may not be flipped to a postable detail
 *     account (it would strand its children).
 */
export async function updateAccount(
  accountId: string,
  command: UpdateAccountCommand,
  repo: AccountRepository,
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
      throw new InvalidParentAccountError(`Parent account "${nextParentId}" was not found.`);
    }
    if (!parent.isHeader) {
      throw new InvalidParentAccountError(
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
