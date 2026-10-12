import { AuditSeverityCode, recordSensitiveEvent, type AuditSink } from "../audit/index.js";
import type { DocumentRepository, FrameworkDocument } from "../documents/document.js";
import { DocumentNotFoundError } from "../documents/errors.js";
import { isStandingReturn } from "../documents/return-availability.js";
import { DOCUMENT_STATUS_LABELS_AR } from "../documents/status.js";
import {
  JournalTaxLineUnclassifiedError,
  JournalTaxLinesMismatchError,
  PostedLineNotFoundError,
  SystemTaxRateOnlyError,
  TaxClassificationAuditAction,
  TaxClassificationJournalUntaggedError,
  TaxClassificationNotPostedError,
  TaxClassificationStaleError,
  TaxRateAlreadyClassifiedError,
  isSystemTaxRate,
  planTaxClassification,
  type AppliedTaxRate,
  type ChosenJournalLinesNamed,
  type ExpectedTaxJournalLine,
  type JournalTaxTagPort,
  type TaxClassificationPlan,
  type TaxRateRepository,
} from "../tax-rates/index.js";
import type { ReturnTaxFilingPort } from "./tax-carry.js";

interface ReturnTaxLine {
  readonly itemId: string;
  readonly sourceInvoiceId: string;
  readonly taxRatePercent?: number | null;
  readonly taxRateId?: string | null;
}

export interface NameReturnJournalLineTaxDeps<Line extends ReturnTaxLine> {
  readonly returns: DocumentRepository<Line>;
  readonly tags: JournalTaxTagPort;
  readonly taxRates: Pick<TaxRateRepository, "list">;
  readonly expected: (
    doc: FrameworkDocument<Line>,
    taxRatePercent: number,
    sourceInvoiceId?: string,
    taxRateId?: string | null,
  ) => readonly ExpectedTaxJournalLine[] | Promise<readonly ExpectedTaxJournalLine[]>;
  /** The rate the source invoice line names, null when it names none, undefined when it cannot be read. */
  readonly sourceRateOf?: (line: Line) => Promise<string | null | undefined>;
  readonly filing?: ReturnTaxFilingPort<Line>;
  readonly audit?: AuditSink;
  readonly auditModule: string;
  readonly branchOf?: (doc: FrameworkDocument<Line>) => string | null;
}

export interface NameReturnJournalLineTaxRequest {
  readonly lineRef: string;
  readonly taxRateId?: string;
  readonly journalLineIndexes: readonly number[];
  readonly actor?: string;
}

export interface NameReturnJournalLineTaxResult<Line> {
  readonly document: FrameworkDocument<Line>;
  readonly plan: TaxClassificationPlan;
  readonly journalLinesNamed: number;
}

function mergedByAccount(lines: readonly ExpectedTaxJournalLine[]): ExpectedTaxJournalLine[] {
  const byAccount = new Map<string, ExpectedTaxJournalLine>();
  for (const line of lines) {
    const slot = byAccount.get(line.accountId);
    byAccount.set(line.accountId, slot ? { accountId: line.accountId, debit: slot.debit.add(line.debit), credit: slot.credit.add(line.credit) } : line);
  }
  return [...byAccount.values()];
}

