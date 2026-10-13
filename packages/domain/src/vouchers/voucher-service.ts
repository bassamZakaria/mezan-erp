/**
 * VoucherService — the treasury-voucher application service.
 *
 * It composes the generic {@link DocumentService} (numbering + workflow gate +
 * GL posting + audit + lifecycle) with the two voucher-specific concerns the
 * framework can't own: the cash-negative guard (needs the live ledger balance)
 * and invoice allocation. The GL hook posts each voucher's balanced two-line
 * entry through the REAL GL posting engine as a "system" source; the numbering
 * hook stamps the CV- number. Everything the framework already does — the draft
 * → confirmed → reversed lifecycle, the workflow gate, audit, events — is reused
 * unchanged.
 */

import { postJournalEntry, reverseJournalEntry, type JournalPostingDeps } from "../gl/index.js";
import type { LedgerRepository } from "../gl/ledger.js";
import type { AccountRepository } from "../accounts/account.js";
import { laterAllocationDay } from "./allocation-day.js";
import type { FiscalPeriodRepository } from "../fiscal-periods/fiscal-period.js";
import { NextNumberService } from "../numbering/index.js";
import type { AuditSink } from "../audit/index.js";
import type { ApprovalRequestRepository, GateConfig, GateableActionType } from "../workflow/index.js";
import type { TreasuryAccountRepository } from "../treasury-accounts/treasury-account.js";
import type { SettingsRepository } from "../settings/ports.js";
import {
  DocumentService,
  type DocumentEventPublisher,
  type DocumentGlHook,
  type DocumentListFilter,
  type FrameworkDocument,
} from "../documents/index.js";
import { createDocumentWorkflowGate } from "../documents/journal-document.js";
import {
  voucherBaseAmount,
  isStandingVoucher,
  voucherTakesAllocations,
  voucherNetPaid,
  type TreasuryLegFx,
  voucherDocumentType,
  voucherLine,
  type HeldAllocationRequest,
  type VoucherDocument,
  type VoucherLine,
} from "./voucher-document.js";
import { InvalidDocumentError } from "../documents/errors.js";
import { BASE_CURRENCY } from "../exchange-rates/exchange-rate.js";
import { carryingBaseOf, convertFromBase, shareOfBase } from "../exchange-rates/convert.js";
import {
  REFUNDED_MONEY,
  getVoucherTypeDefinition,
  type AllocationInvoiceKind,
  type VoucherType,
} from "./voucher-types.js";
import { assertCashBalanceAllows } from "./cash-guard.js";
import {
  allocate as allocateFn,
  invoiceOpenBalance,
  laterDay,
  returnedByInvoice,
  reverseAllocation as reverseAllocationFn,
  settlementSplit,
  sumActive,
  summarize,
  type AllocatableInvoiceRepository,
  type AllocationRepository,
  type AllocationSummary,
  type InvoiceReturnCreditPort,
  type SettlementSplit,
  type VoucherAllocation,
  FxOpenItemType,
} from "./allocation.js";
import {
  AllocationCurrencyMismatchError,
  HeldAllocationRefusal,
  HeldAllocationRefusedError,
  InvoiceNotFoundError,
  VoucherNotAllocatableError,
  VoucherNotConfirmedError,
  VoucherReversedError,
  VoucherTreasuryCurrencyMismatchError,
} from "./errors.js";
import { allocationUndoDay, postRealisedFx, reverseRealisedFx, settlementRatesFor, type RealisedFxPort, type SettlingMoney } from "./realised-fx.js";
import { Money } from "../money/index.js";

/** GL hook binding the REAL posting engine behind the framework, tagging vouchers as "system". */
export function createVoucherGlHook(deps: JournalPostingDeps): DocumentGlHook {
  return {
    async post(posting) {
      const entry = await postJournalEntry(
        {
          id: posting.sourceDocId,
          date: posting.date,
          memo: posting.memo,
          source: "system",
          sourceDocType: posting.sourceDocType,
          sourceDocId: posting.sourceDocId,
          sourceDocNumber: posting.sourceDocNumber,
          lines: posting.lines.map((l) => ({
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            memo: l.memo ?? null,
            costCenterId: l.costCenterId ?? null,
            // Dropped here, a foreign settlement is invisible to FX
            // revaluation: the invoice stays in the open position and every
            // month-end books a phantom gain against 4900/5900 (B-5).
            currency: l.currency ?? null,
            fxRate: l.fxRate ?? null,
            projectId: l.projectId ?? null,
            costCategory: l.costCategory ?? null,
            branchId: l.branchId ?? null,
          })),
        },
        deps,
      );
      return { journalEntryId: entry.id, journalEntryNo: entry.entryNo ?? null };
    },
    async reverse(journalEntryId, opts) {
      const { reversal } = await reverseJournalEntry(journalEntryId, deps, {
        reversalId: opts.reversalId,
        date: opts.date,
        memo: opts.memo,
      });
      return { journalEntryId: reversal.id, journalEntryNo: reversal.entryNo ?? null };
    },
  };
}

/**
 * Everything a «شيك» voucher knows about the cheque it raised, handed to the
 * register when the voucher POSTS, so the paper and the money are one record
 * (D81, D196). `amount` is the base amount the voucher posted.
 */
