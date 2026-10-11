import { classifyStoredTaxRate, type AppliedTaxRate } from "./applied-tax-rate.js";
import { TaxRateAlreadyClassifiedError } from "./errors.js";
import type { TaxRate } from "./tax-rate.js";

export interface PostedTaxLine {
  readonly lineRef: string;
  readonly label: string;
  readonly stored: AppliedTaxRate;
}

export interface ClassifyPostedLineTaxRequest {
  readonly lineRef: string;
  readonly withLineRefs?: readonly string[];
  readonly taxRateId: string;
}

export interface TaxClassificationPlan {
  readonly lineRefs: readonly string[];
  readonly before: AppliedTaxRate;
  readonly after: AppliedTaxRate;
  readonly taxRateName: string;
}

export enum TaxClassificationFilingOutcome {
  NotQueued = "not_queued",
  Requeued = "requeued",
  FiledConsistent = "filed_consistent",
}

export enum TaxClassificationAuditAction {
  ClassifyLineTax = "CLASSIFY_LINE_TAX",
}

export enum TaxClassificationAuditModule {
  Sales = "sales",
  Purchases = "purchases",
}

export enum TaxClassificationAuditEntity {
  SalesInvoice = "SALES_INVOICE",
  PurchaseInvoice = "PURCHASE_INVOICE",
}

export enum JournalLineSide {
  Debit = "debit",
  Credit = "credit",
}

// INVARIANT: an entry posted before journal lines carried a tax percent has
// NO tagged line, so the percent cannot find them. The selector says which of
// its lines are the document's base and tax lines; it is consulted only when
// the entry carries no tax percent anywhere.
export interface UntaggedJournalLineSelector {
  readonly accountIds?: readonly string[];
  readonly side?: JournalLineSide;
}

/** Writes the tax-rate tag on a posted entry's lines that carry none. */
export interface JournalTaxTagPort {
  retagUnnamedTaxRate(entryId: string, taxRatePercent: number, taxRateId: string, untagged?: UntaggedJournalLineSelector): Promise<number>;
}

export class TaxClassificationNotASupplyError extends Error {
  readonly code = "TAX_CLASSIFICATION_NOT_A_SUPPLY";
  readonly messageEn: string;
  constructor(readonly documentNumber: string) {
    super(`المستند ${documentNumber} إفراج عن محتجزات وليس توريداً، فلا ضريبة تُصنَّف على بنده.`);
    this.messageEn = `Document ${documentNumber} is a retention release, not a supply; its line carries no tax to classify.`;
    this.name = "TaxClassificationNotASupplyError";
  }
}

export class TaxClassificationStaleError extends Error {
  readonly code = "TAX_CLASSIFICATION_STALE";
  readonly messageEn: string;
  constructor(readonly documentNumber: string) {
    super(`تغيّر المستند ${documentNumber} أثناء تصنيف ضريبة بنده ولم يُحفظ شيء. أعد فتح المستند ثم صنّف البند من جديد.`);
    this.messageEn = `Document ${documentNumber} changed while its line was being classified and nothing was saved. Reopen it and classify the line again.`;
    this.name = "TaxClassificationStaleError";
  }
}

export class TaxClassificationJournalUntaggedError extends Error {
  readonly code = "TAX_CLASSIFICATION_JOURNAL_UNTAGGED";
  readonly messageEn: string;
  constructor(readonly documentNumber: string) {
    super(
      `قيد المستند ${documentNumber} لا يحمل سطراً يمكن تسمية ضريبته، فلم يُصنَّف البند حتى لا يختلف المستند عن قيده. راجع القيد مع المحاسب.`,
    );
    this.messageEn = `The journal entry of document ${documentNumber} has no line whose tax can be named, so the line was not classified — the document and its entry would disagree.`;
    this.name = "TaxClassificationJournalUntaggedError";
  }
}

export class PostedLineNotFoundError extends Error {
  readonly code = "DOCUMENT_LINE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly lineRef: string) {
    super(`البند "${lineRef}" غير موجود في هذا المستند.`);
    this.messageEn = `Line "${lineRef}" is not on this document.`;
    this.name = "PostedLineNotFoundError";
  }
}

