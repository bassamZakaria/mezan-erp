/**
 * Adapter binding the REAL GL ledger behind the reconciliation module's
 * `TreasuryLedgerReader` port (mirrors `sales-invoices/adapters.ts`'s
 * `createSalesInvoiceGlHook`) — the reconciliation service never imports the
 * ledger or treasury-account engines directly.
 */

import type { LedgerRepository } from "../gl/ledger.js";
import { Money } from "../money/index.js";
import { BASE_CURRENCY } from "../exchange-rates/exchange-rate.js";
import { convertFromBase } from "../exchange-rates/convert.js";
import type { TreasuryAccountRepository } from "../treasury-accounts/treasury-account.js";
import { VoucherService, type VoucherServiceDeps } from "../vouchers/voucher-service.js";
import { voucherLine, type VoucherDocument } from "../vouchers/voucher-document.js";
import type { TreasuryLedgerCandidate, TreasuryLedgerReader } from "./matching.js";
import { BankEntryKind, type BankEntryPoster } from "./entry-poster.js";

export interface TreasuryLedgerReaderDeps {
  readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById">;
  readonly ledger: Pick<LedgerRepository, "accountLedger" | "findById"> &
    Partial<Pick<LedgerRepository, "accountBalance" | "listLines">>;
  /** The voucher behind an entry, for its cheque/reference number and its party. */
  readonly vouchers?: { findById(id: string): Promise<VoucherDocument | null> };
  readonly partyName?: (kind: "customer" | "supplier", id: string) => Promise<string | null>;
  /** The tenant's base currency; every GL debit and credit is denominated in it. */
  readonly baseCurrency?: string;
}

interface Enrichment {
  readonly docNo: string | null;
  readonly reference: string | null;
  readonly counterparty: string | null;
}

interface AccountBinding {
  readonly glAccountId: string;
  readonly currency: string;
  readonly foreign: boolean;
}

/** The foreign amount a posted line represents, or null when it carries no rate to recover it with. */
function foreignOf(
  line: { currency?: string | null; fxRate?: string | null; debit: Money; credit: Money },
  currency: string,
): Money | null {
  if (line.currency !== currency || !line.fxRate) return null;
  return convertFromBase(line.debit.add(line.credit.negate()), line.fxRate);
}

/** Bind the GL ledger + treasury-account lookup behind `TreasuryLedgerReader`. */
export function createTreasuryLedgerReader(deps: TreasuryLedgerReaderDeps): TreasuryLedgerReader {
  const base = deps.baseCurrency ?? BASE_CURRENCY;

  async function bindingOf(treasuryAccountId: string): Promise<AccountBinding | null> {
    const account = await deps.treasuryAccounts.findById(treasuryAccountId);
    if (!account?.glAccountId) return null;
    return { glAccountId: account.glAccountId, currency: account.currency, foreign: account.currency !== base };
  }

  async function enrich(entryId: string): Promise<Enrichment> {
    const entry = await deps.ledger.findById(entryId);
    const voucher = deps.vouchers ? await deps.vouchers.findById(entry?.sourceDocId ?? entryId) : null;
    if (!voucher) return { docNo: entry?.sourceDocNumber ?? null, reference: null, counterparty: null };
    const line = voucherLine(voucher);
    let counterparty: string | null = null;
    if (deps.partyName) {
      if (line.customerId) counterparty = await deps.partyName("customer", line.customerId);
      else if (line.supplierId) counterparty = await deps.partyName("supplier", line.supplierId);
    }
    return { docNo: voucher.docNo ?? entry?.sourceDocNumber ?? null, reference: line.referenceNo ?? null, counterparty };
  }

  return {
    async entriesForTreasuryAccount(treasuryAccountId, fromDate, toDate) {
      const binding = await bindingOf(treasuryAccountId);
      if (!binding) return [];
      const posted = binding.foreign && deps.ledger.listLines
        ? await deps.ledger.listLines({ accountIds: [binding.glAccountId], fromDate, toDate })
        : null;
      const byEntry = new Map<
        string,
        { entryNo: string | null; date: string; memo: string | null; base: Money; foreign: Money; rated: boolean }
      >();
      const add = (
        entryId: string,
        row: { entryNo: string | null; date: string; memo: string | null },
        amount: Money,
        foreign: Money | null,
      ) => {
        const existing = byEntry.get(entryId);
        if (existing) {
          existing.base = existing.base.add(amount);
          existing.foreign = existing.foreign.add(foreign ?? amount);
          existing.rated = existing.rated && foreign !== null;
          return;
        }
        byEntry.set(entryId, { ...row, base: amount, foreign: foreign ?? amount, rated: foreign !== null });
      };
      if (posted) {
        for (const line of posted) {
          add(
            line.entryId,
            { entryNo: line.entryNo, date: line.date, memo: line.memo },
            line.debit.add(line.credit.negate()),
            foreignOf(line, binding.currency),
          );
        }
      } else {
        const lines = (await deps.ledger.accountLedger(binding.glAccountId, toDate)).filter((l) => l.date >= fromDate);
        for (const line of lines) {
          add(line.entryId, { entryNo: line.entryNo, date: line.date, memo: line.memo }, line.debit.add(line.credit.negate()), null);
        }
      }
      const candidates: TreasuryLedgerCandidate[] = [];
      for (const [entryId, row] of byEntry) {
        const rated = binding.foreign && row.rated;
        const amount = rated ? row.foreign : row.base;
        if (amount.scaled === 0n) continue;
        const extra = await enrich(entryId);
        candidates.push({
          entryId,
          entryNo: row.entryNo,
          date: row.date,
          amount,
          description: row.memo,
          currency: rated ? binding.currency : base,
          baseAmount: row.base,
          ...extra,
        });
      }
      return candidates;
    },

    async entryNumbersByIds(entryIds) {
      const unique = [...new Set(entryIds)];
      const entries = await Promise.all(unique.map((id) => deps.ledger.findById(id)));
      const byId = new Map<string, string>();
      for (const entry of entries) {
        if (entry?.entryNo) byId.set(entry.id, entry.entryNo);
      }
      return byId;
    },

    async entryAmountsOnTreasuryAccount(treasuryAccountId, entryIds) {
      const result = new Map<string, TreasuryLedgerCandidate>();
      const binding = await bindingOf(treasuryAccountId);
      if (!binding) return result;
      for (const id of new Set(entryIds)) {
        const entry = await deps.ledger.findById(id);
        if (!entry || (entry.status !== "posted" && entry.status !== "reversed")) continue;
        const onAccount = entry.lines.filter((l) => l.accountId === binding.glAccountId);
        if (onAccount.length === 0) continue;
        const baseAmount = Money.sum(onAccount.map((l) => l.debit.add(l.credit.negate())));
        const foreignParts = onAccount.map((l) => foreignOf(l, binding.currency));
        const rated = binding.foreign && foreignParts.every((part) => part !== null);
        const amount = rated ? Money.sum(foreignParts as Money[]) : baseAmount;
        const extra = await enrich(id);
        result.set(id, {
          entryId: id,
          entryNo: entry.entryNo ?? null,
          date: entry.date,
          amount,
          description: entry.memo ?? null,
          currency: rated ? binding.currency : base,
          baseAmount,
          ...extra,
        });
      }
      return result;
    },

    async bookBalance(treasuryAccountId, asOfDate) {
      const binding = await bindingOf(treasuryAccountId);
      if (!binding) return Money.zero();
      if (binding.foreign && deps.ledger.listLines) {
        const lines = await deps.ledger.listLines({ accountIds: [binding.glAccountId], toDate: asOfDate });
        return Money.sum(lines.map((line) => foreignOf(line, binding.currency) ?? line.debit.add(line.credit.negate())));
      }
      if (!deps.ledger.accountBalance) return Money.zero();
      return (await deps.ledger.accountBalance(binding.glAccountId, asOfDate)).balance;
    },
  };
}

