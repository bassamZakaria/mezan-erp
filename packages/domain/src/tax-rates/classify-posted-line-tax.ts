import { TaxClassificationFilingOutcomeCode } from "@mezan/contracts";
import { classifyStoredTaxRate, type AppliedTaxRate } from "./applied-tax-rate.js";
import { TaxRateAlreadyClassifiedError } from "./errors.js";
import type { TaxRate } from "./tax-rate.js";
import type { Money } from "../money/index.js";

export interface PostedTaxLine {
  readonly lineRef: string;
  readonly label: string;
  readonly stored: AppliedTaxRate;
}

export interface ClassifyPostedLineTaxRequest {
  readonly lineRef: string;
  readonly withLineRefs?: readonly string[];
  readonly taxRateId: string;
  readonly journalLineIndexes?: readonly number[];
}

export interface TaxClassificationPlan {
  readonly lineRefs: readonly string[];
  readonly before: AppliedTaxRate;
  readonly after: AppliedTaxRate;
  readonly taxRateName: string;
}

export { TaxClassificationFilingOutcomeCode as TaxClassificationFilingOutcome };

export enum TaxClassificationAuditAction {
  ClassifyLineTax = "CLASSIFY_LINE_TAX",
  CarryLineTax = "CARRY_LINE_TAX",
  NameJournalLineTax = "NAME_JOURNAL_LINE_TAX",
}

export enum TaxClassificationAuditModule {
  Sales = "sales",
  Purchases = "purchases",
}

export enum TaxClassificationAuditEntity {
  SalesInvoice = "SALES_INVOICE",
  PurchaseInvoice = "PURCHASE_INVOICE",
}

export class JournalTaxLineUnclassifiedError extends Error {
  readonly code = "JOURNAL_TAX_LINE_UNCLASSIFIED";
  readonly messageEn: string;
  constructor(readonly lineRef: string) {
    super(`البند "${lineRef}" لا يسمّي ضريبة بعد — اختر الضريبة مع سطور القيد ليُصنَّف البند وقيده معاً.`);
    this.messageEn = `Line "${lineRef}" names no tax yet — pick the rate together with the journal lines, so the line and its entry are classified at once.`;
    this.name = "JournalTaxLineUnclassifiedError";
  }
}

// INVARIANT: what a document's lines at one percent and one rate POST — the
// base lines and the VAT line — rebuilt by the document's own posting builder.
// An entry posted before journal lines carried a tax tag has nothing the
// percent can find, so these are what its untagged lines are matched against:
// same account, same debit, same credit. A line is named only when it is one
// of them; nothing is swept in by side or by account alone.
export interface ExpectedTaxJournalLine {
  readonly accountId: string;
  readonly debit: Money;
  readonly credit: Money;
}

export interface JournalLineTaxTag {
  readonly lineIndex: number;
  readonly accountId: string;
  readonly debit: string;
  readonly credit: string;
  readonly taxRatePercent: number | null;
  readonly taxRateId: string | null;
}

export interface ChosenJournalLinesNamed {
  readonly before: readonly JournalLineTaxTag[];
  readonly after: readonly JournalLineTaxTag[];
}

export interface JournalTaxTagPort {
  retagUnnamedTaxRate(entryId: string, taxRatePercent: number, taxRateId: string, expected?: readonly ExpectedTaxJournalLine[]): Promise<number>;
  /**
   * «تسمية ضريبة سطر القيد» — the accountant names the lines by hand, for an
   * entry the match above cannot resolve. The chosen lines must carry no rate
   * and be, account for account and amount for amount, the `expected` ones.
   */
  nameChosenLines(
    entryId: string,
    lineIndexes: readonly number[],
    taxRatePercent: number,
    taxRateId: string,
    expected: readonly ExpectedTaxJournalLine[],
  ): Promise<ChosenJournalLinesNamed>;
}

export interface TaxClassificationCarryRequest {
  readonly sourceDocumentId: string;
  readonly taxRatePercent: number;
  readonly taxRateId: string;
}

export interface TaxClassificationCarryResult {
  readonly documentNumbers: readonly string[];
  readonly journalLinesNamed: number;
}

// INVARIANT: a return's line is its invoice line, given back. Naming the
// invoice line's rate names it on every return already raised against it —
// their lines and their journal entries — inside the same transaction, or the
// classification does not happen at all.
export interface TaxClassificationDependentsPort {
  carry(request: TaxClassificationCarryRequest): Promise<TaxClassificationCarryResult>;
}

export class TaxClassificationReturnFiledError extends Error {
  readonly code = "TAX_CLASSIFICATION_RETURN_FILED";
  readonly messageEn: string;
  constructor(
    readonly returnNumber: string,
    readonly date: string,
  ) {
    super(
      `لا يمكن تصنيف ضريبة هذا البند: المرتجع ${returnNumber} الصادر عليه مؤرَّخ ${date} في فترة قُدِّم إقرار ضريبة القيمة المضافة عنها، وتصنيف البند يغيّر ما ورد في ذلك الإقرار. عدّل الإقرار أولاً.`,
    );
    this.messageEn = `This line's tax cannot be classified: return ${returnNumber} against it is dated ${date}, in a period whose VAT return is filed, and classifying the line would restate that return. Amend the filing first.`;
    this.name = "TaxClassificationReturnFiledError";
  }
}