export class TaxClassificationNotPostedError extends Error {
  readonly code = "TAX_CLASSIFICATION_NOT_POSTED";
  readonly messageEn: string;
  constructor(readonly statusLabelAr: string) {
    super(`تصنيف ضريبة البند متاح للمستند المرحّل فقط، وهذا المستند «${statusLabelAr}».`);
    this.messageEn = "A line's tax can be classified only on a posted document.";
    this.name = "TaxClassificationNotPostedError";
  }
}

export class TaxClassificationSharedPostingError extends Error {
  readonly code = "TAX_CLASSIFICATION_SHARED_POSTING";
  readonly messageEn: string;
  constructor(
    readonly sharedLineRefs: readonly string[],
    sharedLabels: readonly string[],
    percent: number,
  ) {
    super(
      `بنود هذا المستند غير المسماة بنسبة ${percent}٪ رُحّلت في قيد واحد وتُصنَّف معاً تحت ضريبة واحدة. أكّد تصنيف البنود التالية معه: ${sharedLabels.join("، ")}.`,
    );
    this.messageEn = `This document's unnamed lines at ${percent}% were posted on one journal line and are classified together under one rate. Confirm classifying these lines with it: ${sharedLabels.join(", ")}.`;
    this.name = "TaxClassificationSharedPostingError";
  }
}

export class TaxClassificationAlreadyFiledError extends Error {
  readonly code = "TAX_CLASSIFICATION_ALREADY_FILED";
  readonly messageEn: string;
  constructor(readonly documentNumber: string) {
    super(
      `المستند ${documentNumber} أُرسل لمصلحة الضرائب بتصنيف يخالف الضريبة المختارة، ولا يُغيَّر تصنيف مستند أُرسل. اختر الضريبة المطابقة لما أُرسل، أو صحّحه بإشعار دائن.`,
    );
    this.messageEn = `Document ${documentNumber} was filed with the tax authority under a classification the chosen rate contradicts, and a filed document's classification cannot change. Pick the rate matching what was filed, or correct it with a credit note.`;
    this.name = "TaxClassificationAlreadyFiledError";
  }
}

// INVARIANT: every unnamed line of one document at one percent shares
// journal lines (the VAT line always, the base line usually), and a journal
// line carries ONE rate. So they are classified together or not at all — the
// caller must name every one of them; nothing is swept in silently.
export function planTaxClassification(
  taxRates: readonly Pick<TaxRate, "id" | "name" | "rate" | "status">[] | null,
  lines: readonly PostedTaxLine[],
  request: ClassifyPostedLineTaxRequest,
): TaxClassificationPlan {
  const target = lines.find((l) => l.lineRef === request.lineRef);
  if (!target) throw new PostedLineNotFoundError(request.lineRef);
  const named = new Set([request.lineRef, ...(request.withLineRefs ?? [])]);
  for (const lineRef of named) {
    if (!lines.some((l) => l.lineRef === lineRef)) throw new PostedLineNotFoundError(lineRef);
  }
  const nameOf = (taxRateId: string): string => taxRates?.find((r) => r.id === taxRateId)?.name ?? taxRateId;
  for (const lineRef of named) {
    const line = lines.find((l) => l.lineRef === lineRef) as PostedTaxLine;
    if (line.stored.taxRateId !== null) throw new TaxRateAlreadyClassifiedError(line.stored.taxRateId, nameOf(line.stored.taxRateId));
    classifyStoredTaxRate(taxRates, line.stored, request.taxRateId);
  }
  const after = classifyStoredTaxRate(taxRates, target.stored, request.taxRateId);
  const group = lines.filter((l) => l.stored.taxRateId === null && l.stored.taxRatePercent === target.stored.taxRatePercent);
  const unconfirmed = group.filter((l) => !named.has(l.lineRef));
  if (unconfirmed.length > 0) {
    throw new TaxClassificationSharedPostingError(
      unconfirmed.map((l) => l.lineRef),
      unconfirmed.map((l) => l.label),
      target.stored.taxRatePercent,
    );
  }
  return { lineRefs: group.map((l) => l.lineRef), before: target.stored, after, taxRateName: nameOf(request.taxRateId) };
}
