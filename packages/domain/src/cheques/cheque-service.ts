/**
 * ChequeService — the cheque-register application service (docs/archive/catalog/04
 * "سجل الشيكات").
 *
 * Unlike vouchers, cheques do NOT go through the generic `DocumentService`
 * draft→confirm lifecycle — their 7-state lifecycle (see status.ts) doesn't
 * map onto that framework's fixed draft/confirmed/reversed states. Instead
 * this service owns its own state machine and posts each GL-triggering
 * transition directly through the REAL GL posting engine
 * (`postJournalEntry` from `../gl/index.js`), exactly the engine vouchers and
 * sales invoices post through — only the orchestration around it differs.
 *
 * GL postings per transition (docs/archive/catalog/04 → COA 1320/1360 for incoming
 * cheques; `ChequeControlAccounts` is caller-resolved, mirroring how
 * `CreateVoucherCommand` takes explicit GL account ids rather than the domain
 * hardcoding codes):
 *   - create   (incoming): Dr underCollection / Cr counterparty (AR)
 *              (outgoing): Dr counterparty (AP) / Cr underCollection
 *   - deposit  : status-only (records which bank treasury account the cheque
 *              was handed to) — no GL entry; still the same instrument.
 *   - collect  (incoming): Dr bank treasury GL account / Cr underCollection
 *              (outgoing): Dr underCollection / Cr bank treasury GL account
 *   - bounce   (incoming): Dr bouncedAccount / Cr underCollection
 *              (outgoing): Dr underCollection / Cr counterparty (reverses the
 *                          original posting — an outgoing bounce means we
 *                          never actually paid, so the AP obligation returns)
 *   - replace  (incoming only — see below): Dr underCollection (new cheque) /
 *              Cr bouncedAccount (closing the bounced one); an outgoing
 *              replacement is just a fresh `create()` referencing the old id.
 */

