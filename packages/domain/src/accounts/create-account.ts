import type { Account, AccountRepository, AccountStatus, AccountType, NaturalBalance } from "./account.js";
import { DuplicateAccountCodeError, InvalidParentAccountError } from "./errors.js";

export interface CreateAccountCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly type: AccountType;
  readonly naturalBalance: NaturalBalance;
  readonly parentId?: string | null;
  readonly isHeader: boolean;
}

/**
 * Validates a new-account command against the existing chart (docs/catalog/04
 * "دليل الحسابات"): the code must be unique, and a parent — when given — must
 * exist and must itself be a header account (only header/رئيسي accounts may
 * group children; a detail/تفصيلي leaf can never gain a child).
 */
export function validateNewAccount(command: CreateAccountCommand, existing: readonly Account[]): void {
  if (existing.some((a) => a.code === command.code)) {
    throw new DuplicateAccountCodeError(command.code);
  }
  if (command.parentId != null) {
    const parent = existing.find((a) => a.id === command.parentId);
    if (!parent) {
      throw new InvalidParentAccountError(`Parent account "${command.parentId}" was not found.`);
    }
    if (!parent.isHeader) {
      throw new InvalidParentAccountError(
        `Parent account "${command.parentId}" (${parent.code}) is a detail account and cannot own children.`,
      );
    }
  }
}

/**
 * Creates and persists a new account. New accounts always start `active`
 * (docs/catalog/04 — status is toggled later via edit, never at creation).
 */
export async function createAccount(command: CreateAccountCommand, repo: AccountRepository): Promise<Account> {
  const existing = await repo.list();
  validateNewAccount(command, existing);

  const status: AccountStatus = "active";
  const account: Account = {
    id: command.id,
    code: command.code,
    nameAr: command.nameAr,
    nameEn: command.nameEn ?? null,
    type: command.type,
    naturalBalance: command.naturalBalance,
    parentId: command.parentId ?? null,
    isHeader: command.isHeader,
    status,
  };

  await repo.create(account);
  return account;
}