export class TaxClassificationReturnMixedError extends Error {
  readonly code = "TAX_CLASSIFICATION_RETURN_MIXED";
  readonly messageEn: string;
  constructor(readonly returnNumber: string) {
    super(
      `المرتجع ${returnNumber} يجمع بنوداً غير مصنّفة الضريبة من أكثر من فاتورة بالنسبة نفسها في سطر قيد واحد، وسطر القيد يحمل ضريبة واحدة، فلا يُصنَّف بند إحدى الفاتورتين دون الأخرى. المرتجع المؤكد لا يُعكس؛ راجع المحاسب قبل تصنيف هذه البنود.`,
    );
    this.messageEn = `Return ${returnNumber} holds unclassified lines of more than one invoice at the same percent on one journal line, and a journal line carries one rate, so one invoice's line cannot be classified without the other's. A confirmed return cannot be reversed; refer to the accountant before classifying these lines.`;
    this.name = "TaxClassificationReturnMixedError";
  }
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
      `قيد المستند ${documentNumber} لا يحمل سطوراً تطابق بنوده بهذه الضريبة، فلم يُصنَّف البند حتى لا يختلف المستند عن قيده. افتح تبويب القيد في صفحة المستند واستخدم «تسمية ضريبة سطر القيد» لاختيار سطور القيد يدوياً.`,
    );
    this.messageEn = `The journal entry of document ${documentNumber} holds no lines matching its lines at this tax, so the line was not classified — the document and its entry would disagree. Open the document's journal tab and use "Name tax on journal line" to choose the lines by hand.`;
    this.name = "TaxClassificationJournalUntaggedError";
  }
}

export class JournalTaxLinesMismatchError extends Error {
  readonly code = "JOURNAL_TAX_LINES_MISMATCH";
  readonly messageEn: string;
  constructor(
    readonly entryId: string,
    readonly expectedLines: readonly { readonly accountId: string; readonly debit: string; readonly credit: string }[],
  ) {
    const wanted = expectedLines.map((line) => `${line.accountId} (مدين ${line.debit} / دائن ${line.credit})`).join("، ");
    super(
      `السطور المختارة لا تطابق ما رحّلته بنود المستند بهذه الضريبة. المطلوب اختيار: ${wanted || "لا شيء — هذه البنود لم ترحّل سطراً"}. إن كان القيد قد جمع هذه البنود مع غيرها في سطر واحد فلا تُسمّى ضريبته: ألغِ المستند وأعد إصداره.`,
    );
    this.messageEn = `The chosen lines are not what the document's lines at this tax posted. Expected: ${expectedLines.map((line) => `${line.accountId} (Dr ${line.debit} / Cr ${line.credit})`).join(", ") || "none"}.`;
    this.name = "JournalTaxLinesMismatchError";
  }
}

export class JournalTaxLineAlreadyNamedError extends Error {
  readonly code = "JOURNAL_TAX_LINE_ALREADY_NAMED";
  readonly messageEn: string;
  constructor(
    readonly entryId: string,
    readonly lineIndex: number,
  ) {
    super(`السطر رقم ${lineIndex + 1} من القيد يحمل ضريبة بالفعل أو غير موجود، ولا تُسمّى ضريبة سطر مرتين.`);
    this.messageEn = `Line ${lineIndex + 1} of the entry already names a tax, or does not exist; a line's tax is never named twice.`;
    this.name = "JournalTaxLineAlreadyNamedError";
  }
}

export class TaxClassificationReturnJournalUntaggedError extends Error {
  readonly code = "TAX_CLASSIFICATION_RETURN_JOURNAL_UNTAGGED";
  readonly messageEn: string;
  constructor(readonly returnNumber: string) {
    super(
      `قيد المرتجع ${returnNumber} الصادر على هذا البند لا يحمل سطوراً تطابق بنوده بهذه الضريبة، فلم يُصنَّف شيء حتى لا يختلف المرتجع عن قيده. افتح تبويب القيد في صفحة المرتجع واستخدم «تسمية ضريبة سطر القيد»، ثم صنّف البند.`,
    );
    this.messageEn = `The journal entry of return ${returnNumber} against this line holds no lines matching its lines at this tax, so nothing was classified. Open the return's journal tab, use "Name tax on journal line", then classify the line.`;
    this.name = "TaxClassificationReturnJournalUntaggedError";
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

export class TaxClassificationFiledUnreadableError extends Error {
  readonly code = "TAX_CLASSIFICATION_FILED_UNREADABLE";
  readonly messageEn: string;
  constructor(readonly documentNumber: string) {
    super(
      `المستند ${documentNumber} أُرسل لمصلحة الضرائب ولا يمكن قراءة التصنيف الذي أُرسل به، فلم يُصنَّف البند حتى لا يخالف ما لدى المصلحة. راجع المستند في شاشة الفاتورة الإلكترونية.`,
    );
    this.messageEn = `Document ${documentNumber} was filed with the tax authority and the classification it was filed under cannot be read, so the line was not classified — it could contradict what the authority holds.`;
    this.name = "TaxClassificationFiledUnreadableError";
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

// INVARIANT: a retry of a classification that already landed — the same lines
// under the same rate — is answered with what stands, never refused and never
// written again. Any other request against a named line is still refused.
export function alreadyClassifiedAs(
  taxRates: readonly Pick<TaxRate, "id" | "name">[] | null,
  lines: readonly PostedTaxLine[],
  request: ClassifyPostedLineTaxRequest,
): TaxClassificationPlan | null {
  if (request.journalLineIndexes) return null;
  const asked = [request.lineRef, ...(request.withLineRefs ?? [])].map((lineRef) => lines.find((line) => line.lineRef === lineRef));
  const target = asked[0];
  if (!target || asked.some((line) => !line || line.stored.taxRateId !== request.taxRateId)) return null;
  return {
    lineRefs: lines.filter((line) => line.stored.taxRateId === request.taxRateId && line.stored.taxRatePercent === target.stored.taxRatePercent).map((line) => line.lineRef),
    before: target.stored,
    after: target.stored,
    taxRateName: taxRates?.find((rate) => rate.id === request.taxRateId)?.name ?? request.taxRateId,
  };
}
