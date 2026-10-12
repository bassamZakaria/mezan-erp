import { DEFAULT_TIME_ZONE, toTenantDay } from "../dates.js";
import type { Money } from "../money/index.js";

/**
 * Cheque register — core entity (docs/archive/catalog/04-accounting-treasury.md "سجل
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
  readonly labelEn: string;
}

export const CHEQUE_DIRECTION_DEFINITIONS: readonly ChequeDirectionDefinition[] = [
  { code: "incoming", labelAr: "واردة", labelEn: "Incoming" },
  { code: "outgoing", labelAr: "صادرة", labelEn: "Outgoing" },
] as const;

export interface ChequeStatusDefinition {
  readonly code: ChequeStatus;
  readonly labelAr: string;
  readonly labelEn: string;
}

/**
 * Ordered exactly as docs/archive/catalog/04 lists the status filter tabs.
 *
 * `under_collection` and `due_today` are DERIVED from a still-`pending`
 * cheque's due date — nobody has handed the paper to a bank yet. They used to
 * read «تحت التحصيل» / "under collection", which names the bank action the row
 * still OFFERS as «إيداع في البنك», so the pill and the button contradicted
 * each other on every maturing cheque (D55). They now describe the maturity
 * window instead of a bank action.
 */
export const CHEQUE_STATUS_DEFINITIONS: readonly ChequeStatusDefinition[] = [
  { code: "pending", labelAr: "قيد الانتظار", labelEn: "Pending" },
  { code: "under_collection", labelAr: "يقترب موعد الاستحقاق", labelEn: "Due soon" },
  { code: "due_today", labelAr: "استحق ولم يُودع", labelEn: "Due, not deposited" },
  { code: "deposited", labelAr: "تحت التحصيل بالبنك", labelEn: "At the bank for collection" },
  { code: "collected", labelAr: "محصل", labelEn: "Collected" },
  { code: "bounced", labelAr: "مرتد", labelEn: "Bounced" },
  { code: "replaced", labelAr: "مستبدل", labelEn: "Replaced" },
] as const;

export function getChequeStatusLabel(status: ChequeStatus, locale = "ar"): string {
  const def = CHEQUE_STATUS_DEFINITIONS.find((d) => d.code === status);
  if (!def) return status;
  return locale === "en" ? def.labelEn : def.labelAr;
}

export function getChequeDirectionLabel(direction: ChequeDirection, locale = "ar"): string {
  const def = CHEQUE_DIRECTION_DEFINITIONS.find((d) => d.code === direction);
  if (!def) return direction;
  return locale === "en" ? def.labelEn : def.labelAr;
}

/**
 * Control accounts a cheque posts against, resolved by the caller from the
 * chart of accounts (mirrors `CreateVoucherCommand.treasuryGlAccountId` /
 * `counterpartyGlAccountId` — the domain never hardcodes account codes).
 *
 * `underCollectionAccountId` is the "شيكات تحت التحصيل" bucket (COA 1320 for
 * incoming cheques) or the equivalent "cheques payable" liability control for
 * outgoing ones. `bouncedAccountId` (COA 1360 "شيكات مرتجعة") is still
 * stored but no longer posted to: a bounce in either direction reverses the
 * creation posting onto the party's own control account (D192), because a
 * debt parked on an account with no party on it is invisible to the aging,
 * the statement and the credit limit.
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
  /**
   * WHO moved the cheque, beside WHEN (D80). The lifecycle recorded seven
   * states and no attribution, so a bounced customer cheque could not be
   * traced to the clerk who took it to the bank — and «مين استلم الشيك ده؟» is
   * the first question asked when one comes back.
   *
   * Optional because storage does not carry these columns yet (see
   * `packages/persistence/src/cheque-repository.ts`); a row read back from
   * SQLite has them absent rather than wrong.
   */
  readonly createdBy?: string | null;
  readonly depositedBy?: string | null;
  readonly collectedBy?: string | null;
  readonly bouncedBy?: string | null;
  /** The actor who replaced this (bounced) cheque — not to be confused with `replacedByChequeId`. */
  readonly replacedBy?: string | null;
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

const UNDONE_CHEQUE_STATUSES: ReadonlySet<ChequeStoredStatus> = new Set<ChequeStoredStatus>(["bounced", "replaced"]);

export interface ChequeLedgerDays {
  readonly raised: string;
  readonly undone: string | null;
}

export function chequeLedgerDays(
  cheque: Pick<Cheque, "status" | "issueDate" | "creationJournalEntryId" | "bounceJournalEntryId" | "bouncedAt">,
  entryDate: (entryId: string) => string | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): ChequeLedgerDays {
  const raised = (cheque.creationJournalEntryId ? entryDate(cheque.creationJournalEntryId) : undefined) ?? cheque.issueDate;
  if (!UNDONE_CHEQUE_STATUSES.has(cheque.status)) return { raised, undone: null };
  const undone = (cheque.bounceJournalEntryId ? entryDate(cheque.bounceJournalEntryId) : undefined) ?? (cheque.bouncedAt ? toTenantDay(cheque.bouncedAt, timeZone) : raised);
  return { raised, undone };
}
