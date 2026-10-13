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
 *   - bounce   (incoming): Dr counterparty (AR) / Cr underCollection
 *              (outgoing): Dr underCollection / Cr counterparty (AP)
 *              Either way the creation entry is reversed and every invoice
 *              allocation the cheque carried is undone, so the invoices it
 *              settled are open again and the party sub-ledger, the aging
 *              ladder and the control account move together (D192).
 *   - replace  (incoming only — see below): Dr underCollection / Cr
 *              counterparty (AR) — the replacement is a fresh receipt against
 *              the customer; an outgoing replacement is just a fresh
 *              `create()` referencing the old id.
 */

import { Money } from "../money/index.js";
import type { JournalEntry } from "../journal.js";
import { postJournalEntry, reverseJournalEntry, ReversalDateBeforeOriginalError, type JournalLineInput, type JournalPostingDeps } from "../gl/index.js";
import { carryingBaseOf, convertFromBase, shareOfBase } from "../exchange-rates/convert.js";
import type {
  Cheque,
  ChequeControlAccounts,
  ChequeDirection,
  ChequeRepository,
  ChequeStatus,
  ChequeStoredStatus,
} from "./cheque.js";
import { ChequeAction, assertChequeTransition, effectiveChequeStatus } from "./status.js";
import {
  DuplicateChequeNumberError,
  ChequeNotFoundError,
  InvalidChequeCommandError,
  ReplacementAmountMismatchError,
  ChequeBankRateMissingError,
} from "./errors.js";
import {
  allocate as allocateFn,
  laterDay,
  reverseAllocation as reverseAllocationFn,
  type AllocatableInvoiceRepository,
  type AllocationRepository,
  type InvoiceReturnCreditPort,
  type VoucherAllocation,
} from "../vouchers/allocation.js";
import type { AllocationInvoiceKind } from "../vouchers/voucher-types.js";
import { laterAllocationDay } from "../vouchers/allocation-day.js";
import { InvoiceNotFoundError } from "../vouchers/errors.js";
import { FX_REALISED_LINE_MEMO, allocationUndoDay, postRealisedFx, reverseRealisedFx, settlementRatesFor, type RealisedFxPort, type SettlingLine, type SettlingMoney } from "../vouchers/realised-fx.js";

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

export interface ReturnCollectedChequeCommand extends BounceChequeCommand {
  readonly collectionReversalId: string;
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

export interface AllocateChequeCommand {
  readonly chequeId: string;
  readonly allocationId: string;
  readonly invoiceId: string;
  readonly amount: Money;
  readonly now?: string;
  readonly date?: string;
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
  /**
   * The invoice allocation sub-ledger vouchers apply against. A cheque's
   * allocations are keyed by the cheque id in the same store, so an invoice's
   * settled total covers both. `settlement` projects that total back onto the
   * invoice document, exactly as `VoucherServiceDeps.settlement` does (D1).
   */
  readonly allocation?: {
    readonly allocations: AllocationRepository;
    readonly invoices: AllocatableInvoiceRepository;
    /** Confirmed return credit per invoice, so a cheque is never applied to debt a return cleared (D242). */
    readonly returns?: InvoiceReturnCreditPort;
    readonly settlement?: {
      applySettled(input: { invoiceId: string; kind: AllocationInvoiceKind; settled: Money }): Promise<void>;
    };
  };
  readonly raisedBy?: ChequeRaisingDocumentPort;
  /** Rates and accounts for the realised exchange difference a cheque settling a foreign invoice posts (D221). */
  readonly realisedFx?: RealisedFxPort;
  readonly bankLegFx?: (bankGlAccountId: string, date: string) => Promise<{ readonly currency: string; readonly fxRate: string | null } | null>;
}

/**
 * The document a cheque was raised by, when one was (a «شيك» voucher, D196).
 * Such a cheque does not credit the party itself — the voucher did — so its
 * creation posting only moves the money from the voucher's treasury leg into
 * the cheque control account, and its bounce must undo the voucher to put the
 * debt back on the party (D192).
 */
export interface ChequeRaisingDocumentPort {
  /** Called inside the bounce, after the cheque's own reversal has posted. */
  onBounced(cheque: Cheque, context: { readonly date: string; readonly actor: string }): Promise<void>;
  /** The party control account a replacement cheque must credit; null for a cheque no document raised. */
  partyControlAccountOf(cheque: Cheque): Promise<string | null>;
  /** The currency and rate the raising document's party line carries; null for a cheque no document raised. */
  partyLineOf?(cheque: Cheque): Promise<SettlingLine | null>;
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
    assertChequeTransition(cheque, ChequeAction.Deposit);
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

