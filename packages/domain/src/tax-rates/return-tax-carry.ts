import type { DocumentRepository, DocumentTypeDefinition, FrameworkDocument } from "../documents/document.js";
import { isStandingReturn } from "../documents/return-availability.js";
import {
  TaxClassificationReturnDisagreesError,
  TaxClassificationReturnFiledError,
  TaxClassificationReturnJournalUntaggedError,
  TaxClassificationReturnMixedError,
  TaxClassificationStaleError,
  type ExpectedTaxJournalLine,
  type JournalTaxTagPort,
  type TaxClassificationDependentsPort,
} from "./classify-posted-line-tax.js";
import { VatPeriodAlreadyFiledError } from "../tax/vat-filing.js";

interface SourcedTaxLine {
  readonly sourceInvoiceId: string;
  readonly sourceInvoiceNumber?: string | null;
  readonly taxRatePercent?: number | null;
  readonly taxRateId?: string | null;
}

const SOURCE_FIELD = "sourceInvoiceId";

export interface ReturnTaxFilingPort<Line> {
  reconcile(change: { readonly before: FrameworkDocument<Line>; readonly after: FrameworkDocument<Line> }): Promise<void>;
}

// INVARIANT: every unnamed line of the invoice at this percent is being
// classified together (`planTaxClassification`), so every unnamed return line
// at this percent that cites the invoice belongs to one of them. A return in
// a month whose VAT return is filed refuses the whole classification, and so
// does a posted return whose journal cannot be named: the return's line, its
// entry and its e-document are named together or the classification does not
// happen at all. A line that stored NO percent is not a 0% line and is never
// matched as one.
export function createReturnTaxCarry<Line extends SourcedTaxLine>(deps: {
  readonly returns: DocumentRepository<Line>;
  readonly tags: JournalTaxTagPort;
  readonly expected: (doc: FrameworkDocument<Line>, taxRatePercent: number, sourceInvoiceId?: string) => readonly ExpectedTaxJournalLine[];
  readonly filing?: ReturnTaxFilingPort<Line>;
}): TaxClassificationDependentsPort {
  const unnamedAt = (line: SourcedTaxLine, percent: number): boolean => (line.taxRateId ?? null) === null && line.taxRatePercent === percent;
  return {
    async carry({ sourceDocumentId, taxRatePercent, taxRateId }) {
      const candidates = deps.returns.listByLineRef
        ? await deps.returns.listByLineRef(SOURCE_FIELD, [sourceDocumentId])
        : await deps.returns.list();
      const documentNumbers: string[] = [];
      let journalLinesNamed = 0;
      for (const doc of candidates) {
        const number = doc.docNo ?? doc.id;
        // A return whose lines were named on the return itself holds this
        // invoice's lines to that rate: the invoice is never classified apart.
        const disagreeing = doc.lines.find(
          (line) => line.sourceInvoiceId === sourceDocumentId && line.taxRatePercent === taxRatePercent && (line.taxRateId ?? null) !== null && line.taxRateId !== taxRateId,
        );
        if (disagreeing && isStandingReturn(doc)) throw new TaxClassificationReturnDisagreesError(number, disagreeing.taxRateId as string);
        const unnamed = doc.lines.filter((line) => unnamedAt(line, taxRatePercent));
        const mine = unnamed.filter((line) => line.sourceInvoiceId === sourceDocumentId);
        if (mine.length === 0) continue;
        // INVARIANT: an entry that also holds another invoice's unnamed lines
        // at this percent is named by amount, this invoice's lines alone. One
        // posted before the split holds them merged, matches nothing and is
        // refused — never named for both invoices by one of them.
        const shared = mine.length !== unnamed.length;
        if (doc.journalEntryId) {
          const expected = deps.expected(doc, taxRatePercent, shared ? sourceDocumentId : undefined);
          let named = 0;
          try {
            named = shared
              ? await deps.tags.nameExpectedLines(doc.journalEntryId, taxRatePercent, taxRateId, expected)
              : await deps.tags.retagUnnamedTaxRate(doc.journalEntryId, taxRatePercent, taxRateId, expected);
          } catch (err) {
            if (err instanceof VatPeriodAlreadyFiledError) throw new TaxClassificationReturnFiledError(number, err.date);
            throw err;
          }
          if (named === 0 && shared) {
            throw new TaxClassificationReturnMixedError(number, [...new Set(unnamed.map((line) => line.sourceInvoiceNumber ?? line.sourceInvoiceId))]);
          }
          if (named === 0 && expected.length > 0) throw new TaxClassificationReturnJournalUntaggedError(number);
          journalLinesNamed += named;
        }
        const named = (await deps.returns.nameSourcedLineTaxRate?.(doc.id, sourceDocumentId, taxRatePercent, taxRateId)) ?? 0;
        if (named !== mine.length) throw new TaxClassificationStaleError(number);
        const after = await deps.returns.findById(doc.id);
        if (after && deps.filing) await deps.filing.reconcile({ before: doc, after });
        documentNumbers.push(number);
      }
      return { documentNumbers, journalLinesNamed };
    },
  };
}

export function expectedReturnTaxJournalLines<Line extends { readonly sourceInvoiceId: string }>(
  definition: Pick<DocumentTypeDefinition<Line>, "buildGlPosting">,
): (doc: FrameworkDocument<Line>, taxRatePercent: number, sourceInvoiceId?: string, taxRateId?: string | null) => readonly ExpectedTaxJournalLine[] {
  return (doc, taxRatePercent, sourceInvoiceId, taxRateId = null) => {
    const scoped = sourceInvoiceId === undefined ? doc : { ...doc, lines: doc.lines.filter((line) => line.sourceInvoiceId === sourceInvoiceId) };
    return (definition.buildGlPosting?.(scoped)?.lines ?? [])
      .filter((line) => line.taxRatePercent === taxRatePercent && (line.taxRateId ?? null) === taxRateId)
      .map((line) => ({ accountId: line.accountId, debit: line.debit, credit: line.credit }));
  };
}
