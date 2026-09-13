import { Money } from "../money/index.js";
import {
  MAX_GUARANTEE_FACILITY_LIMIT_SCALED,
  MAX_OPENING_BALANCE_SCALED,
  type TreasuryAccount,
  type TreasuryAccountRepository,
  type TreasuryAccountStatus,
  type TreasuryAccountType,
} from "./treasury-account.js";
import {
  InvalidGuaranteeFacilityLimitError,
  InvalidOpeningBalanceError,
  NegativeCashBalanceError,
  TreasuryAccountNotFoundError,
} from "./errors.js";

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
  /** Exact decimal string; null clears the facility. */
  readonly guaranteeFacilityLimit?: string | null;
  readonly status?: TreasuryAccountStatus;
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
  assertOpeningBalanceBound(accountId, nextOpeningBalance);
  if (nextType === "cash" && nextOpeningBalance.scaled < 0n) {
    throw new NegativeCashBalanceError(accountId);
  }

  const nextFacilityLimit =
    command.guaranteeFacilityLimit !== undefined
      ? (command.guaranteeFacilityLimit === null ? null : Money.fromMajor(command.guaranteeFacilityLimit))
      : current.guaranteeFacilityLimit;
  assertFacilityLimit(accountId, nextFacilityLimit);

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
    guaranteeFacilityLimit: nextFacilityLimit,
    status: command.status ?? current.status,
  };

  await repo.update(updated);
  return updated;
}
