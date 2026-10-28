import { assertTreasuryLedgerAccount, openTreasuryLedgerAccount, type TreasuryLedgerAccountDeps } from "./ledger-account.js";
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
  TreasuryAccountFixedField,
  TreasuryAccountHasMovementsError,
  TreasuryAccountNotFoundError,
  assertGlAccountHoldsOneCurrency,
} from "./errors.js";

export interface UpdateTreasuryAccountCommand {
  readonly nameEn?: string | null;
  readonly name?: string;
  readonly type?: TreasuryAccountType;
  readonly currency?: string;
  /** رقم الحساب البنكي / IBAN; null clears it. */
  readonly bankAccountNumber?: string | null;
  readonly branchId?: string | null;
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
export interface TreasuryAccountMovementProbe {
  hasPostedLines(glAccountId: string): Promise<boolean>;
}

export async function updateTreasuryAccount(
  accountId: string,
  command: UpdateTreasuryAccountCommand,
  repo: TreasuryAccountRepository,
  ledgerAccounts?: TreasuryLedgerAccountDeps,
  movements?: TreasuryAccountMovementProbe,
): Promise<TreasuryAccount> {
  const current = await repo.findById(accountId);
  if (!current) throw new TreasuryAccountNotFoundError(accountId);

  const changed: TreasuryAccountFixedField[] = [];
  if (command.currency !== undefined && command.currency !== current.currency) changed.push(TreasuryAccountFixedField.Currency);
  if (command.glAccountId !== undefined && command.glAccountId !== current.glAccountId) changed.push(TreasuryAccountFixedField.GlAccount);
  if (changed.length > 0) {
    if (current.glAccountId && (await movements?.hasPostedLines(current.glAccountId))) throw new TreasuryAccountHasMovementsError(accountId, changed);
    assertGlAccountHoldsOneCurrency(
      { id: accountId, glAccountId: command.glAccountId !== undefined ? command.glAccountId : current.glAccountId, currency: command.currency ?? current.currency },
      await repo.list(),
    );
  }

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

  const nextName = command.name ?? current.name;
  const nextNameEn = command.nameEn !== undefined ? command.nameEn : current.nameEn;
  const nextGlAccountId = command.glAccountId !== undefined ? command.glAccountId : current.glAccountId;
  const updated: TreasuryAccount = {
    ...current,
    name: nextName,
    nameEn: nextNameEn,
    type: nextType,
    currency: command.currency ?? current.currency,
    bankAccountNumber:
      command.bankAccountNumber !== undefined ? (command.bankAccountNumber?.trim() || null) : current.bankAccountNumber,
    branchId: command.branchId === undefined ? current.branchId : command.branchId,
    glAccountId: nextGlAccountId || (ledgerAccounts ? await openTreasuryLedgerAccount({ name: nextName, nameEn: nextNameEn }, ledgerAccounts) : null),
    openingBalance: nextOpeningBalance,
    openingBalanceDate: command.openingBalanceDate !== undefined ? command.openingBalanceDate : current.openingBalanceDate,
    guaranteeFacilityLimit: nextFacilityLimit,
    status: command.status ?? current.status,
  };

  if (ledgerAccounts) await assertTreasuryLedgerAccount(updated, ledgerAccounts);

  await repo.update(updated);
  return updated;
}
