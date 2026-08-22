/**
 * Adapter binding the REAL GL ledger behind the reconciliation module's
 * `TreasuryLedgerReader` port (mirrors `sales-invoices/adapters.ts`'s
 * `createSalesInvoiceGlHook`) — the reconciliation service never imports the
 * ledger or treasury-account engines directly.
 */

import type { AccountLedgerLine, LedgerRepository } from "../gl/ledger.js";
import type { TreasuryAccountRepository } from "../treasury-accounts/treasury-account.js";
import type { TreasuryLedgerCandidate, TreasuryLedgerReader } from "./matching.js";

export interface TreasuryLedgerReaderDeps {
  readonly treasuryAccounts: Pick<TreasuryAccountRepository, "findById">;
  readonly ledger: Pick<LedgerRepository, "accountLedger">;
}

function toCandidate(line: AccountLedgerLine): TreasuryLedgerCandidate {
  return {
    entryId: line.entryId,
    date: line.date,
    // Treasury (cash/bank) accounts are debit-natural: a debit is money IN.
    amount: line.debit.add(line.credit.negate()),
    description: line.memo,
  };
}

/** Bind the GL ledger + treasury-account lookup behind `TreasuryLedgerReader`. */
export function createTreasuryLedgerReader(deps: TreasuryLedgerReaderDeps): TreasuryLedgerReader {
  return {
    async entriesForTreasuryAccount(treasuryAccountId, fromDate, toDate) {
      const account = await deps.treasuryAccounts.findById(treasuryAccountId);
      if (!account?.glAccountId) return [];
      const lines = await deps.ledger.accountLedger(account.glAccountId, toDate);
      return lines.filter((l) => l.date >= fromDate).map(toCandidate);
    },
  };
}
