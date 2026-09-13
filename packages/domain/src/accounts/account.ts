/**
 * Chart of Accounts — core entity (docs/archive/catalog/04-accounting-treasury.md
 * "دليل الحسابات"). An `Account` is either:
 *   - a "header" account (حساب رئيسي) — a non-postable grouping node that owns
 *     children and rolls their balances up, or
 *   - a "detail"/postable account (حساب تفصيلي) — a leaf that journal lines may
 *     post to.
 *
 * `naturalBalance` records which side (debit/credit) increases the account —
 * the sign convention used to present a "normal" positive balance, mirroring
 * the mockup's "الرصيد الطبيعي" field.
 */

/**
 * "memorandum" (حساب نظامي) is off balance sheet: it records a contingent
 * obligation — a letter of guarantee's face value — as a self-balancing
 * نظامي مدين / نظامي دائن pair. Every financial statement MUST exclude it, or
 * the guarantee register's face values inflate both sides of the balance sheet
 * (reports/gl-shared.ts `classifyAccount`).
 */
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense" | "memorandum";

export type NaturalBalance = "debit" | "credit";

export type AccountStatus = "active" | "inactive";

export interface Account {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly type: AccountType;
  readonly naturalBalance: NaturalBalance;
  /** Null for a root account. */
  readonly parentId: string | null;
  /** true = رئيسي (header, non-postable, groups children). false = تفصيلي (detail, postable). */
  readonly isHeader: boolean;
  readonly status: AccountStatus;
}

/**
 * Persistence port for the Chart of Accounts. The domain depends on this
 * interface only (docs/archive/plan.md §2.2) — no SQL, no driver.
 */
export interface AccountRepository {
  findById(id: string): Promise<Account | null>;
  findByCode(code: string): Promise<Account | null>;
  /** All accounts, flat (no ordering guarantee — callers sort/nest as needed). */
  list(): Promise<Account[]>;
  create(account: Account): Promise<void>;
  /** Full replace of an existing account row. */
  update(account: Account): Promise<void>;
}
