import type { Money } from "../money/index.js";

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
  /**
   * Names ONLY the unnamed lines that are, account for account and amount for
   * amount, the `expected` ones — all of them or none. For an entry that holds
   * other documents' unnamed lines at the same percent.
   */
  nameExpectedLines(entryId: string, taxRatePercent: number, taxRateId: string, expected: readonly ExpectedTaxJournalLine[]): Promise<number>;
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