  private async realisedOnClearing(cheque: Cheque, bankGlAccountId: string, leg: { currency: string; fxRate: string }, date: string): Promise<JournalLineInput[]> {
    const port = this.deps.realisedFx;
    const position = cheque.bankTreasuryAccountId ? ((await port?.treasuryPosition?.(cheque.bankTreasuryAccountId, date)) ?? null) : null;
    if (!port || !position) return [];
    const foreignOut = convertFromBase(cheque.amount, leg.fxRate);
    const carried = carryingBaseOf(position, foreignOut);
    if (carried.covered.scaled === 0n) return [];
    const realised = shareOfBase(cheque.amount, carried.covered, foreignOut).scaled - carried.base.scaled;
    if (realised === 0n) return [];
    const accounts = await port.differenceAccounts();
    const amount = Money.fromScaled(realised > 0n ? realised : -realised);
    const onBank = { accountId: bankGlAccountId, memo: FX_REALISED_LINE_MEMO, currency: leg.currency, fxRate: leg.fxRate };
    return realised > 0n
      ? [{ ...onBank, debit: amount, credit: Money.zero() }, { accountId: accounts.gainAccountId, memo: FX_REALISED_LINE_MEMO, debit: Money.zero(), credit: amount }]
      : [{ accountId: accounts.lossAccountId, memo: FX_REALISED_LINE_MEMO, debit: amount, credit: Money.zero() }, { ...onBank, debit: Money.zero(), credit: amount }];
  }

