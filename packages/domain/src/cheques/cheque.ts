import type { Money } from "../money/index.js";

/**
 * Cheque register — core entity (docs/catalog/04-accounting-treasury.md "سجل
 * الشيكات"). Tracks a single physical/post-dated cheque received from a
 * customer (`incoming`) or issued to a supplier (`outgoing`) through its
 * 7-state lifecycle, distinct from the treasury-voucher module.
 *
 * Persisted status only ever holds the 5 states a real action moves it
 * through — قيد الانتظار/مودع/محصل/مرتد/مستبدل. "تحت التحصيل" and "المستحقة
 * اليوم" are date-derived views of a "pending" cheque (see status.ts
 * `effectiveChequeStatus`), not separate stored states — the permission
 * catalog's `cheques.*` module has exactly 5 mutating actions (view aside):
 * create/deposit/collect/bounce, with no action to manually enter those two,
 * which only makes sense if they are computed from `dueDate` rather than
 * user-triggered.
 */

export type ChequeDirection = "incoming" | "outgoing";

/** The subset of states actually written to storage. */
export type ChequeStoredStatus = "pending" | "deposited" | "collected" | "bounced" | "replaced";

/** The full 7-state list the register's status filter tabs expose. */
export type ChequeStatus = ChequeStoredStatus | "under_collection" | "due_today";

export interface ChequeDirectionDefinition {
  readonly code: ChequeDirection;
  readonly labelAr: string;
}

export const CHEQUE_DIRECTION_DEFINITIONS: readonly ChequeDirectionDefinition[] = [
  { code: "incoming", labelAr: "واردة" },
  { code: "outgoing", labelAr: "صادرة" },
] as const;

export interface ChequeStatusDefinition {
  readonly code: ChequeStatus;
  readonly labelAr: string;
}

/** Ordered exactly as docs/catalog/04 lists the status filter tabs. */
export const CHEQUE_STATUS_DEFINITIONS: readonly ChequeStatusDefinition[] = [
  { code: "pending", labelAr: "قيد الانتظار" },
  { code: "under_collection", labelAr: "تحت التحصيل" },
  { code: "due_today", labelAr: "المستحقة اليوم" },
  { code: "deposited", labelAr: "مودع" },
  { code: "collected", labelAr: "محصل" },
  { code: "bounced", labelAr: "مرتد" },
  { code: "replaced", labelAr: "مستبدل" },
] as const;

export function getChequeStatusLabel(status: ChequeStatus): string {
  return CHEQUE_STATUS_DEFINITIONS.find((d) => d.code === status)?.labelAr ?? status;
}

export function getChequeDirectionLabel(direction: ChequeDirection): string {
  return CHEQUE_DIRECTION_DEFINITIONS.find((d) => d.code === direction)?.labelAr ?? direction;
}

/**
 * Control accounts a cheque posts against, resolved by the caller from the
 * chart of accounts (mirrors `CreateVoucherCommand.treasuryGlAccountId` /
 * `counterpartyGlAccountId` — the domain never hardcodes account codes).
 *
 * `underCollectionAccountId` is the "شيكات تحت التحصيل" bucket (COA 1320 for
 * incoming cheques) or the equivalent "cheques payable" liability control for
 * outgoing ones. `bouncedAccountId` is only required for `incoming` cheques
 * (COA 1360 "شيكات مرتجعة") — an outgoing bounce simply reverses the original
 * posting back onto the supplier's AP account, since there is no "bounced
 * payable" concept.
 */
export interface ChequeControlAccounts {
  readonly underCollectionAccountId: string;
  readonly bouncedAccountId?: string | null;
}

export interface Cheque {
  readonly id: string;
  readonly direction: ChequeDirection;
  readonly status: ChequeStoredStatus;
  readonly chequeNumber: string;
  readonly bankName: string;
  readonly bankBranchName: string | null;
  readonly bankAccountNumber: string | null;
  readonly amount: Money;
  readonly currency: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly branchId: string;
  readonly notes: string | null;
  /** Customer id for `incoming`, supplier id for `outgoing`. */
  readonly partyId: string;
  /** The customer/supplier AR/AP control (or sub-)account this cheque reclassifies out of/into. */
  readonly counterpartyGlAccountId: string;
  readonly controlAccounts: ChequeControlAccounts;
  /** Set once `deposit()` records which bank treasury account the cheque was handed to. */
  readonly bankTreasuryAccountId: string | null;
  readonly createdAt: string;
  readonly depositedAt: string | null;
  readonly collectedAt: string | null;
  readonly bouncedAt: string | null;
  /** Set when this cheque was created to replace a bounced one. */
  readonly replacesChequeId: string | null;
  /** Set on the bounced cheque once it has been replaced. */
  readonly replacedByChequeId: string | null;
  readonly creationJournalEntryId: string | null;
  readonly collectionJournalEntryId: string | null;
  readonly bounceJournalEntryId: string | null;
}

/**
 * Repository-level filter — matches the RAW stored status only (5 values).
 * Filtering on the derived 7-state status (`under_collection`/`due_today`)
 * happens in {@link ChequeService.list}, which needs `asOfDate` to compute it.
 */
export interface ChequeListFilter {
  readonly direction?: ChequeDirection;
  readonly status?: ChequeStoredStatus;
  /** Inclusive bounds on `dueDate`. */
  readonly fromDate?: string;
  readonly toDate?: string;
}

/** Persistence port for cheques. The domain depends on this interface only. */
export interface ChequeRepository {
  save(cheque: Cheque): Promise<void>;
  update(cheque: Cheque): Promise<void>;
  findById(id: string): Promise<Cheque | null>;
  findByChequeNumber(direction: ChequeDirection, chequeNumber: string): Promise<Cheque | null>;
  list(filter?: ChequeListFilter): Promise<readonly Cheque[]>;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
