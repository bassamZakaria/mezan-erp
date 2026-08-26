import { Money } from "../money/index.js";
import type { TreasuryAccount, TreasuryAccountRepository, TreasuryAccountStatus, TreasuryAccountType } from "./treasury-account.js";
import { NegativeCashBalanceError, TreasuryAccountNotFoundError } from "./errors.js";

export interface UpdateTreasuryAccountCommand {
  readonly nameEn?: string | null;
  readonly name?: string;
  readonly type?: TreasuryAccountType;
  readonly currency?: string;
  readonly branchId?: string;
  readonly glAccountId?: string | null;
  /** Exact decimal string — parsed via `Money.fromMajor`. Use "إضافة رصيد افتتاحي" semantics: this replaces the stored opening balance. */
  readonly openingBalance?: string;
  readonly openingBalanceDate?: string | null;
  readonly status?: TreasuryAccountStatus;
}

/**
 * Edits an existing treasury account, including the "إضافة رصيد افتتاحي"
 * (add/adjust opening balance) menu action the catalog documents on the
 * account statement page. Re-validates the cash-can't-go-negative rule.
 */
export async function updateTreasuryAccount(
  accountId: string,
  command: UpdateTreasuryAccountCommand,
  repo: TreasuryAccountRepository,
): Promise<TreasuryAccount> {
  const current = await repo.findById(accountId);
  if (!current) throw new TreasuryAccountNotFoundError(accountId);

  const nextType = command.type ?? current.type;
  const nextOpeningBalance = command.openingBalance ? Money.fromMajor(command.openingBalance) : current.openingBalance;
  if (nextType === "cash" && nextOpeningBalance.scaled < 0n) {
    throw new NegativeCashBalanceError(accountId);
  }

  const updated: TreasuryAccount = {
    ...current,
    name: command.name ?? current.name,
    nameEn: command.nameEn !== undefined ? command.nameEn : current.nameEn,
    type: nextType,
    currency: command.currency ?? current.currency,
    branchId: command.branchId ?? current.branchId,
    glAccountId: command.glAccountId !== undefined ? command.glAccountId : current.glAccountId,
    openingBalance: nextOpeningBalance,
    openingBalanceDate: command.openingBalanceDate !== undefined ? command.openingBalanceDate : current.openingBalanceDate,
    status: command.status ?? current.status,
  };

  await repo.update(updated);
  return updated;
}