export type VoucherBankEntryPosterDeps = Omit<VoucherServiceDeps, "actor" | "actorRoles">;

/**
 * Posts a statement line's missing entry as a real treasury voucher —
 * «مصروف آخر» for a bank charge, «إيراد آخر» for interest — so it takes the
 * voucher's numbering, cash policy, approval chain, audit and period gate
 * like every other bank movement. Create and confirm are one transaction: a
 * refused posting leaves no draft behind.
 */
export function createVoucherBankEntryPoster(deps: VoucherBankEntryPosterDeps): BankEntryPoster {
  return {
    async post(input) {
      const treasury = await deps.treasuryAccounts.findById(input.treasuryAccountId);
      if (!treasury?.glAccountId) throw new Error(`Treasury account ${input.treasuryAccountId} has no GL account.`);
      const service = new VoucherService({ ...deps, actor: input.actor, actorRoles: input.actorRoles });

      let voucherId = input.voucherId;
      let existing = await deps.documents.findById(voucherId);
      for (let attempt = 2; existing && (existing.status === "cancelled" || existing.status === "reversed"); attempt += 1) {
        voucherId = `${input.voucherId}-${attempt}`;
        existing = await deps.documents.findById(voucherId);
      }
      if (existing?.status === "pending") return { held: true, voucherId: existing.id, voucherNo: existing.docNo };
      if (existing?.status === "confirmed") {
        return { held: false, voucherId: existing.id, voucherNo: existing.docNo, entryId: existing.journalEntryId ?? existing.id };
      }

      return deps.documents.transaction(async () => {
        if (!existing) {
          await service.createVoucher({
            id: voucherId,
            date: input.date,
            memo: input.memo,
            voucherType: input.kind === BankEntryKind.BankCharge ? "other_expense" : "other_income",
            amount: input.amount,
            currency: treasury.currency,
            branchId: treasury.branchId,
            paymentMethod: "bank",
            treasuryAccountId: treasury.id,
            treasuryGlAccountId: treasury.glAccountId!,
            counterpartyGlAccountId: input.counterAccountId,
            costCenterId: input.costCenterId,
            referenceNo: input.reference,
          });
        }
        const result = await service.confirmVoucher(voucherId, { actor: input.actor, actorRoles: input.actorRoles });
        const doc = result.document;
        if (result.held) return { held: true as const, voucherId: doc.id, voucherNo: doc.docNo };
        return { held: false as const, voucherId: doc.id, voucherNo: doc.docNo, entryId: doc.journalEntryId ?? doc.id };
      });
    },
  };
}