export interface VoucherChequeRegistration {
  readonly voucherId: string;
  readonly voucherNo: string | null;
  /** A receipt voucher takes a cheque IN; a payment voucher issues one OUT. */
  readonly direction: "incoming" | "outgoing";
  /** The voucher's `referenceNo`, which is where the cheque number is typed. */
  readonly chequeNumber: string | null;
  readonly amount: Money;
  readonly currency: string;
  readonly issueDate: string;
  readonly branchId: string;
  /** Customer for an incoming cheque, supplier for an outgoing one. */
  readonly partyId: string | null;
  /** The party's control account the voucher itself settled. */
  readonly counterpartyGlAccountId: string | null;
  /** The treasury leg the voucher posted — what the cheque actually sits in until it clears. */
  readonly treasuryGlAccountId: string;
  readonly memo: string | null;
  /** The RESOLVED caller — the same attribution every cheque transition carries (D80). */
  readonly actor: string;
}

/**
 * Registers the cheque behind a «شيك» voucher. Returns the cheque's id, or null
 * when the register declined to record one. Omit the port and a cheque voucher
 * posts exactly as a cash one does and leaves the register short.
 */
export interface VoucherChequeRegistrationPort {
  register(input: VoucherChequeRegistration): Promise<{ chequeId: string } | null>;
  /**
   * True while the cheque this voucher raised is still live. Reversing the
   * voucher then would leave the cheque sitting in its control account against
   * a treasury leg that no longer exists; the cheque's own bounce is what
   * reverses such a voucher.
   */
  blocksReversal?(voucherId: string): Promise<boolean>;
}

export interface VoucherServiceDeps {
  readonly documents: import("../documents/document.js").DocumentRepository<VoucherLine>;
  readonly ledger: LedgerRepository;
  readonly accounts: Pick<AccountRepository, "findById">;
  readonly periods: JournalPostingDeps["periods"];
  readonly vatFilings?: JournalPostingDeps["vatFilings"];
  readonly numbering: NextNumberService;
  readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById">;
  readonly allocations: AllocationRepository;
  readonly invoices: AllocatableInvoiceRepository;
  /**
   * بُعد المشروع — validates a voucher line's `projectId` against the real
   * project register before posting (D-01). Absent means an older composition
   * with no project repository wired in; the posting then trusts the id as
   * given, exactly like `JournalPostingDeps.projects` upstream.
   */
  readonly projects?: JournalPostingDeps["projects"];
  /** Tenant settings source for the treasury-negative policies; absent means cash guarded, bank not. */
  readonly settings?: SettingsRepository;
  /**
   * Approved exchange rates, so a foreign-currency voucher converts to base at
   * the rate of its own date and carries that rate onto the counterparty GL
   * line (B-4/B-5). Omit it and a non-base currency is REFUSED rather than
   * posted at 1:1 — the same strict policy `confirmPurchaseInvoice` applies.
   */
  readonly exchangeRates?: { findRate(currency: string, asOfDate: string): Promise<{ rate: string } | null> };
  /** The tenant's own currency; anything else on a voucher needs an approved rate. */
  readonly baseCurrency?: string;
  /**
   * Projects an allocation back onto the source invoice document, so the
   * document and the allocation sub-ledger stay one fact rather than two (D1).
   * `settled` is the invoice's ACTIVE allocated total after the change, not a
   * delta — reversing an allocation therefore lowers it.
   */
  readonly settlement?: {
    applySettled(input: { invoiceId: string; kind: AllocationInvoiceKind; settled: Money }): Promise<void>;
  };
  /** Resolves the configured approval chain per action type (null = none → auto-grant). */
  readonly resolveGateConfig?: (actionType: GateableActionType) => GateConfig | null;
  /**
   * Persists held approval requests so a gated voucher reaches the approvals
   * inbox. Without it a configured TREASURY_VOUCHER_CONFIRM chain holds the
   * voucher with no request anyone can act on.
   */
  readonly approvalRequests?: ApprovalRequestRepository;
  readonly audit?: AuditSink;
  readonly events?: DocumentEventPublisher;
  readonly now?: () => string;
  readonly actor?: string;
  readonly actorRoles?: readonly string[];
  /** The cheque register a «شيك» voucher writes into when it posts (D81, D196). */
  readonly cheques?: VoucherChequeRegistrationPort;
  /**
   * Rates and accounts for the realised exchange difference an allocation
   * against a foreign invoice posts (D221). Omit it and a foreign invoice is
   * relieved at face base value, the difference staying on the party.
   */
  readonly realisedFx?: RealisedFxPort;
  /**
   * Confirmed return credit per invoice, so money is never applied to debt a
   * return already cleared (D242). Omit it and outstanding ignores returns.
   */
  readonly returns?: InvoiceReturnCreditPort;
  /**
   * The employee-advance sub-ledger. Reversing the voucher that paid an advance
   * out — or that took a repayment back in — mirrors the GL entry on 1160 سلف
   * الموظفين, and without this hook only the GL side moved: the advance record
   * kept a receivable the safe never funded.
   */
  readonly advanceSubLedger?: VoucherAdvanceUnwindPort;
}

