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
  voucherDocumentType,
  voucherLine,
  type VoucherDocument,
  type VoucherLine,
} from "./voucher-document.js";
import {
  getVoucherTypeDefinition,
  type AllocationInvoiceKind,
  type VoucherType,
} from "./voucher-types.js";
import { assertCashBalanceAllows } from "./cash-guard.js";
import {
  allocate as allocateFn,
  reverseAllocation as reverseAllocationFn,
  summarize,
  type AllocatableInvoiceRepository,
  type AllocationRepository,
  type AllocationSummary,
  type VoucherAllocation,
} from "./allocation.js";
import { VoucherNotAllocatableError, VoucherNotConfirmedError } from "./errors.js";
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
            projectId: l.projectId ?? null,
            costCategory: l.costCategory ?? null,
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

export interface VoucherServiceDeps {
  readonly documents: import("../documents/document.js").DocumentRepository<VoucherLine>;
  readonly ledger: LedgerRepository;
  readonly accounts: Pick<AccountRepository, "findById">;
  readonly periods: Pick<FiscalPeriodRepository, "findByDate">;
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

export interface ConfirmVoucherOptions {
  readonly actor?: string;
  readonly actorRoles?: readonly string[];
  readonly requestId?: string;
}

export class VoucherService {
  private readonly service: DocumentService<VoucherLine>;

  constructor(private readonly deps: VoucherServiceDeps) {
    const glDeps: JournalPostingDeps = {
      ledger: deps.ledger,
      accounts: deps.accounts,
      periods: deps.periods,
      numbering: deps.numbering,
      audit: deps.audit,
      now: deps.now,
      actor: deps.actor,
      projects: deps.projects,
    };
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
    const line: VoucherLine = {
      voucherType: cmd.voucherType,
      direction: def.direction,
      amount: cmd.amount,
      currency: cmd.currency ?? "EGP",
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
    if (existing) {
      const line = voucherLine(existing);
      await assertCashBalanceAllows(line, {
        treasuryAccounts: this.deps.treasuryAccounts,
        ledger: this.deps.ledger,
        ...(await this.cashPolicy()),
      }, existing.date);
    }
    return this.service.confirm(id, opts);
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
    const result = await this.service.reverse(id, opts);
    const active = (await this.deps.allocations.listByVoucher(id)).filter((a) => a.status === "active");
    for (const alloc of active) {
      const undone = await reverseAllocationFn(alloc.id, this.now(), {
        allocations: this.deps.allocations,
        invoices: this.deps.invoices,
      });
      await this.projectSettlement(undone.invoice);
    }
    return result;
  }

  async allocate(
    voucherId: string,
    input: { allocationId: string; invoiceId: string; amount: import("../money/money.js").Money; now?: string },
  ): Promise<{ allocation: VoucherAllocation }> {
    const doc = await this.requireConfirmedAllocatable(voucherId);
    const line = voucherLine(doc);
    const def = getVoucherTypeDefinition(line.voucherType);
    const partyId = (line.customerId ?? line.supplierId)!;
    const result = await allocateFn(
      {
        allocationId: input.allocationId,
        voucherId,
        voucherAmount: line.amount,
        voucherPartyId: partyId,
        expectedKind: def.allocationKind!,
        invoiceId: input.invoiceId,
        amount: input.amount,
        now: input.now ?? this.now(),
      },
      { allocations: this.deps.allocations, invoices: this.deps.invoices },
    );
    await this.projectSettlement(result.invoice);
    return { allocation: result.allocation };
  }

  async reverseAllocation(allocationId: string, now?: string): Promise<{ allocation: VoucherAllocation }> {
    const result = await reverseAllocationFn(allocationId, now ?? this.now(), {
      allocations: this.deps.allocations,
      invoices: this.deps.invoices,
    });
    await this.projectSettlement(result.invoice);
    return { allocation: result.allocation };
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
    const def = getVoucherTypeDefinition(line.voucherType);
    const allocations = await this.deps.allocations.listByVoucher(doc.id);
    return summarize(line.amount, allocations, def.allocatable);
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
    if (doc.status !== "confirmed") throw new VoucherNotConfirmedError(voucherId, doc.status);
    const line = voucherLine(doc);
    if (!getVoucherTypeDefinition(line.voucherType).allocatable) {
      throw new VoucherNotAllocatableError(voucherId, line.voucherType);
    }
    return doc;
  }
}
