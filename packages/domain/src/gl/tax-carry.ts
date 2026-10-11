import type { DocumentRepository } from "../documents/document.js";
import {
  TaxClassificationReturnFiledError,
  TaxClassificationReturnMixedError,
  TaxClassificationStaleError,
  type JournalTaxTagPort,
  type TaxClassificationDependentsPort,
} from "../tax-rates/classify-posted-line-tax.js";
import { VatPeriodAlreadyFiledError } from "../tax/vat-filing.js";

interface SourcedTaxLine {
  readonly sourceInvoiceId: string;
  readonly taxRatePercent?: number | null;
  readonly taxRateId?: string | null;
}

const SOURCE_FIELD = "sourceInvoiceId";

// INVARIANT: every unnamed line of the invoice at this percent is being
// classified together (`planTaxClassification`), so every unnamed return line
// at this percent that cites the invoice belongs to one of them. A return in
// a month whose VAT return is filed refuses the whole classification.
export function createReturnTaxCarry<Line extends SourcedTaxLine>(deps: {
  readonly returns: DocumentRepository<Line>;
  readonly tags: JournalTaxTagPort;
}): TaxClassificationDependentsPort {
  const unnamedAt = (line: SourcedTaxLine, percent: number): boolean => (line.taxRateId ?? null) === null && (line.taxRatePercent ?? 0) === percent;
  return {
    async carry({ sourceDocumentId, taxRatePercent, taxRateId }) {
      const candidates = deps.returns.listByLineRef
        ? await deps.returns.listByLineRef(SOURCE_FIELD, [sourceDocumentId])
        : await deps.returns.list();
      const documentNumbers: string[] = [];
      let journalLinesNamed = 0;
      for (const doc of candidates) {
        const unnamed = doc.lines.filter((line) => unnamedAt(line, taxRatePercent));
        const mine = unnamed.filter((line) => line.sourceInvoiceId === sourceDocumentId);
        if (mine.length === 0) continue;
        const number = doc.docNo ?? doc.id;
        if (mine.length !== unnamed.length) throw new TaxClassificationReturnMixedError(number);
        if (doc.journalEntryId) {
          try {
            journalLinesNamed += await deps.tags.retagUnnamedTaxRate(doc.journalEntryId, taxRatePercent, taxRateId);
          } catch (err) {
            if (err instanceof VatPeriodAlreadyFiledError) throw new TaxClassificationReturnFiledError(number, err.date);
            throw err;
          }
        }
        const named = (await deps.returns.nameSourcedLineTaxRate?.(doc.id, sourceDocumentId, taxRatePercent, taxRateId)) ?? 0;
        if (named !== mine.length) throw new TaxClassificationStaleError(number);
        documentNumbers.push(number);
      }
      return { documentNumbers, journalLinesNamed };
    },
  };
}
