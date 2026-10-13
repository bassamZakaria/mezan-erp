import { Money } from "../money/index.js";

/**
 * Treasury accounts — core entity (docs/archive/catalog/04-accounting-treasury.md
 * "حسابات الخزينة"). A `TreasuryAccount` is a cash drawer/safe or bank
 * account "wallet", tied to a branch and (optionally, explicitly) a GL
 * account — when no GL account is given, the system auto-selects the
 * matching account by type, per the mockup's add-dialog helper text.
 */

export type TreasuryAccountType = "cash" | "bank";
export type TreasuryAccountStatus = "active" | "inactive";

export interface TreasuryAccountTypeDefinition {
  readonly code: TreasuryAccountType;
  readonly labelAr: string;
}

export const TREASURY_ACCOUNT_TYPE_DEFINITIONS: readonly TreasuryAccountTypeDefinition[] = [
  { code: "cash", labelAr: "نقدي" },
  { code: "bank", labelAr: "بنكي" },
] as const;

export function getTreasuryAccountTypeLabel(type: TreasuryAccountType): string {
  return TREASURY_ACCOUNT_TYPE_DEFINITIONS.find((d) => d.code === type)?.labelAr ?? type;
}

export interface TreasuryAccount {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  /**
   * The English name. Null on records created before the field existed, and on
   * tenants that never fill it in — every reader falls back to `name`, because
   * a blank treasury picker is worse than an Arabic one (D51).
   */
  readonly nameEn: string | null;
  readonly type: TreasuryAccountType;
  readonly currency: string;
  /**
   * رقم الحساب البنكي / IBAN as the bank itself states it. Null on cash
   * drawers and on records created before the field existed. An imported OFX
   * or MT940 file names the account it belongs to, and this is the only thing
   * that can be checked against it — without it a statement can be reconciled
   * into the wrong bank account and nothing refuses.
   */
  readonly bankAccountNumber: string | null;
  /** Null for an account the company holds and no branch owns — the head-office bank. */
  readonly branchId: string | null;
  /** Null = auto-selected by the system based on `type` (docs/archive/catalog/04's add-dialog helper text). */
  readonly glAccountId: string | null;
  readonly openingBalance: Money;
  /** Null when no opening balance was set (defaults to today when an amount is given — enforced by the caller/UI). */
  readonly openingBalanceDate: string | null;
  /**
   * حد تسهيلات خطابات الضمان — the ceiling this bank will issue letters of
   * guarantee up to. A contractor's guarantee limit, not its cash, caps how
   * many jobs it can run, so the register reports what is left of it
   * (contracting/guarantees). Null = no facility configured, and the register
   * then reports exposure without an "available" figure rather than inventing one.
   */
  readonly guaranteeFacilityLimit: Money | null;
  readonly status: TreasuryAccountStatus;
}

/** Persistence port for treasury accounts. The domain depends on this interface only — no SQL, no driver. */
export interface TreasuryAccountRepository {
  findById(id: string): Promise<TreasuryAccount | null>;
  findByCode(code: string): Promise<TreasuryAccount | null>;
  list(): Promise<TreasuryAccount[]>;
  create(account: TreasuryAccount): Promise<void>;
  update(account: TreasuryAccount): Promise<void>;
}

/**
 * The largest guarantee facility a `Money` value can carry through the SQLite
 * column, which stores the scaled integer as a JS number.
 */
export const MAX_GUARANTEE_FACILITY_LIMIT_SCALED = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * The largest magnitude an opening balance can carry through the SQLite
 * column (stores the scaled integer as a JS number). Bank accounts may run
 * negative (overdraft), so this bounds |scaled| rather than just an upper end.
 */
export const MAX_OPENING_BALANCE_SCALED = BigInt(Number.MAX_SAFE_INTEGER);