export interface VoucherAdvanceUnwindPort {
  /** Undoes what this voucher did to the advance record. `false` = not an advance voucher. */
  onVoucherReversed(voucherId: string): Promise<boolean>;
}

/** All the fields needed to open a new voucher draft (one economic line + envelope). */
export interface CreateVoucherCommand {
  readonly id: string;
  readonly date: string;
  readonly memo?: string;
  readonly voucherType: VoucherType;
  readonly amount: import("../money/money.js").Money;
  readonly currency?: string;
  readonly branchId: string;
  readonly paymentMethod: VoucherLine["paymentMethod"];
  readonly treasuryAccountId: string;
  readonly treasuryGlAccountId: string;
  readonly counterpartyGlAccountId?: string | null;
  readonly counterTreasuryAccountId?: string | null;
  readonly counterTreasuryGlAccountId?: string | null;
  readonly customerId?: string | null;
  readonly supplierId?: string | null;
  readonly referenceNo?: string | null;
  readonly costCenterId?: string | null;
  readonly projectId?: string | null;
  readonly costCategory?: import("../contracting/cost-category.js").CostCategory | null;
  readonly withholdingAmount?: import("../money/money.js").Money | null;
  readonly withholdingRatePercent?: number | null;
  readonly withholdingGlAccountId?: string | null;
}

export interface CollectionAllocationRequest {
  readonly allocationId: string;
  readonly invoiceId: string;
  readonly amount?: import("../money/money.js").Money;
}

export interface CollectionResult {
  readonly document: VoucherDocument;
  readonly held: boolean;
  readonly allocations: readonly VoucherAllocation[];
  readonly heldAllocations: readonly HeldAllocationRequest[];
}

export interface ConfirmVoucherOptions {
  readonly actor?: string;
  readonly actorRoles?: readonly string[];
  readonly requestId?: string;
}

export class VoucherService {
  private readonly service: DocumentService<VoucherLine>;
  private readonly glDeps: JournalPostingDeps;

  constructor(private readonly deps: VoucherServiceDeps) {
    const glDeps: JournalPostingDeps = {
      ledger: deps.ledger,
      accounts: deps.accounts,
      periods: deps.periods,
      vatFilings: deps.vatFilings,
      numbering: deps.numbering,
      audit: deps.audit,
      now: deps.now,
      actor: deps.actor,
      projects: deps.projects,
    };
    this.glDeps = glDeps;
    this.service = new DocumentService(voucherDocumentType, {
      repo: deps.documents,
      numbering: { next: (opts) => deps.numbering.next("CASH_VOUCHER", { branchId: opts?.branchId }) },
      gl: createVoucherGlHook(glDeps),
      workflow: createDocumentWorkflowGate(deps.resolveGateConfig ?? (() => null), deps.approvalRequests),
      audit: deps.audit,
      events: deps.events,
      auditModule: "treasury",
      now: deps.now,
      actor: deps.actor,
      actorRoles: deps.actorRoles,
    });
  }

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  effectsOf(doc: VoucherDocument) {
    return this.service.effectsOf(doc);
  }

  /** Open a new مسودة (draft) voucher. */
  async createVoucher(cmd: CreateVoucherCommand): Promise<VoucherDocument> {
    const def = getVoucherTypeDefinition(cmd.voucherType);
    const treasury = await this.deps.treasuryAccounts.findById(cmd.treasuryAccountId);
    const base = this.deps.baseCurrency ?? BASE_CURRENCY;
    const currency = cmd.currency ?? treasury?.currency ?? base;
    const counterTreasury = cmd.counterTreasuryAccountId ? await this.deps.treasuryAccounts.findById(cmd.counterTreasuryAccountId) : null;
    for (const account of [treasury, counterTreasury]) {
      if (!account?.currency || account.currency === base || currency === base || account.currency === currency) continue;
      throw new VoucherTreasuryCurrencyMismatchError(cmd.id, account.id, account.currency, currency);
    }
    if (treasury?.currency && counterTreasury?.currency && treasury.currency !== base && counterTreasury.currency !== base && treasury.currency !== counterTreasury.currency) {
      throw new VoucherTreasuryCurrencyMismatchError(cmd.id, counterTreasury.id, counterTreasury.currency, treasury.currency);
    }
    const line: VoucherLine = {
      voucherType: cmd.voucherType,
      direction: def.direction,
      amount: cmd.amount,
      currency,
      branchId: cmd.branchId,
      paymentMethod: cmd.paymentMethod,
      treasuryAccountId: cmd.treasuryAccountId,
      treasuryGlAccountId: cmd.treasuryGlAccountId,
      /**
       * A fixed type overrides the caller outright (R8.1): a partner's capital
       * injection is equity by definition and a tax payment settles the VAT
       * payable, so accepting an account from the request body meant a drawing
       * could be booked as an expense.
       *
       * Everything else takes the caller's account and falls back to the
       * type's default — `other_expense` in particular must stay open, since
       * an employee-advance disbursement rides on it to reach the 1160
       * advances ASSET account.
       */
      counterpartyGlAccountId: def.counterpartAccountFixed
        ? def.counterpartAccountId
        : (cmd.counterpartyGlAccountId ?? def.counterpartAccountId ?? null),
      counterTreasuryAccountId: cmd.counterTreasuryAccountId ?? null,
      counterTreasuryGlAccountId: cmd.counterTreasuryGlAccountId ?? null,
      customerId: cmd.customerId ?? null,
      supplierId: cmd.supplierId ?? null,
      referenceNo: cmd.referenceNo ?? null,
      costCenterId: cmd.costCenterId ?? null,
      projectId: cmd.projectId ?? null,
      costCategory: cmd.costCategory ?? null,
      withholdingAmount: cmd.withholdingAmount ?? null,
      withholdingRatePercent: cmd.withholdingRatePercent ?? null,
      withholdingGlAccountId: cmd.withholdingGlAccountId ?? null,
    };
    return this.service.createDraft({
      id: cmd.id,
      date: cmd.date,
      memo: cmd.memo ?? def.labelAr,
      lines: [line],
    });
  }

