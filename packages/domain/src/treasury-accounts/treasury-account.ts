import { Money } from "../money/index.js";

/**
 * Treasury accounts — core entity (docs/catalog/04-accounting-treasury.md
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
  readonly branchId: string;
  /** Null = auto-selected by the system based on `type` (docs/catalog/04's add-dialog helper text). */
  readonly glAccountId: string | null;
  readonly openingBalance: Money;
  /** Null when no opening balance was set (defaults to today when an amount is given — enforced by the caller/UI). */
  readonly openingBalanceDate: string | null;
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
