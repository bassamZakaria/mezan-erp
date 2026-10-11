import { Money } from "../money/index.js";
import {
  MAX_GUARANTEE_FACILITY_LIMIT_SCALED,
  MAX_OPENING_BALANCE_SCALED,
  type TreasuryAccount,
  type TreasuryAccountRepository,
  type TreasuryAccountType,
} from "./treasury-account.js";
import {
  DuplicateTreasuryAccountCodeError,
  InvalidGuaranteeFacilityLimitError,
  InvalidOpeningBalanceError,
  NegativeCashBalanceError,
} from "./errors.js";
import { assertRecordIdIsNew } from "../records/duplicate-record-id.js";

export interface CreateTreasuryAccountCommand {
  readonly nameEn?: string | null;
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type?: TreasuryAccountType;
  readonly currency?: string;
  /** رقم الحساب البنكي / IBAN as the bank states it; trimmed, and empty is stored as null. */
  readonly bankAccountNumber?: string | null;
  readonly branchId: string | null;
  readonly glAccountId?: string | null;
  /** Exact decimal string (e.g. "0.00", "338.00") — parsed via `Money.fromMajor`. */
  readonly openingBalance?: string;
  readonly openingBalanceDate?: string | null;
  /** Exact decimal string. Omitted, the account has no guarantee facility. */
  readonly guaranteeFacilityLimit?: string | null;
}

/**
 * The facility limit must be storable and must not be negative. Without this
 * an over-large figure reaches the SQLite writer and throws a RangeError there
 * — a 500 where the caller should have been told what is wrong.
 */
function assertFacilityLimit(accountId: string, limit: Money | null): void {
  if (limit === null) return;
  if (limit.scaled < 0n) {
    throw new InvalidGuaranteeFacilityLimitError(accountId, "حد تسهيلات خطابات الضمان لا يمكن أن يكون سالباً.");
  }
  if (limit.scaled > MAX_GUARANTEE_FACILITY_LIMIT_SCALED) {
    throw new InvalidGuaranteeFacilityLimitError(accountId, "حد تسهيلات خطابات الضمان أكبر من أن يُسجَّل — راجع الرقم المُدخل.");
  }
}

function assertNoNegativeCashBalance(id: string, type: TreasuryAccountType, openingBalance: Money): void {
  if (type === "cash" && openingBalance.scaled < 0n) {
    throw new NegativeCashBalanceError(id);
  }
}

/**
 * The opening balance must be storable. Without this an over-large figure
 * reaches the SQLite writer and throws a RangeError there — a 500 where the
 * caller should have been told what is wrong.
 */
function assertOpeningBalanceBound(accountId: string, openingBalance: Money): void {
  if (openingBalance.scaled > MAX_OPENING_BALANCE_SCALED || openingBalance.scaled < -MAX_OPENING_BALANCE_SCALED) {
    throw new InvalidOpeningBalanceError(accountId, "الرصيد الافتتاحي أكبر من أن يُسجَّل — راجع الرقم المُدخل.");
  }
}

/**
 * Validates a new-treasury-account command against the existing list
 * (docs/archive/catalog/04 "حسابات الخزينة"): the code must be unique, and a cash
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
  assertOpeningBalanceBound(command.id, openingBalance);
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
  assertRecordIdIsNew(existing.find((row) => row.id === command.id), command.id);
  validateNewTreasuryAccount(command, existing);

  const type = command.type ?? "cash";
  const openingBalance = command.openingBalance ? Money.fromMajor(command.openingBalance) : Money.zero();
  const guaranteeFacilityLimit =
    command.guaranteeFacilityLimit != null ? Money.fromMajor(command.guaranteeFacilityLimit) : null;
  assertFacilityLimit(command.id, guaranteeFacilityLimit);

  const account: TreasuryAccount = {
    id: command.id,
    code: command.code,
    name: command.name,
    nameEn: command.nameEn ?? null,
    type,
    currency: command.currency ?? "EGP",
    bankAccountNumber: command.bankAccountNumber?.trim() || null,
    branchId: command.branchId,
    glAccountId: command.glAccountId ?? null,
    openingBalance,
    openingBalanceDate: command.openingBalanceDate ?? null,
    guaranteeFacilityLimit,
    status: "active",
  };

  await repo.create(account);
  return account;
}
