import { Money } from "../money/index.js";
import type { TreasuryAccount, TreasuryAccountRepository, TreasuryAccountType } from "./treasury-account.js";
import { DuplicateTreasuryAccountCodeError, NegativeCashBalanceError } from "./errors.js";

export interface CreateTreasuryAccountCommand {
  readonly nameEn?: string | null;
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type?: TreasuryAccountType;
  readonly currency?: string;
  readonly branchId: string;
  readonly glAccountId?: string | null;
  /** Exact decimal string (e.g. "0.00", "338.00") — parsed via `Money.fromMajor`. */
  readonly openingBalance?: string;
  readonly openingBalanceDate?: string | null;
}

function assertNoNegativeCashBalance(id: string, type: TreasuryAccountType, openingBalance: Money): void {
  if (type === "cash" && openingBalance.scaled < 0n) {
    throw new NegativeCashBalanceError(id);
  }
}

/**
 * Validates a new-treasury-account command against the existing list
 * (docs/catalog/04 "حسابات الخزينة"): the code must be unique, and a cash
 * account's opening balance may not be negative (bank accounts may, per the
 * tenant's overdraft-allowed policy).
 */
export function validateNewTreasuryAccount(
  command: CreateTreasuryAccountCommand,
  existing: readonly TreasuryAccount[],
): void {
  if (existing.some((a) => a.code === command.code)) {
    throw new DuplicateTreasuryAccountCodeError(command.code);
  }
  const openingBalance = command.openingBalance ? Money.fromMajor(command.openingBalance) : Money.zero();
  assertNoNegativeCashBalance(command.id, command.type ?? "cash", openingBalance);
}

/**
 * Creates and persists a new treasury account. New accounts always start
 * `active`. Leaving `glAccountId` unset mirrors the mockup's "usually left
 * blank, the system auto-selects the matching account by type" behavior —
 * the auto-selection itself is a Phase 2 GL-wiring concern.
 */
export async function createTreasuryAccount(
  command: CreateTreasuryAccountCommand,
  repo: TreasuryAccountRepository,
): Promise<TreasuryAccount> {
  const existing = await repo.list();
  validateNewTreasuryAccount(command, existing);

  const type = command.type ?? "cash";
  const openingBalance = command.openingBalance ? Money.fromMajor(command.openingBalance) : Money.zero();

  const account: TreasuryAccount = {
    id: command.id,
    code: command.code,
    name: command.name,
    nameEn: command.nameEn ?? null,
    type,
    currency: command.currency ?? "EGP",
    branchId: command.branchId,
    glAccountId: command.glAccountId ?? null,
    openingBalance,
    openingBalanceDate: command.openingBalanceDate ?? null,
    status: "active",
  };

  await repo.create(account);
  return account;
}