// INVARIANT: the return's line, its journal lines and its e-document are
// named in ONE transaction, on the return read inside it. A line that names
// no rate takes the one asked for only when the source invoice's line does
// not name another, and every unnamed line of the return at that percent
// takes it together — they share the journal lines being named.
export async function nameReturnJournalLineTax<Line extends ReturnTaxLine>(
  id: string,
  request: NameReturnJournalLineTaxRequest,
  deps: NameReturnJournalLineTaxDeps<Line>,
): Promise<NameReturnJournalLineTaxResult<Line>> {
  return deps.returns.transaction(async () => {
    const doc = await deps.returns.findById(id);
    if (!doc) throw new DocumentNotFoundError(deps.auditModule, id);
    const number = doc.docNo ?? doc.id;
    if (!isStandingReturn(doc) || !doc.journalEntryId) throw new TaxClassificationNotPostedError(DOCUMENT_STATUS_LABELS_AR[doc.status]);
    const target = doc.lines[Number(request.lineRef)];
    const taxRatePercent = target?.taxRatePercent;
    if (!target || taxRatePercent === null || taxRatePercent === undefined) throw new PostedLineNotFoundError(request.lineRef);
    const storedRateId = target.taxRateId ?? null;
    const taxRates = await deps.taxRates.list();
    const nameOf = (rateId: string): string => taxRates.find((rate) => rate.id === rateId)?.name ?? rateId;
    if (storedRateId !== null && request.taxRateId && request.taxRateId !== storedRateId) {
      throw new TaxRateAlreadyClassifiedError(storedRateId, nameOf(storedRateId));
    }
    const taxRateId = storedRateId ?? request.taxRateId;
    if (!taxRateId) throw new JournalTaxLineUnclassifiedError(request.lineRef);

    const unnamed = doc.lines
      .map((line, index) => ({ line, lineRef: String(index) }))
      .filter(({ line }) => (line.taxRateId ?? null) === null && line.taxRatePercent === taxRatePercent);
    let plan: TaxClassificationPlan;
    if (storedRateId === null) {
      if (isSystemTaxRate(taxRateId)) throw new SystemTaxRateOnlyError(taxRateId, nameOf(taxRateId));
      plan = planTaxClassification(
        taxRates,
        doc.lines.map((line, index) => ({
          lineRef: String(index),
          label: line.itemId,
          stored: { taxRateId: line.taxRateId ?? null, taxRatePercent: line.taxRatePercent ?? Number.NaN },
        })),
        { lineRef: request.lineRef, taxRateId, withLineRefs: unnamed.map(({ lineRef }) => lineRef).filter((lineRef) => lineRef !== request.lineRef) },
      );
      for (const { line } of unnamed) {
        const sourceRateId = await deps.sourceRateOf?.(line);
        if (sourceRateId && sourceRateId !== taxRateId) throw new TaxRateAlreadyClassifiedError(sourceRateId, nameOf(sourceRateId));
      }
    } else {
      const stored: AppliedTaxRate = { taxRateId: storedRateId, taxRatePercent };
      plan = {
        lineRefs: doc.lines.flatMap((line, index) => ((line.taxRateId ?? null) === storedRateId && line.taxRatePercent === taxRatePercent ? [String(index)] : [])),
        before: stored,
        after: stored,
        taxRateName: nameOf(storedRateId),
      };
    }

    const expected = await deps.expected(doc, taxRatePercent, undefined, storedRateId);
    if (expected.length === 0) throw new TaxClassificationJournalUntaggedError(number);
    // An entry posted before the split per source invoice holds each
    // account's lines merged; it is matched against the merged figures.
    let journalLines: ChosenJournalLinesNamed;
    try {
      journalLines = await deps.tags.nameChosenLines(doc.journalEntryId, request.journalLineIndexes, taxRatePercent, taxRateId, expected);
    } catch (err) {
      const merged = mergedByAccount(expected);
      if (!(err instanceof JournalTaxLinesMismatchError) || merged.length === expected.length) throw err;
      journalLines = await deps.tags.nameChosenLines(doc.journalEntryId, request.journalLineIndexes, taxRatePercent, taxRateId, merged);
    }

    let after = doc;
    if (storedRateId === null) {
      let named = 0;
      for (const sourceInvoiceId of new Set(unnamed.map(({ line }) => line.sourceInvoiceId))) {
        named += (await deps.returns.nameSourcedLineTaxRate?.(doc.id, sourceInvoiceId, taxRatePercent, taxRateId)) ?? 0;
      }
      if (named !== unnamed.length) throw new TaxClassificationStaleError(number);
      after = (await deps.returns.findById(doc.id)) ?? doc;
      if (deps.filing) await deps.filing.reconcile({ before: doc, after });
    }
    if (deps.audit) {
      await recordSensitiveEvent(deps.audit, {
        module: deps.auditModule,
        entityType: doc.docType,
        entityId: doc.id,
        action: TaxClassificationAuditAction.NameJournalLineTax,
        actor: request.actor ?? "system",
        branchId: deps.branchOf?.(doc) ?? null,
        severity: AuditSeverityCode.Warning,
        details: { returnId: doc.id, number, lineIds: plan.lineRefs, before: plan.before, after: { taxRateId, taxRatePercent }, taxRateId, taxRateName: plan.taxRateName, journalLines },
      });
    }
    return { document: after, plan: { ...plan, after: { taxRateId, taxRatePercent } }, journalLinesNamed: journalLines.after.length };
  });
}
