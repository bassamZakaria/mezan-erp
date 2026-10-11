import type { JournalTaxTagPort } from "../tax-rates/classify-posted-line-tax.js";
import type { LedgerRepository } from "./ledger.js";
import { assertVatNotFiled, type JournalPostingDeps } from "./post.js";

export class JournalTaxTagUnsupportedError extends Error {
  readonly code = "JOURNAL_TAX_TAG_UNSUPPORTED";
  constructor() {
    super("دفتر الأستاذ لا يدعم تسمية ضريبة قيد مرحّل.");
    this.name = "JournalTaxTagUnsupportedError";
  }
}

// INVARIANT: naming the rate moves the entry's amounts from the VAT return's
// unnamed row to a named one, so it is refused once the return covering the
// ENTRY's own date is filed — exactly as a posting dated there would be. A
// closed fiscal period does not refuse it: no balance moves.
export function createJournalTaxTagPort(deps: {
  readonly ledger: Pick<LedgerRepository, "findById" | "retagUnnamedTaxRate" | "retagUntaggedTaxRate">;
  readonly vatFilings?: JournalPostingDeps["vatFilings"];
}): JournalTaxTagPort {
  return {
    async retagUnnamedTaxRate(entryId, taxRatePercent, taxRateId, untagged) {
      const entry = await deps.ledger.findById(entryId);
      if (!entry) return 0;
      await assertVatNotFiled(entry.date, deps.vatFilings);
      if (!deps.ledger.retagUnnamedTaxRate) throw new JournalTaxTagUnsupportedError();
      const named = await deps.ledger.retagUnnamedTaxRate(entryId, taxRatePercent, taxRateId);
      if (named > 0 || !untagged || !deps.ledger.retagUntaggedTaxRate) return named;
      return deps.ledger.retagUntaggedTaxRate(entryId, untagged, taxRatePercent, taxRateId);
    },
  };
}