  /**
   * Confirm a voucher: runs the cash-negative guard (against the live ledger)
   * BEFORE the framework posts its GL entry, then delegates to the generic
   * confirm — numbering (CV-), workflow gate, GL posting, audit, events.
   */
  async confirmVoucher(id: string, opts: ConfirmVoucherOptions = {}) {
    const existing = await this.service.findById(id);
    let carried: readonly HeldAllocationRequest[] = [];
    if (existing) {
      // The rate is resolved and STAMPED before anything is posted, exactly as
      // `confirmPurchaseInvoice` does it, so the GL amount, the treasury guard
      // and every allocation all read one base figure (B-4).
      const stamped = await this.stampFxRate(existing);
      await assertCashBalanceAllows(voucherLine(stamped), {
        treasuryAccounts: this.deps.treasuryAccounts,
        ledger: this.deps.ledger,
        ...(await this.cashPolicy()),
      }, stamped.date);
      carried = voucherLine(stamped).heldAllocations ?? [];
      if (carried.length > 0) await this.assertAllocationsFit(stamped, carried, true);
    }
    const cheques = this.deps.cheques;
    const refunding = existing !== null && voucherLine(existing).voucherType in REFUNDED_MONEY;
    if (!cheques && carried.length === 0 && !refunding) return this.service.confirm(id, opts);
    // The posting, the register row and the carried allocations are one act: a
    // «شيك» voucher that posted while its cheque failed to register is the gap
    // D81 filed, and an approved collection left unallocated is D344.
    return this.deps.documents.transaction(async () => {
      const result = await this.service.confirm(id, opts);
      if (result.held) return result;
      if (cheques) await this.registerCheque(cheques, result.document, opts.actor);
      await this.applyRefundToMoneyOnAccount(result.document);
      if (carried.length === 0) return result;
      await this.applyAllocations(id, carried, result.document);
      const current = (await this.service.findById(id)) ?? result.document;
      const cleared: VoucherDocument = { ...current, lines: [{ ...voucherLine(current), heldAllocations: null }] };
      await this.deps.documents.update(cleared);
      return { ...result, document: cleared };
    });
  }