import { Money } from "../money/index.js";
import { postJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import type {
  Cheque,
  ChequeControlAccounts,
  ChequeDirection,
  ChequeRepository,
  ChequeStatus,
  ChequeStoredStatus,
} from "./cheque.js";
import { assertChequeTransition, effectiveChequeStatus } from "./status.js";
import {
  DuplicateChequeNumberError,
  ChequeNotFoundError,
  InvalidChequeCommandError,
  MissingBouncedAccountError,
  ReplacementAmountMismatchError,
} from "./errors.js";

export interface CreateChequeCommand {
  readonly id: string;
  readonly direction: ChequeDirection;
  readonly chequeNumber: string;
  readonly bankName: string;
  readonly bankBranchName?: string | null;
  readonly bankAccountNumber?: string | null;
  readonly amount: Money;
  readonly currency?: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly branchId: string;
  readonly notes?: string | null;
  readonly partyId: string;
  readonly counterpartyGlAccountId: string;
  readonly controlAccounts: ChequeControlAccounts;
  /** Id for the creation journal entry (domain stays pure — caller supplies ids). */
  readonly journalEntryId: string;
  readonly replacesChequeId?: string | null;
  /**
   * The RESOLVED acting user (D80). Every transition below takes one, and it
   * is recorded on the cheque so the register can answer who did what.
   */
  readonly actor?: string;
}

export interface DepositChequeCommand {
  readonly chequeId: string;
  readonly bankTreasuryAccountId: string;
  readonly date?: string;
  readonly actor?: string;
}

export interface CollectChequeCommand {
  readonly chequeId: string;
  /** The bank treasury account's GL account (resolved by the caller from `TreasuryAccountRepository`). */
  readonly bankGlAccountId: string;
  readonly journalEntryId: string;
  readonly date?: string;
  readonly actor?: string;
}

export interface BounceChequeCommand {
  readonly chequeId: string;
  readonly journalEntryId: string;
  readonly date?: string;
  readonly actor?: string;
}

export interface ReplaceChequeCommand {
  readonly bouncedChequeId: string;
  /** New cheque's own id + physical details — same amount as the bounced one. */
  readonly newCheque: Omit<CreateChequeCommand, "direction" | "partyId" | "counterpartyGlAccountId" | "controlAccounts" | "amount" | "replacesChequeId" | "journalEntryId"> & {
    readonly amount?: Money;
  };
  readonly journalEntryId: string;
  readonly date?: string;
  readonly actor?: string;
}

export interface ChequeListQuery {
  readonly direction?: ChequeDirection;
  /** The DERIVED (7-state) status — see `effectiveChequeStatus`. */
  readonly status?: ChequeStatus;
  readonly fromDate?: string;
  readonly toDate?: string;
  /** "as of" date for deriving pending/under_collection/due_today; defaults to today. */
  readonly asOfDate?: string;
}

export interface ChequeServiceDeps {
  readonly cheques: ChequeRepository;
  readonly gl: JournalPostingDeps;
  readonly now?: () => string;
  /**
   * Fallback actor for a caller that does not name one per command — the same
   * shape `VoucherServiceDeps.actor` and `SalesInvoiceServiceDeps.actor` take.
   */
  readonly actor?: string;
}

export class ChequeService {
  constructor(private readonly deps: ChequeServiceDeps) {}

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  /**
   * WHO is doing this. Never a value the client named directly — the routes
   * read it off the resolved session (cheques-routes.ts), which is what makes
   * the attribution worth having (D80).
   */
  private actorOf(cmd: { readonly actor?: string }): string {
    return cmd.actor ?? this.deps.actor ?? "system";
  }

  /** Record a newly received/issued cheque: status "pending", posts its creation GL entry. */
  async createCheque(cmd: CreateChequeCommand): Promise<Cheque> {
    const existing = await this.deps.cheques.findByChequeNumber(cmd.direction, cmd.chequeNumber);
    if (existing) throw new DuplicateChequeNumberError(cmd.direction, cmd.chequeNumber);

    const currency = cmd.currency ?? "EGP";
    const entry = await this.postCreation(cmd);

    const cheque: Cheque = {
      id: cmd.id,
      direction: cmd.direction,
      status: "pending",
      chequeNumber: cmd.chequeNumber,
      bankName: cmd.bankName,
      bankBranchName: cmd.bankBranchName ?? null,
      bankAccountNumber: cmd.bankAccountNumber ?? null,
      amount: cmd.amount,
      currency,
      issueDate: cmd.issueDate,
      dueDate: cmd.dueDate,
      branchId: cmd.branchId,
      notes: cmd.notes ?? null,
      partyId: cmd.partyId,
      counterpartyGlAccountId: cmd.counterpartyGlAccountId,
      controlAccounts: cmd.controlAccounts,
      bankTreasuryAccountId: null,
      createdAt: this.now(),
      depositedAt: null,
      collectedAt: null,
      bouncedAt: null,
      replacesChequeId: cmd.replacesChequeId ?? null,
      replacedByChequeId: null,
      creationJournalEntryId: entry.id,
      collectionJournalEntryId: null,
      bounceJournalEntryId: null,
      createdBy: this.actorOf(cmd),
      depositedBy: null,
      collectedBy: null,
      bouncedBy: null,
      replacedBy: null,
    };
    await this.deps.cheques.save(cheque);
    return cheque;
  }

  private async postCreation(cmd: CreateChequeCommand) {
    const lines =
      cmd.direction === "incoming"
        ? [
            { accountId: cmd.controlAccounts.underCollectionAccountId, debit: cmd.amount, credit: Money.zero() },
            { accountId: cmd.counterpartyGlAccountId, debit: Money.zero(), credit: cmd.amount },
          ]
        : [
            { accountId: cmd.counterpartyGlAccountId, debit: cmd.amount, credit: Money.zero() },
            { accountId: cmd.controlAccounts.underCollectionAccountId, debit: Money.zero(), credit: cmd.amount },
          ];
    return postJournalEntry(
      {
        id: cmd.journalEntryId,
        date: cmd.issueDate,
        memo: `شيك ${cmd.direction === "incoming" ? "وارد" : "صادر"} رقم ${cmd.chequeNumber}`,
        source: "system",
        sourceDocType: "CHEQUE",
        sourceDocId: cmd.id,
        sourceDocNumber: cmd.chequeNumber,
        lines,
      },
      this.deps.gl,
    );
  }

  /** Hand the cheque to the bank for collection: pending → deposited. No GL entry. */
  async deposit(cmd: DepositChequeCommand): Promise<Cheque> {
    const cheque = await this.require(cmd.chequeId);
    assertChequeTransition(cheque, "deposit");
    const updated: Cheque = {
      ...cheque,
      status: "deposited",
      bankTreasuryAccountId: cmd.bankTreasuryAccountId,
      depositedAt: this.now(),
      depositedBy: this.actorOf(cmd),
    };
    await this.deps.cheques.update(updated);
    return updated;
  }

  /** The bank confirms clearance: deposited → collected. Posts the cash-recognition GL entry. */
  async collect(cmd: CollectChequeCommand): Promise<Cheque> {
    const cheque = await this.require(cmd.chequeId);
    assertChequeTransition(cheque, "collect");

    const lines =
      cheque.direction === "incoming"
        ? [
            { accountId: cmd.bankGlAccountId, debit: cheque.amount, credit: Money.zero() },
            { accountId: cheque.controlAccounts.underCollectionAccountId, debit: Money.zero(), credit: cheque.amount },
          ]
        : [
            { accountId: cheque.controlAccounts.underCollectionAccountId, debit: cheque.amount, credit: Money.zero() },
            { accountId: cmd.bankGlAccountId, debit: Money.zero(), credit: cheque.amount },
          ];
    const entry = await postJournalEntry(
      {
        id: cmd.journalEntryId,
        date: cmd.date ?? this.now().slice(0, 10),
        memo: `تحصيل شيك رقم ${cheque.chequeNumber}`,
        source: "system",
        sourceDocType: "CHEQUE",
        sourceDocId: cheque.id,
        sourceDocNumber: cheque.chequeNumber,
        lines,
      },
      this.deps.gl,
    );

    const updated: Cheque = {
      ...cheque,
      status: "collected",
      collectedAt: this.now(),
      collectedBy: this.actorOf(cmd),
      collectionJournalEntryId: entry.id,
    };
    await this.deps.cheques.update(updated);
    return updated;
  }

  /** The bank rejects the cheque: deposited → bounced. Posts the bad-debt reclassification entry. */
  async bounce(cmd: BounceChequeCommand): Promise<Cheque> {
    const cheque = await this.require(cmd.chequeId);
    assertChequeTransition(cheque, "bounce");

    let lines;
    if (cheque.direction === "incoming") {
      const bouncedAccountId = cheque.controlAccounts.bouncedAccountId;
      if (!bouncedAccountId) throw new MissingBouncedAccountError(cheque.id);
      lines = [
        { accountId: bouncedAccountId, debit: cheque.amount, credit: Money.zero() },
        { accountId: cheque.controlAccounts.underCollectionAccountId, debit: Money.zero(), credit: cheque.amount },
      ];
    } else {
      lines = [
        { accountId: cheque.controlAccounts.underCollectionAccountId, debit: cheque.amount, credit: Money.zero() },
        { accountId: cheque.counterpartyGlAccountId, debit: Money.zero(), credit: cheque.amount },
      ];
    }

    const entry = await postJournalEntry(
      {
        id: cmd.journalEntryId,
        date: cmd.date ?? this.now().slice(0, 10),
        memo: `ارتداد شيك رقم ${cheque.chequeNumber}`,
        source: "system",
        sourceDocType: "CHEQUE",
        sourceDocId: cheque.id,
        sourceDocNumber: cheque.chequeNumber,
        lines,
      },
      this.deps.gl,
    );

    const updated: Cheque = {
      ...cheque,
      status: "bounced",
      bouncedAt: this.now(),
      bouncedBy: this.actorOf(cmd),
      bounceJournalEntryId: entry.id,
    };
    await this.deps.cheques.update(updated);
    return updated;
  }

  /**
   * Replace a bounced cheque with a new one of the same amount: bounced →
   * replaced (old), creates a fresh `pending` cheque linked both ways.
   * Incoming only reclassifies 1360 → 1320 for the new cheque; an outgoing
   * replacement should call `createCheque` directly instead (see class doc).
   */
  async replace(cmd: ReplaceChequeCommand): Promise<{ original: Cheque; replacement: Cheque }> {
    const original = await this.require(cmd.bouncedChequeId);
    assertChequeTransition(original, "replace");
    if (original.direction !== "incoming") {
      throw new InvalidChequeCommandError(`Outgoing cheque "${original.id}" cannot be replaced via replace(); create a new cheque instead.`);
    }
    const amount = cmd.newCheque.amount ?? original.amount;
    if (!amount.equals(original.amount)) {
      throw new ReplacementAmountMismatchError(original.id);
    }
    // The number must be free BEFORE the reclassification entry posts: storage
    // enforces UNIQUE(direction, cheque_number), so a clash discovered at save
    // time would leave the 1360 to 1320 journal entry committed with no cheque.
    const clash = await this.deps.cheques.findByChequeNumber("incoming", cmd.newCheque.chequeNumber);
    if (clash) throw new DuplicateChequeNumberError("incoming", cmd.newCheque.chequeNumber);
    const bouncedAccountId = original.controlAccounts.bouncedAccountId;
    if (!bouncedAccountId) throw new MissingBouncedAccountError(original.id);

    const entry = await postJournalEntry(
      {
        id: cmd.journalEntryId,
        date: cmd.date ?? this.now().slice(0, 10),
        memo: `استبدال شيك مرتد رقم ${original.chequeNumber} بشيك رقم ${cmd.newCheque.chequeNumber}`,
        source: "system",
        sourceDocType: "CHEQUE",
        lines: [
          { accountId: original.controlAccounts.underCollectionAccountId, debit: amount, credit: Money.zero() },
          { accountId: bouncedAccountId, debit: Money.zero(), credit: amount },
        ],
      },
      this.deps.gl,
    );

    const replacement: Cheque = {
      id: cmd.newCheque.id,
      direction: "incoming",
      status: "pending",
      chequeNumber: cmd.newCheque.chequeNumber,
      bankName: cmd.newCheque.bankName,
      bankBranchName: cmd.newCheque.bankBranchName ?? null,
      bankAccountNumber: cmd.newCheque.bankAccountNumber ?? null,
      amount,
      currency: original.currency,
      issueDate: cmd.newCheque.issueDate,
      dueDate: cmd.newCheque.dueDate,
      branchId: cmd.newCheque.branchId,
      notes: cmd.newCheque.notes ?? null,
      partyId: original.partyId,
      counterpartyGlAccountId: original.counterpartyGlAccountId,
      controlAccounts: original.controlAccounts,
      bankTreasuryAccountId: null,
      createdAt: this.now(),
      depositedAt: null,
      collectedAt: null,
      bouncedAt: null,
      replacesChequeId: original.id,
      replacedByChequeId: null,
      creationJournalEntryId: entry.id,
      collectionJournalEntryId: null,
      bounceJournalEntryId: null,
      createdBy: this.actorOf(cmd),
      depositedBy: null,
      collectedBy: null,
      bouncedBy: null,
      replacedBy: null,
    };
    await this.deps.cheques.save(replacement);

    const updatedOriginal: Cheque = {
      ...original,
      status: "replaced",
      replacedByChequeId: replacement.id,
      replacedBy: this.actorOf(cmd),
    };
    await this.deps.cheques.update(updatedOriginal);

    return { original: updatedOriginal, replacement };
  }

  async findById(id: string): Promise<Cheque | null> {
    return this.deps.cheques.findById(id);
  }

  /** List cheques, filtering on the DERIVED 7-state status as of `asOfDate` (defaults to today via `now()`). */
  async list(query: ChequeListQuery = {}): Promise<readonly Cheque[]> {
    const { direction, status, fromDate, toDate, asOfDate } = query;
    const isDerivedOnly = status === "pending" || status === "under_collection" || status === "due_today";
    const rows = await this.deps.cheques.list({
      direction,
      fromDate,
      toDate,
      status: status && !isDerivedOnly ? (status as ChequeStoredStatus) : undefined,
    });
    if (!status) return rows;
    const asOf = asOfDate ?? this.now().slice(0, 10);
    return rows.filter((c) => effectiveChequeStatus(c, asOf) === status);
  }

  private async require(id: string): Promise<Cheque> {
    const cheque = await this.deps.cheques.findById(id);
    if (!cheque) throw new ChequeNotFoundError(id);
    return cheque;
  }
}