  /** The bank confirms clearance: deposited → collected. Posts the cash-recognition GL entry. */
  async collect(cmd: CollectChequeCommand): Promise<Cheque> {
    const cheque = await this.require(cmd.chequeId);
    assertChequeTransition(cheque, ChequeAction.Collect);

    const collectionDate = cmd.date ?? this.now().slice(0, 10);
    const bankLeg = (await this.deps.bankLegFx?.(cmd.bankGlAccountId, collectionDate)) ?? null;
    if (bankLeg && !bankLeg.fxRate) throw new ChequeBankRateMissingError(bankLeg.currency, collectionDate);
    const bankFx = bankLeg?.fxRate ? { currency: bankLeg.currency, fxRate: bankLeg.fxRate } : {};
    const lines: JournalLineInput[] =
      cheque.direction === "incoming"
        ? [
            { accountId: cmd.bankGlAccountId, debit: cheque.amount, credit: Money.zero(), ...bankFx },
            { accountId: cheque.controlAccounts.underCollectionAccountId, debit: Money.zero(), credit: cheque.amount },
          ]
        : [
            { accountId: cheque.controlAccounts.underCollectionAccountId, debit: cheque.amount, credit: Money.zero() },
            { accountId: cmd.bankGlAccountId, debit: Money.zero(), credit: cheque.amount, ...bankFx },
            ...(bankLeg?.fxRate ? await this.realisedOnClearing(cheque, cmd.bankGlAccountId, { currency: bankLeg.currency, fxRate: bankLeg.fxRate }, collectionDate) : []),
          ];
    const entry = await postJournalEntry(
      {
        id: cmd.journalEntryId,
        date: collectionDate,
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

  /**
   * The bank rejects the cheque: deposited → bounced. Reverses the creation
   * posting, so the debt is back on the party's own control account, and
   * undoes the cheque's invoice allocations so the invoices it paid are open.
   */
  async bounce(cmd: BounceChequeCommand): Promise<Cheque> {
    return this.deps.cheques.transaction(async () => {
      const cheque = await this.require(cmd.chequeId);
      assertChequeTransition(cheque, ChequeAction.Bounce);
      return this.postBounce(cheque, cmd, cmd.date ?? this.now().slice(0, 10));
    });
  }

  async returnCollected(cmd: ReturnCollectedChequeCommand): Promise<Cheque> {
    return this.deps.cheques.transaction(async () => {
      const cheque = await this.require(cmd.chequeId);
      assertChequeTransition(cheque, ChequeAction.Return);
      const date = cmd.date ?? this.now().slice(0, 10);
      let restated: JournalLineInput[] = [];
      if (cheque.collectionJournalEntryId) {
        const collection = await this.deps.gl.ledger.findById(cheque.collectionJournalEntryId);
        if (collection && date < collection.date.slice(0, 10)) throw new ReversalDateBeforeOriginalError(collection.id, date, collection.date);
        if (collection) restated = await this.restatementLeavingWith(cheque, collection, date);
        await reverseJournalEntry(cheque.collectionJournalEntryId, this.deps.gl, {
          reversalId: cmd.collectionReversalId,
          date,
          memo: `ردّ البنك للشيك المحصَّل رقم ${cheque.chequeNumber}`,
        });
      }
      return this.postBounce(cheque, cmd, date, restated);
    });
  }

  private async restatementLeavingWith(cheque: Cheque, collection: JournalEntry, date: string): Promise<JournalLineInput[]> {
    const port = this.deps.realisedFx;
    if (cheque.direction !== "incoming" || !cheque.bankTreasuryAccountId || !port?.treasuryRevaluationShare) return [];
    const bankLine = collection.lines.find((line) => line.fxRate && line.currency && line.debit.scaled > 0n);
    if (!bankLine?.fxRate || !bankLine.currency) return [];
    const foreign = convertFromBase(cheque.amount, bankLine.fxRate);
    const share = (await port.treasuryRevaluationShare(cheque.bankTreasuryAccountId, foreign, collection.date.slice(0, 10), date)).scaled;
    if (share === 0n) return [];
    const accounts = await port.differenceAccounts();
    const amount = Money.fromScaled(share > 0n ? share : -share);
    const onBank = { accountId: bankLine.accountId, memo: FX_REALISED_LINE_MEMO, currency: bankLine.currency, fxRate: bankLine.fxRate };
    return share > 0n
      ? [{ accountId: accounts.lossAccountId, memo: FX_REALISED_LINE_MEMO, debit: amount, credit: Money.zero() }, { ...onBank, debit: Money.zero(), credit: amount }]
      : [{ ...onBank, debit: amount, credit: Money.zero() }, { accountId: accounts.gainAccountId, memo: FX_REALISED_LINE_MEMO, debit: Money.zero(), credit: amount }];
  }

  private async postBounce(cheque: Cheque, cmd: BounceChequeCommand, date: string, restated: readonly JournalLineInput[] = []): Promise<Cheque> {
    {
      const lines: JournalLineInput[] =
        cheque.direction === "incoming"
          ? [
              { accountId: cheque.counterpartyGlAccountId, debit: cheque.amount, credit: Money.zero() },
              { accountId: cheque.controlAccounts.underCollectionAccountId, debit: Money.zero(), credit: cheque.amount },
              ...restated,
            ]
          : [
              { accountId: cheque.controlAccounts.underCollectionAccountId, debit: cheque.amount, credit: Money.zero() },
              { accountId: cheque.counterpartyGlAccountId, debit: Money.zero(), credit: cheque.amount },
            ];

      const entry = await postJournalEntry(
        {
          id: cmd.journalEntryId,
          date,
          memo: `ارتداد شيك رقم ${cheque.chequeNumber}`,
          source: "system",
          sourceDocType: "CHEQUE",
          sourceDocId: cheque.id,
          sourceDocNumber: cheque.chequeNumber,
          lines,
        },
        this.deps.gl,
      );
      await this.releaseAllocations(cheque.id, date);

      const updated: Cheque = {
        ...cheque,
        status: "bounced",
        bouncedAt: this.now(),
        bouncedBy: this.actorOf(cmd),
        bounceJournalEntryId: entry.id,
      };
      await this.deps.cheques.update(updated);
      await this.deps.raisedBy?.onBounced(updated, { date, actor: this.actorOf(cmd) });
      return updated;
    }
  }

  /**
   * Apply part or all of a live cheque against one of its party's open
   * invoices: an incoming cheque against a sales invoice, an outgoing one
   * against a purchase invoice. Moves no GL — the creation entry already
   * moved the control account; this only says which invoice the money is for.
   */
  async laterAllocationDay(chequeId: string, invoiceId: string, requested?: string | null): Promise<string> {
    const cheque = await this.require(chequeId);
    const store = this.allocationStore();
    const invoice = await store.invoices.findById(invoiceId);
    if (!invoice) throw new InvoiceNotFoundError(invoiceId);
    const earlierAllocations = [...(await store.allocations.listByVoucher(cheque.id)), ...(await store.allocations.listByInvoice(invoice.id))];
    const raisedLine = (await this.deps.raisedBy?.partyLineOf?.(cheque)) ?? null;
    const booked = await this.deps.realisedFx?.invoiceFx(invoice.id, invoice.kind);
    const currencies = new Set([...(raisedLine?.fxRate && raisedLine.currency ? [raisedLine.currency] : []), ...(booked ? [booked.currency] : [])]);
    return laterAllocationDay({ requested, moneyDay: cheque.issueDate, invoiceDay: invoice.date, currencies, earlierAllocations }, { periods: this.deps.gl.periods, ledger: this.deps.gl.ledger, vatFilings: this.deps.gl.vatFilings });
  }

  async allocate(cmd: AllocateChequeCommand): Promise<VoucherAllocation> {
    const store = this.allocationStore();
    return this.deps.cheques.transaction(async () => {
      const cheque = await this.require(cmd.chequeId);
      if (cheque.status === "bounced" || cheque.status === "replaced") {
        throw new InvalidChequeCommandError(
          "لا يمكن تخصيص شيك مرتد على فاتورة.",
          "A bounced cheque cannot be allocated to an invoice.",
        );
      }
      const realisedFx = this.deps.realisedFx;
      // A standalone cheque credits the party in base; one a voucher raised
      // settles in whatever the voucher's own party line carried.
      const raisedLine = (await this.deps.raisedBy?.partyLineOf?.(cheque)) ?? null;
      const money: SettlingMoney = raisedLine?.fxRate
        ? { currency: raisedLine.currency, fxRate: raisedLine.fxRate, date: cheque.issueDate }
        : { currency: cheque.currency, fxRate: null, date: cheque.issueDate };
      const result = await allocateFn(
        {
          allocationId: cmd.allocationId,
          voucherId: cheque.id,
          voucherAmount: cheque.amount,
          voucherPartyId: cheque.partyId,
          expectedKind: cheque.direction === "incoming" ? "sales" : "purchase",
          invoiceId: cmd.invoiceId,
          amount: cmd.amount,
          now: cmd.now ?? this.now(),
          date: laterDay(cmd.date ?? (cmd.now ?? this.now()).slice(0, 10), cheque.issueDate),
          ...(realisedFx
            ? {
                rates: (invoice) => settlementRatesFor(realisedFx, invoice, money),
                unconsumedShare: async (invoice) => (await realisedFx.revaluationShare?.(invoice)) ?? Money.zero(),
                unconsumedMoneyShare: async () => (raisedLine?.fxRate ? ((await realisedFx.moneyRevaluationShare?.(cheque.id)) ?? Money.zero()) : Money.zero()),
                beforeSave: async (invoice, split, date) => {
                  const booked = await realisedFx.invoiceFx(invoice.id, invoice.kind);
                  const rates = await settlementRatesFor(realisedFx, invoice, money);
                  if (!booked || !rates) return { fxEntryId: null };
                  // A cheque a voucher raised sits on the voucher's treasury
                  // leg; the party's own control account is the voucher's.
                  const controlAccountId =
                    (await this.deps.raisedBy?.partyControlAccountOf(cheque)) ?? cheque.counterpartyGlAccountId;
                  const fxEntryId = await postRealisedFx(
                    {
                      allocationId: cmd.allocationId,
                      invoice,
                      split,
                      currency: booked.currency,
                      invoiceRate: booked.fxRate,
                      money,
                      date: date ?? cheque.issueDate,
                      controlAccountId,
                      branchId: cheque.branchId,
                      reference: cheque.chequeNumber,
                    },
                    realisedFx,
                    this.deps.gl,
                  );
                  return { fxEntryId };
                },
              }
            : {}),
        },
        store,
      );
      await this.projectSettlement(result.invoice);
      return result.allocation;
    });
  }

  async listAllocations(chequeId: string): Promise<readonly VoucherAllocation[]> {
    if (!this.deps.allocation) return [];
    return this.deps.allocation.allocations.listByVoucher(chequeId);
  }

  private allocationStore() {
    if (!this.deps.allocation) {
      throw new InvalidChequeCommandError(
        "تخصيص الشيكات على الفواتير غير مُفعّل على هذا الخادم.",
        "Allocating cheques to invoices is not enabled on this server.",
      );
    }
    return { allocations: this.deps.allocation.allocations, invoices: this.deps.allocation.invoices, returns: this.deps.allocation.returns };
  }

  private async releaseAllocations(chequeId: string, date: string): Promise<void> {
    if (!this.deps.allocation) return;
    const store = { allocations: this.deps.allocation.allocations, invoices: this.deps.allocation.invoices };
    const active = (await store.allocations.listByVoucher(chequeId)).filter((a) => a.status === "active");
    for (const alloc of active) {
      const undoneOn = await allocationUndoDay(alloc, date, this.deps.gl.ledger);
      await reverseRealisedFx(alloc, this.deps.gl, undoneOn);
      const undone = await reverseAllocationFn(alloc.id, this.now(), store, undoneOn);
      await this.projectSettlement(undone.invoice);
    }
  }

  private async projectSettlement(invoice: { id: string; kind: AllocationInvoiceKind; allocated: Money } | null): Promise<void> {
    const settlement = this.deps.allocation?.settlement;
    if (!invoice || !settlement) return;
    await settlement.applySettled({ invoiceId: invoice.id, kind: invoice.kind, settled: invoice.allocated });
  }

  /**
   * Replace a bounced cheque with a new one of the same amount: bounced →
   * replaced (old), creates a fresh `pending` cheque linked both ways. The
   * bounce already put the debt back on AR, so the replacement credits AR
   * again, exactly like receiving any new cheque. Incoming only; an outgoing
   * replacement should call `createCheque` directly instead (see class doc).
   */
  async replace(cmd: ReplaceChequeCommand): Promise<{ original: Cheque; replacement: Cheque }> {
    const original = await this.require(cmd.bouncedChequeId);
    assertChequeTransition(original, ChequeAction.Replace);
    if (original.direction !== "incoming") {
      throw new InvalidChequeCommandError(
        `لا يمكن استبدال الشيك الصادر "${original.id}" عبر هذه العملية؛ أنشئ شيكاً جديداً بدلاً من ذلك.`,
        `Outgoing cheque "${original.id}" cannot be replaced via replace(); create a new cheque instead.`,
      );
    }
    const amount = cmd.newCheque.amount ?? original.amount;
    if (!amount.equals(original.amount)) {
      throw new ReplacementAmountMismatchError(original.id);
    }
    // The number must be free BEFORE the receipt entry posts: storage
    // enforces UNIQUE(direction, cheque_number), so a clash discovered at save
    // time would leave the AR to 1320 journal entry committed with no cheque.
    const clash = await this.deps.cheques.findByChequeNumber("incoming", cmd.newCheque.chequeNumber);
    if (clash) throw new DuplicateChequeNumberError("incoming", cmd.newCheque.chequeNumber);

    // A replacement is a fresh receipt from the customer, so it credits their
    // control account even when the bounced cheque had been raised by a
    // voucher and only reclassified that voucher's treasury leg.
    const counterpartyGlAccountId = (await this.deps.raisedBy?.partyControlAccountOf(original)) ?? original.counterpartyGlAccountId;
    const entry = await postJournalEntry(
      {
        id: cmd.journalEntryId,
        date: cmd.date ?? this.now().slice(0, 10),
        memo: `استبدال شيك مرتد رقم ${original.chequeNumber} بشيك رقم ${cmd.newCheque.chequeNumber}`,
        source: "system",
        sourceDocType: "CHEQUE",
        lines: [
          { accountId: original.controlAccounts.underCollectionAccountId, debit: amount, credit: Money.zero() },
          { accountId: counterpartyGlAccountId, debit: Money.zero(), credit: amount },
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
      counterpartyGlAccountId,
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