  private async applyRefundToMoneyOnAccount(refund: VoucherDocument): Promise<void> {
    const line = voucherLine(refund);
    const heldAs = REFUNDED_MONEY[line.voucherType];
    const kind = heldAs ? getVoucherTypeDefinition(heldAs).allocationKind : null;
    const partyId = line.customerId ?? line.supplierId;
    if (!heldAs || !kind || !partyId || !line.fxRate || !this.deps.realisedFx) return;
    const held = (await this.service.list({ status: "confirmed", toDate: refund.date }))
      .filter((doc) => {
        const money = voucherLine(doc);
        return isStandingVoucher(doc) && money.voucherType === heldAs && (money.customerId ?? money.supplierId) === partyId && money.currency === line.currency && Boolean(money.fxRate);
      })
      .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date < b.date ? -1 : 1));
    let applied = 0;
    for (const money of held) {
      const moneyLine = voucherLine(money);
      const unallocated = Money.fromScaled(voucherBaseAmount(moneyLine).scaled - sumActive(await this.deps.allocations.listByVoucher(money.id)).scaled);
      if (unallocated.scaled <= 0n) continue;
      if (applied === 0) {
        await this.deps.invoices.save({ id: refund.id, invoiceNo: refund.docNo ?? refund.id, kind, partyId, date: refund.date, total: voucherBaseAmount(line), allocated: Money.zero() });
      }
      const { capacity } = await this.settlementPreview(refund.id, { amount: unallocated, currency: moneyLine.currency, fxRate: moneyLine.fxRate, date: money.date });
      if (capacity.scaled <= 0n) break;
      applied += 1;
      await this.allocate(money.id, {
        allocationId: `${refund.id}:R${applied}`,
        invoiceId: refund.id,
        amount: unallocated.scaled > capacity.scaled ? capacity : unallocated,
        date: refund.date,
      });
    }
    const row = await this.deps.invoices.findById(refund.id);
    if (row) await this.deps.invoices.save({ ...row, total: row.allocated });
  }

  private async registerCheque(
    cheques: VoucherChequeRegistrationPort,
    doc: VoucherDocument,
    actor: string | undefined,
  ): Promise<void> {
    const line = voucherLine(doc);
    if (line.paymentMethod !== "cheque") return;
    const direction = getVoucherTypeDefinition(line.voucherType).direction;
    if (direction !== "receipt" && direction !== "payment") return;
    await cheques.register({
      voucherId: doc.id,
      voucherNo: doc.docNo,
      direction: direction === "receipt" ? "incoming" : "outgoing",
      chequeNumber: line.referenceNo,
      amount: voucherBaseAmount(line),
      currency: line.fxRate ? (this.deps.baseCurrency ?? BASE_CURRENCY) : line.currency,
      issueDate: doc.date,
      branchId: line.branchId,
      partyId: direction === "receipt" ? line.customerId : line.supplierId,
      counterpartyGlAccountId: line.counterpartyGlAccountId,
      treasuryGlAccountId: line.treasuryGlAccountId,
      memo: doc.memo ?? null,
      actor: actor ?? this.deps.actor ?? "system",
    });
  }

  /**
   * Resolve the approved rate for a foreign-currency voucher and persist it on
   * the line. A currency with no approved rate on its date is REFUSED: posting
   * foreign digits as base silently mis-states cash, a debt and a settlement at
   * once.
   */
  private async stampFxRate(doc: VoucherDocument): Promise<VoucherDocument> {
    const original = voucherLine(doc);
    const base = this.deps.baseCurrency ?? BASE_CURRENCY;
    const approvedRate = async (currency: string): Promise<string> => {
      const found = await this.deps.exchangeRates?.findRate(currency, doc.date);
      if (!found) {
        throw new InvalidDocumentError(
          doc.docType,
          doc.id,
          `لا يوجد سعر صرف معتمد للعملة ${currency} بتاريخ ${doc.date}؛ لا يمكن ترحيل السند.`,
          `There is no approved exchange rate for ${currency} on ${doc.date}; the voucher cannot be posted.`,
        );
      }
      return found.rate;
    };

    let line = original;
    if (line.currency && line.currency !== base && !line.fxRate) line = { ...line, fxRate: await approvedRate(line.currency) };

    const legFx = async (accountId: string | null, baseMoved: Money, statedMoved: Money): Promise<TreasuryLegFx | null> => {
      const account = accountId ? await this.deps.treasuryAccounts.findById(accountId) : null;
      if (!account?.currency || account.currency === base) return null;
      if (account.currency === line.currency && line.fxRate) return { currency: account.currency, fxRate: line.fxRate, foreignAmount: statedMoved };
      const rate = await approvedRate(account.currency);
      return { currency: account.currency, fxRate: rate, foreignAmount: convertFromBase(baseMoved, rate) };
    };
    const paysOut = line.direction === "payment";
    const baseMoved = paysOut ? voucherNetPaid(line) : voucherBaseAmount(line);
    const statedMoved = paysOut ? Money.fromScaled(line.amount.scaled - (line.withholdingAmount?.scaled ?? 0n)) : line.amount;
    const movedOut = paysOut || line.direction === "transfer";
    const sourceBaseMoved = paysOut ? baseMoved : voucherBaseAmount(line);
    const stampedLeg = line.treasuryFx ?? (await legFx(line.treasuryAccountId, sourceBaseMoved, statedMoved));
    const treasuryFx = stampedLeg && movedOut ? await this.atCarrying(line.treasuryAccountId, stampedLeg, sourceBaseMoved, doc.date) : stampedLeg;
    const counterTreasuryFx = line.counterTreasuryFx ?? (await legFx(line.counterTreasuryAccountId, voucherBaseAmount(line), line.amount));
    if (treasuryFx || counterTreasuryFx) line = { ...line, treasuryFx, counterTreasuryFx };

    if (line === original) return doc;
    const stamped: VoucherDocument = { ...doc, lines: [line] };
    await this.deps.documents.update(stamped);
    return stamped;
  }

  private async atCarrying(treasuryAccountId: string, leg: TreasuryLegFx, baseMoved: Money, date: string): Promise<TreasuryLegFx> {
    const plain: TreasuryLegFx = { currency: leg.currency, fxRate: leg.fxRate, foreignAmount: leg.foreignAmount };
    const port = this.deps.realisedFx;
    const position = (await port?.treasuryPosition?.(treasuryAccountId, date)) ?? null;
    if (!port || !position) return plain;
    const carried = carryingBaseOf(position, leg.foreignAmount);
    if (carried.covered.scaled === 0n) return plain;
    const atDocumentRate = shareOfBase(baseMoved, carried.covered, leg.foreignAmount);
    const realised = Money.fromScaled(atDocumentRate.scaled - carried.base.scaled);
    const carryingBase = Money.fromScaled(baseMoved.scaled - realised.scaled);
    if (realised.scaled === 0n) return { ...plain, carryingBase };
    const accounts = await port.differenceAccounts();
    return { ...plain, carryingBase, realised, realisedAccountId: realised.scaled > 0n ? accounts.gainAccountId : accounts.lossAccountId };
  }

  /** Hand a voucher held بانتظار الموافقة back to its submitter as a draft. */
  async returnVoucherToDraft(id: string): Promise<VoucherDocument> {
    return this.service.returnToDraft(id);
  }

  /** Cancel a draft/pending voucher (a live one is reversed instead). */
  async cancelVoucher(id: string): Promise<VoucherDocument> {
    return this.service.cancel(id);
  }

  /**
   * Reverse a confirmed voucher: reverse the DOCUMENT first — which posts the
   * mirror-image GL entry via the GL hook — and only then unwind its ACTIVE
   * allocations so the invoice outstandings come back.
   *
   * The order is load-bearing. Reversing the allocations first meant that a
   * refused document reversal (a closed period, an illegal transition) had
   * already freed every invoice this voucher had settled, while the voucher
   * stayed confirmed with its cash still in the safe.
   */
  async reverseVoucher(
    id: string,
    opts: { reversalId: string; date?: string; memo?: string },
  ): Promise<{ original: VoucherDocument; reversal: VoucherDocument }> {
    if (await this.deps.cheques?.blocksReversal?.(id)) {
      throw new InvalidDocumentError(
        voucherDocumentType.code,
        id,
        "الشيك المرتبط بهذا السند ما زال قائماً في سجل الشيكات؛ ارتداد الشيك هو ما يعكس السند.",
        "The cheque this voucher raised still stands in the cheque register; bouncing the cheque is what reverses the voucher.",
      );
    }
    return this.deps.documents.transaction(async () => {
      const result = await this.service.reverse(id, opts);
      await this.undoAllocations(await this.deps.allocations.listByVoucher(id), result.reversal.date);
      const refunded = await this.deps.invoices.findById(id);
      if (refunded && voucherLine(result.original).voucherType in REFUNDED_MONEY) {
        await this.undoAllocations(await this.deps.allocations.listByInvoice(id), result.reversal.date);
        await this.deps.invoices.save({ ...refunded, total: Money.zero(), allocated: Money.zero() });
      }
      await this.deps.realisedFx?.releaseMoneyShare?.(id, result.reversal.date);
      await this.deps.advanceSubLedger?.onVoucherReversed(id);
      return result;
    });
  }

  private async undoAllocations(allocations: readonly VoucherAllocation[], eventDay: string): Promise<void> {
    for (const alloc of allocations) {
      if (alloc.status !== "active") continue;
      const undoneOn = await allocationUndoDay(alloc, eventDay, this.deps.ledger);
      await reverseRealisedFx(alloc, this.glDeps, undoneOn);
      const undone = await reverseAllocationFn(alloc.id, this.now(), { allocations: this.deps.allocations, invoices: this.deps.invoices }, undoneOn);
      await this.projectSettlement(undone.invoice);
    }
  }

  async laterAllocationDay(voucherId: string, invoiceId: string, requested?: string | null): Promise<string> {
    const doc = await this.requireConfirmedAllocatable(voucherId);
    const invoice = await this.deps.invoices.findById(invoiceId);
    if (!invoice) throw new InvoiceNotFoundError(invoiceId);
    const line = voucherLine(doc);
    const booked = await this.deps.realisedFx?.invoiceFx(invoice.id, invoice.kind);
    const currencies = new Set([...(line.fxRate ? [line.currency] : []), ...(booked ? [booked.currency] : [])]);
    const earlierAllocations = [...(await this.deps.allocations.listByVoucher(doc.id)), ...(await this.deps.allocations.listByInvoice(invoice.id))];
    return laterAllocationDay({ requested, moneyDay: doc.date, invoiceDay: invoice.date, currencies, earlierAllocations }, { periods: this.deps.periods, ledger: this.deps.ledger, vatFilings: this.deps.vatFilings });
  }

  async allocate(
    voucherId: string,
    input: {
      allocationId: string;
      invoiceId: string;
      amount: import("../money/money.js").Money;
      now?: string;
      date?: string;
    },
  ): Promise<{ allocation: VoucherAllocation }> {
    const doc = await this.requireConfirmedAllocatable(voucherId);
    const line = voucherLine(doc);
    const def = getVoucherTypeDefinition(line.voucherType);
    const partyId = (line.customerId ?? line.supplierId)!;
    const realisedFx = this.deps.realisedFx;
    const money: SettlingMoney = { currency: line.currency, fxRate: line.fxRate, date: doc.date };
    if (realisedFx) {
      const base = this.deps.baseCurrency ?? BASE_CURRENCY;
      const voucherCurrency = line.currency || base;
      if (voucherCurrency !== base) {
        const invoice = await this.deps.invoices.findById(input.invoiceId);
        const booked = invoice ? await realisedFx.invoiceFx(invoice.id, invoice.kind) : null;
        const invoiceCurrency = booked?.currency ?? base;
        if (invoice && invoiceCurrency !== voucherCurrency) {
          throw new AllocationCurrencyMismatchError(voucherId, input.invoiceId, voucherCurrency, invoiceCurrency);
        }
      }
    }
    const run = async () => {
      const result = await allocateFn(
        {
          allocationId: input.allocationId,
          voucherId,
          // BASE, like the invoice totals it is compared against (B-4): a
          // USD 1,000 receipt used to settle 1,000 EGP of a 49,350 EGP invoice.
          voucherAmount: voucherBaseAmount(line),
          voucherPartyId: partyId,
          expectedKind: def.allocationKind!,
          invoiceId: input.invoiceId,
          amount: input.amount,
          now: input.now ?? this.now(),
          date: laterDay(input.date ?? (input.now ?? this.now()).slice(0, 10), doc.date),
          ...(realisedFx
            ? {
                rates: (invoice) => settlementRatesFor(realisedFx, invoice, money),
                revaluationShare: async (invoice, relief) => (await realisedFx.revaluationShareTaken?.({ id: invoice.id, type: FxOpenItemType.Invoice }, relief)) ?? Money.zero(),
                moneyRevaluationShare: async (relief) => (line.fxRate ? ((await realisedFx.revaluationShareTaken?.({ id: voucherId, type: FxOpenItemType.Money }, relief)) ?? Money.zero()) : Money.zero()),
                beforeSave: async (invoice, split, date) => {
                  const booked = await realisedFx.invoiceFx(invoice.id, invoice.kind);
                  const rates = await settlementRatesFor(realisedFx, invoice, money);
                  if (!booked || !rates) return { fxEntryId: null };
                  const fxEntryId = await postRealisedFx(
                    {
                      allocationId: input.allocationId,
                      invoice,
                      split,
                      currency: booked.currency,
                      invoiceRate: booked.fxRate,
                      money,
                      date: date ?? doc.date,
                      controlAccountId: line.counterpartyGlAccountId!,
                      branchId: line.branchId,
                      reference: doc.docNo ?? doc.id,
                    },
                    realisedFx,
                    this.glDeps,
                  );
                  return { fxEntryId };
                },
              }
            : {}),
        },
        { allocations: this.deps.allocations, invoices: this.deps.invoices, returns: this.deps.returns },
      );
      await this.projectSettlement(result.invoice);
      return { allocation: result.allocation };
    };
    // The realised-FX entry and the allocation are one act: a posted
    // difference with no allocation behind it would sit on the party forever.
    return realisedFx ? this.deps.documents.transaction(run) : run();
  }

  /**
   * Create, confirm and allocate as ONE transaction (D338). A voucher held for
   * approval commits as a pending draft carrying its requested allocations,
   * since nothing may settle an invoice before the money posts; the approved
   * confirm applies them (D344).
   */
  async createConfirmAndAllocate(
    cmd: CreateVoucherCommand,
    allocations: readonly CollectionAllocationRequest[],
    opts: ConfirmVoucherOptions = {},
  ): Promise<CollectionResult> {
    const requests: HeldAllocationRequest[] = allocations.map((a) => ({
      allocationId: a.allocationId,
      invoiceId: a.invoiceId,
      amount: a.amount ?? null,
    }));
    return this.deps.documents.transaction(async () => {
      await this.createVoucher(cmd);
      const confirmed = await this.confirmVoucher(cmd.id, opts);
      if (confirmed.held) {
        if (requests.length === 0) return { document: confirmed.document, held: true, allocations: [], heldAllocations: [] };
        await this.assertAllocationsFit(confirmed.document, requests, false);
        const carrying: VoucherDocument = {
          ...confirmed.document,
          lines: [{ ...voucherLine(confirmed.document), heldAllocations: requests }],
        };
        await this.deps.documents.update(carrying);
        return { document: carrying, held: true, allocations: [], heldAllocations: requests };
      }
      const made = await this.applyAllocations(cmd.id, requests, confirmed.document, cmd.date);
      return {
        document: (await this.service.findById(cmd.id)) ?? confirmed.document,
        held: false,
        allocations: made,
        heldAllocations: [],
      };
    });
  }

  private async applyAllocations(
    voucherId: string,
    requests: readonly HeldAllocationRequest[],
    confirmed: VoucherDocument,
    date: string = confirmed.date,
  ): Promise<VoucherAllocation[]> {
    const made: VoucherAllocation[] = [];
    const total = voucherBaseAmount(voucherLine(confirmed)).scaled;
    for (const request of requests) {
      const used = made.reduce((sum, a) => sum + a.amount.scaled, 0n);
      const { allocation } = await this.allocate(voucherId, {
        allocationId: request.allocationId,
        invoiceId: request.invoiceId,
        amount: request.amount ?? Money.fromScaled(total - used),
        date,
      });
      made.push(allocation);
    }
    return made;
  }

  /**
   * Checks the requested allocations against the invoices as they stand NOW,
   * before anything posts, so an approval never settles more than an invoice
   * still owes after it was paid, returned or reassigned meanwhile.
   */
  private async assertAllocationsFit(
    doc: VoucherDocument,
    requests: readonly HeldAllocationRequest[],
    whileHeld: boolean,
  ): Promise<void> {
    const line = voucherLine(doc);
    const def = getVoucherTypeDefinition(line.voucherType);
    const partyId = line.customerId ?? line.supplierId;
    const total = voucherBaseAmount(line).scaled;
    const fmt = (scaled: bigint) => Money.fromScaled(scaled).toString();
    const claimed = new Map<string, bigint>();
    let used = 0n;
    for (const request of requests) {
      const amount = request.amount?.scaled ?? total - used;
      const refuse = (reason: HeldAllocationRefusal, capacity: bigint) =>
        new HeldAllocationRefusedError(doc.id, request.invoiceId, reason, fmt(amount), fmt(capacity), whileHeld);
      const invoice = await this.deps.invoices.findById(request.invoiceId);
      if (!invoice) throw refuse(HeldAllocationRefusal.InvoiceMissing, 0n);
      if (invoice.kind !== def.allocationKind || invoice.partyId !== partyId) {
        throw refuse(HeldAllocationRefusal.InvoiceMismatch, 0n);
      }
      if (amount <= 0n || used + amount > total) throw refuse(HeldAllocationRefusal.NothingLeft, total - used);
      const preview = await this.settlementPreview(invoice.id, {
        amount: Money.fromScaled(amount),
        currency: line.currency,
        fxRate: line.fxRate,
        date: doc.date,
      });
      const already = claimed.get(invoice.id) ?? 0n;
      const capacity = preview.capacity.scaled - already;
      if (amount > capacity) throw refuse(HeldAllocationRefusal.ExceedsInvoice, capacity > 0n ? capacity : 0n);
      claimed.set(invoice.id, already + amount);
      used += amount;
    }
  }

  /**
   * What `amount` of base money dated `date` would do to an invoice, without
   * writing anything: what it relieves at the booked rate, the realised
   * difference, and the most the invoice can still absorb (D221). The invoice
   * collect and pay routes cap on this before they raise a voucher.
   */
  async settlementPreview(
    invoiceId: string,
    money: { readonly amount: import("../money/money.js").Money } & SettlingMoney,
  ): Promise<SettlementSplit> {
    const invoice = await this.deps.invoices.findById(invoiceId);
    if (!invoice) throw new InvoiceNotFoundError(invoiceId);
    const rates = this.deps.realisedFx ? await settlementRatesFor(this.deps.realisedFx, invoice, money) : null;
    const returned = (await returnedByInvoice(this.deps.returns, [invoice])).get(invoice.id) ?? Money.zero();
    return settlementSplit(money.amount, invoiceOpenBalance(invoice, returned), rates);
  }

  async reverseAllocation(allocationId: string, opts: { now?: string; date?: string } = {}): Promise<{ allocation: VoucherAllocation }> {
    const stamp = opts.now ?? this.now();
    const run = async () => {
      const existing = await this.deps.allocations.findById(allocationId);
      const undoneOn = existing ? await allocationUndoDay(existing, opts.date ?? stamp.slice(0, 10), this.deps.ledger) : undefined;
      if (existing?.status === "active" && undoneOn) await reverseRealisedFx(existing, this.glDeps, undoneOn);
      const result = await reverseAllocationFn(
        allocationId,
        stamp,
        { allocations: this.deps.allocations, invoices: this.deps.invoices },
        undoneOn,
      );
      await this.projectSettlement(result.invoice);
      return { allocation: result.allocation };
    };
    return this.deps.documents.transaction(run);
  }

  private async projectSettlement(invoice: { id: string; kind: AllocationInvoiceKind; allocated: Money } | null): Promise<void> {
    if (!invoice || !this.deps.settlement) return;
    await this.deps.settlement.applySettled({
      invoiceId: invoice.id,
      kind: invoice.kind,
      settled: invoice.allocated,
    });
  }

  async listAllocations(voucherId: string): Promise<readonly VoucherAllocation[]> {
    return this.deps.allocations.listByVoucher(voucherId);
  }

  async allocationSummary(doc: VoucherDocument): Promise<AllocationSummary> {
    const line = voucherLine(doc);
    const allocations = await this.deps.allocations.listByVoucher(doc.id);
    return summarize(voucherBaseAmount(line), allocations, voucherTakesAllocations(doc));
  }

  async findById(id: string): Promise<VoucherDocument | null> {
    return this.service.findById(id);
  }

  async list(filter?: DocumentListFilter): Promise<readonly VoucherDocument[]> {
    return this.service.list(filter);
  }

  private async cashPolicy(): Promise<{ preventNegativeCashBalance: boolean; allowNegativeTreasury: boolean }> {
    const settings = await this.deps.settings?.get();
    return {
      preventNegativeCashBalance: settings?.preventNegativeCashBalance ?? true,
      allowNegativeTreasury: settings?.allowNegativeTreasury ?? true,
    };
  }

  private async requireConfirmedAllocatable(voucherId: string): Promise<VoucherDocument> {
    const doc = await this.service.findById(voucherId);
    if (!doc) throw new VoucherNotConfirmedError(voucherId, "missing");
    if (doc.reversesDocId || doc.status === "reversed") throw new VoucherReversedError(doc.id, doc.docNo ?? doc.id, Boolean(doc.reversesDocId));
    if (doc.status !== "confirmed") throw new VoucherNotConfirmedError(voucherId, doc.status);
    const line = voucherLine(doc);
    if (!getVoucherTypeDefinition(line.voucherType).allocatable) {
      throw new VoucherNotAllocatableError(voucherId, line.voucherType);
    }
    return doc;
  }
}
