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
import { COMPANY_LEVEL_VOUCHER_BRANCH, voucherLine, type VoucherDocument } from "../vouchers/voucher-document.js";
import type { TreasuryLedgerCandidate, TreasuryLedgerReader } from "./matching.js";
import { BankEntryKind, type BankEntryPoster } from "./entry-poster.js";

export interface TreasuryLedgerReaderDeps {
  readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById">;
  readonly ledger: Pick<LedgerRepository, "accountLedger" | "findById"> & Partial<Pick<LedgerRepository, "accountBalance">>;
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


/** Bind the GL ledger + treasury-account lookup behind `TreasuryLedgerReader`. */
export function createTreasuryLedgerReader(deps: TreasuryLedgerReaderDeps): TreasuryLedgerReader {
  const base = deps.baseCurrency ?? BASE_CURRENCY;

  async function bindingOf(treasuryAccountId: string): Promise<AccountBinding | null> {
    const account = await deps.treasuryAccounts.findById(treasuryAccountId);
    if (!account?.glAccountId) return null;
    return { glAccountId: account.glAccountId, currency: account.currency, foreign: account.currency !== base };
  }

  /**
   * The rate this entry was booked at, read off whichever of its own lines
   * carries the currency and the rate.
   *
   * A foreign bank account's GL lines are base-currency figures: the voucher
   * engine tags only the counterparty leg with the currency and rate, on the
   * reasoning that every treasury account is base-currency — which is exactly
   * what a foreign bank account is not. The rate belongs to the entry, not to
   * one of its legs, so it is read from the entry.
   */
  async function rateOf(entryId: string, currency: string): Promise<string | null> {
    const entry = await deps.ledger.findById(entryId);
    const tagged = entry?.lines.find((l) => l.currency === currency && l.fxRate);
    return tagged?.fxRate ?? null;
  }

  /** One entry's movement on the account, in the account's own currency when the books can say what that was. */
  async function statedIn(
    binding: AccountBinding,
    entryId: string,
    baseAmount: Money,
  ): Promise<{ amount: Money; currency: string }> {
    if (!binding.foreign) return { amount: baseAmount, currency: binding.currency };
    const rate = await rateOf(entryId, binding.currency);
    if (!rate) return { amount: baseAmount, currency: base };
    return { amount: convertFromBase(baseAmount, rate), currency: binding.currency };
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
      const lines = (await deps.ledger.accountLedger(binding.glAccountId, toDate)).filter((l) => l.date >= fromDate);
      const byEntry = new Map<string, { entryNo: string | null; date: string; memo: string | null; amount: Money }>();
      for (const line of lines) {
        const amount = line.debit.add(line.credit.negate());
        const existing = byEntry.get(line.entryId);
        if (existing) existing.amount = existing.amount.add(amount);
        else byEntry.set(line.entryId, { entryNo: line.entryNo, date: line.date, memo: line.memo, amount });
      }
      const candidates: TreasuryLedgerCandidate[] = [];
      for (const [entryId, row] of byEntry) {
        if (row.amount.scaled === 0n) continue;
        const [extra, stated] = await Promise.all([enrich(entryId), statedIn(binding, entryId, row.amount)]);
        candidates.push({
          entryId,
          entryNo: row.entryNo,
          date: row.date,
          amount: stated.amount,
          description: row.memo,
          currency: stated.currency,
          baseAmount: row.amount,
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
        const [extra, stated] = await Promise.all([enrich(id), statedIn(binding, id, baseAmount)]);
        result.set(id, {
          entryId: id,
          entryNo: entry.entryNo ?? null,
          date: entry.date,
          amount: stated.amount,
          description: entry.memo ?? null,
          currency: stated.currency,
          baseAmount,
          ...extra,
        });
      }
      return result;
    },

    async bookBalance(treasuryAccountId, asOfDate) {
      const binding = await bindingOf(treasuryAccountId);
      if (!binding) return Money.zero();
      if (!binding.foreign) {
        if (!deps.ledger.accountBalance) return Money.zero();
        return (await deps.ledger.accountBalance(binding.glAccountId, asOfDate)).balance;
      }
      const lines = await deps.ledger.accountLedger(binding.glAccountId, asOfDate);
      const byEntry = new Map<string, Money>();
      for (const line of lines) {
        const amount = line.debit.add(line.credit.negate());
        byEntry.set(line.entryId, (byEntry.get(line.entryId) ?? Money.zero()).add(amount));
      }
      const stated = await Promise.all([...byEntry].map(([entryId, amount]) => statedIn(binding, entryId, amount)));
      return Money.sum(stated.map((s) => s.amount));
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
      const service = new VoucherService({ ...deps, actor: input.actor, actorRoles: input.actorRoles, documentIdsMintedBySystem: true });

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
            branchId: input.branchId || treasury.branchId || COMPANY_LEVEL_VOUCHER_BRANCH,
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
