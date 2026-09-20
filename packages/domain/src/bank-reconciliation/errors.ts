/** Bank-reconciliation domain errors. Stable `code`s so the api/UI can branch. */

export class BankStatementNotFoundError extends Error {
  readonly code = "BANK_STATEMENT_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly statementId: string) {
    super(`كشف البنك "${statementId}" غير موجود.`);
    this.messageEn = `Bank statement "${statementId}" was not found.`;
    this.name = "BankStatementNotFoundError";
  }
}

export class StatementLineNotFoundError extends Error {
  readonly code = "STATEMENT_LINE_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly lineId: string) {
    super(`سطر الكشف "${lineId}" غير موجود.`);
    this.messageEn = `Statement line "${lineId}" was not found.`;
    this.name = "StatementLineNotFoundError";
  }
}

export class StatementAlreadyFinalizedError extends Error {
  readonly code = "STATEMENT_ALREADY_FINALIZED";
  readonly messageEn: string;
  constructor(readonly statementId: string) {
    super(`كشف البنك "${statementId}" منتهٍ بالفعل؛ لا يمكن تعديله.`);
    this.messageEn = `Bank statement "${statementId}" is already completed.`;
    this.name = "StatementAlreadyFinalizedError";
  }
}

export class LineAlreadyMatchedError extends Error {
  readonly code = "LINE_ALREADY_MATCHED";
  readonly messageEn: string;
  constructor(readonly lineId: string) {
    super(`سطر الكشف "${lineId}" مطابَق بالفعل.`);
    this.messageEn = `Statement line "${lineId}" is already matched.`;
    this.name = "LineAlreadyMatchedError";
  }
}

export class LineNotMatchedError extends Error {
  readonly code = "LINE_NOT_MATCHED";
  readonly messageEn: string;
  constructor(readonly lineId: string) {
    super(`سطر الكشف "${lineId}" غير مطابَق.`);
    this.messageEn = `Statement line "${lineId}" is not matched.`;
    this.name = "LineNotMatchedError";
  }
}

/**
 * Raised when an imported statement's opening or closing balance is too large
 * in magnitude to be stored exactly. `Money` is a bigint, but the SQLite
 * column it lands in is a JS number, so a value past the safe-integer range
 * cannot round-trip — and a balance that big is a typo, not a real figure.
 * Refusing it here is what keeps the route answering 422 instead of throwing
 * a RangeError at the writer and surfacing as a 500.
 */
export class InvalidStatementBalanceError extends Error {
  readonly code = "INVALID_OPENING_BALANCE";
  constructor(
    readonly statementId: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "InvalidStatementBalanceError";
  }
}

/** Raised by the CSV parser/mapper on structurally invalid input. */
export class InvalidStatementFileError extends Error {
  readonly code = "INVALID_STATEMENT_FILE";
  readonly messageEn: string;
  constructor(message: string, messageEn: string) {
    super(message);
    this.messageEn = messageEn;
    this.name = "InvalidStatementFileError";
  }
}

/** Raised when a column mapping names a column absent from the CSV's header row. */
export class ColumnNotFoundError extends Error {
  readonly code = "COLUMN_NOT_FOUND";
  readonly messageEn: string;
  constructor(readonly columnName: string) {
    super(`العمود "${columnName}" غير موجود في صف عناوين ملف الكشف.`);
    this.messageEn = `Column "${columnName}" was not found in the statement file's header row.`;
    this.name = "ColumnNotFoundError";
  }
}

/** Raised when a mapping sets neither `amountColumn` nor both `debitColumn`+`creditColumn`. */
export class InvalidColumnMappingError extends Error {
  readonly code = "INVALID_COLUMN_MAPPING";
  readonly messageEn: string;
  constructor(message: string, messageEn: string) {
    super(message);
    this.messageEn = messageEn;
    this.name = "InvalidColumnMappingError";
  }
}

/**
 * Raised when a statement is finalised while lines are still unmatched and no
 * explicit override was given. An unmatched line is a real difference — a bank
 * charge nobody booked, or a payment the books recorded and the bank did not —
 * and locking the statement over it buries the difference where nothing will
 * find it again (D82).
 */
export class StatementHasUnmatchedLinesError extends Error {
  readonly code = "STATEMENT_HAS_UNMATCHED_LINES";
  readonly messageEn: string;
  constructor(
    readonly statementId: string,
    readonly unmatchedCount: number,
  ) {
    super(
      `كشف البنك "${statementId}" ما زال به ${unmatchedCount} سطراً غير مطابَق؛ الإنهاء يتطلب تجاوزاً صريحاً مع سبب.`,
    );
    this.messageEn = `Bank statement "${statementId}" still has ${unmatchedCount} unmatched line(s); finalizing needs an explicit override with a reason.`;
    this.name = "StatementHasUnmatchedLinesError";
  }
}

/** Raised when the unmatched-lines override is requested without a reason to record. */
export class FinalizeOverrideReasonRequiredError extends Error {
  readonly code = "FINALIZE_OVERRIDE_REASON_REQUIRED";
  readonly messageEn: string;
  constructor(readonly statementId: string) {
    super(`إنهاء كشف البنك "${statementId}" مع وجود سطور غير مطابَقة يتطلب تسجيل سبب.`);
    this.messageEn = `Finalizing bank statement "${statementId}" over unmatched lines requires a recorded reason.`;
    this.name = "FinalizeOverrideReasonRequiredError";
  }
}

function bilingual<T extends Error & { messageEn: string }>(err: T, ar: string, en: string, name: string): void {
  err.message = ar;
  err.messageEn = en;
  err.name = name;
}

export class StatementDifferenceNotZeroError extends Error {
  readonly code = "STATEMENT_DIFFERENCE_NOT_ZERO";
  messageEn = "";
  constructor(
    readonly statementId: string,
    readonly difference: string,
  ) {
    super();
    bilingual(
      this,
      `فرق التسوية لكشف البنك "${statementId}" ليس صفراً (${difference})؛ الإنهاء يتطلب تجاوزاً صريحاً مع سبب.`,
      `Bank statement "${statementId}" still has a reconciliation difference of ${difference}; finalizing needs an explicit override with a reason.`,
      "StatementDifferenceNotZeroError",
    );
  }
}

export class LineNotOnStatementError extends Error {
  readonly code = "LINE_NOT_ON_STATEMENT";
  messageEn = "";
  constructor(
    readonly statementId: string,
    readonly lineId: string,
  ) {
    super();
    bilingual(
      this,
      `السطر "${lineId}" لا يخص كشف البنك "${statementId}".`,
      `Line "${lineId}" does not belong to bank statement "${statementId}".`,
      "LineNotOnStatementError",
    );
  }
}

export class EntryNotOnTreasuryAccountError extends Error {
  readonly code = "ENTRY_NOT_ON_TREASURY_ACCOUNT";
  messageEn = "";
  constructor(readonly entryId: string) {
    super();
    bilingual(
      this,
      `القيد "${entryId}" لا يحرّك حساب البنك الخاص بهذا الكشف.`,
      `Entry "${entryId}" does not move this statement's bank account.`,
      "EntryNotOnTreasuryAccountError",
    );
  }
}

export class EntryAlreadyMatchedError extends Error {
  readonly code = "ENTRY_ALREADY_MATCHED";
  messageEn = "";
  constructor(readonly entryId: string) {
    super();
    bilingual(
      this,
      `القيد "${entryId}" مطابَق بالفعل مع سطر آخر من كشوف هذا الحساب.`,
      `Entry "${entryId}" is already matched to another statement line of this account.`,
      "EntryAlreadyMatchedError",
    );
  }
}

export class MatchAmountMismatchError extends Error {
  readonly code = "MATCH_AMOUNT_MISMATCH";
  messageEn = "";
  constructor(
    readonly lineId: string,
    readonly lineAmount: string,
    readonly entriesAmount: string,
  ) {
    super();
    bilingual(
      this,
      `مبلغ السطر (${lineAmount}) لا يساوي مجموع القيود المختارة (${entriesAmount}) بالضبط.`,
      `The line amount (${lineAmount}) does not equal the selected entries' total (${entriesAmount}) exactly.`,
      "MatchAmountMismatchError",
    );
  }
}

export class NoEntriesSelectedError extends Error {
  readonly code = "NO_ENTRIES_SELECTED";
  messageEn = "";
  constructor(readonly lineId: string) {
    super();
    bilingual(this, "اختر قيداً واحداً على الأقل للمطابقة.", "Select at least one entry to match.", "NoEntriesSelectedError");
  }
}

export class SuggestionNotFoundError extends Error {
  readonly code = "SUGGESTION_NOT_FOUND";
  messageEn = "";
  constructor(readonly suggestionId: string) {
    super();
    bilingual(this, `اقتراح المطابقة "${suggestionId}" غير موجود.`, `Match suggestion "${suggestionId}" was not found.`, "SuggestionNotFoundError");
  }
}

export class SuggestionNotPendingError extends Error {
  readonly code = "SUGGESTION_NOT_PENDING";
  messageEn = "";
  constructor(readonly suggestionId: string) {
    super();
    bilingual(
      this,
      `اقتراح المطابقة "${suggestionId}" تم البت فيه بالفعل.`,
      `Match suggestion "${suggestionId}" has already been decided.`,
      "SuggestionNotPendingError",
    );
  }
}

export class BankRuleNotFoundError extends Error {
  readonly code = "BANK_RULE_NOT_FOUND";
  messageEn = "";
  constructor(readonly ruleId: string) {
    super();
    bilingual(this, `قاعدة البنك "${ruleId}" غير موجودة.`, `Bank rule "${ruleId}" was not found.`, "BankRuleNotFoundError");
  }
}

export class InvalidBankRuleError extends Error {
  readonly code = "INVALID_BANK_RULE";
  messageEn = "";
  constructor(message: string, messageEn: string) {
    super();
    bilingual(this, message, messageEn, "InvalidBankRuleError");
  }
}

export class EntryAccountRequiredError extends Error {
  readonly code = "ENTRY_ACCOUNT_REQUIRED";
  messageEn = "";
  constructor(readonly lineId: string) {
    super();
    bilingual(
      this,
      "لا توجد قاعدة بنك تنطبق على هذا السطر؛ اختر الحساب المقابل للقيد.",
      "No bank rule applies to this line; choose the counter account for the entry.",
      "EntryAccountRequiredError",
    );
  }
}

export class InvalidEntryAccountError extends Error {
  readonly code = "INVALID_ENTRY_ACCOUNT";
  messageEn = "";
  constructor(message: string, messageEn: string) {
    super();
    bilingual(this, message, messageEn, "InvalidEntryAccountError");
  }
}

export class EntryDateBeforeLineError extends Error {
  readonly code = "ENTRY_DATE_BEFORE_LINE";
  messageEn = "";
  constructor(
    readonly lineDate: string,
    readonly date: string,
  ) {
    super();
    bilingual(
      this,
      `لا يمكن تأريخ القيد (${date}) قبل تاريخ حركة البنك (${lineDate}).`,
      `The entry date (${date}) cannot be earlier than the bank line's date (${lineDate}).`,
      "EntryDateBeforeLineError",
    );
  }
}

export class ZeroAmountLineError extends Error {
  readonly code = "ZERO_AMOUNT_LINE";
  messageEn = "";
  constructor(readonly lineId: string) {
    super();
    bilingual(this, "سطر بمبلغ صفر لا يُنشأ له قيد.", "A zero-amount line cannot create an entry.", "ZeroAmountLineError");
  }
}

export class TreasuryAccountUnpostableError extends Error {
  readonly code = "TREASURY_ACCOUNT_UNPOSTABLE";
  messageEn = "";
  constructor(readonly treasuryAccountId: string) {
    super();
    bilingual(
      this,
      `حساب الخزينة "${treasuryAccountId}" غير موجود أو غير مربوط بحساب في دليل الحسابات.`,
      `Treasury account "${treasuryAccountId}" does not exist or has no linked GL account.`,
      "TreasuryAccountUnpostableError",
    );
  }
}

export class DuplicateStatementImportError extends Error {
  readonly code = "DUPLICATE_STATEMENT_IMPORT";
  messageEn = "";
  constructor(
    readonly existingStatementId: string,
    readonly existingStatementNumber: string | null,
  ) {
    super();
    const label = existingStatementNumber ? `«${existingStatementNumber}»` : `"${existingStatementId}"`;
    bilingual(
      this,
      `سبق استيراد هذا الكشف بالكامل؛ افتح الكشف ${label} بدلاً من استيراده مرة أخرى.`,
      `This statement was already imported; open statement ${label} instead of importing it again.`,
      "DuplicateStatementImportError",
    );
  }
}

export class StatementCurrencyMismatchError extends Error {
  readonly code = "STATEMENT_CURRENCY_MISMATCH";
  messageEn = "";
  constructor(
    readonly fileCurrency: string,
    readonly accountCurrency: string,
  ) {
    super();
    bilingual(
      this,
      `عملة الملف (${fileCurrency}) تختلف عن عملة حساب الخزينة (${accountCurrency})؛ اختر الحساب الصحيح.`,
      `The file's currency (${fileCurrency}) differs from the treasury account's currency (${accountCurrency}); choose the right account.`,
      "StatementCurrencyMismatchError",
    );
  }
}

export class StatementAccountMismatchError extends Error {
  readonly code = "STATEMENT_ACCOUNT_MISMATCH";
  messageEn = "";
  constructor(
    readonly fileAccountNumber: string,
    readonly accountNumber: string,
  ) {
    super();
    bilingual(
      this,
      `رقم الحساب في الملف (${fileAccountNumber}) لا يطابق رقم حساب الخزينة (${accountNumber}).`,
      `The account number in the file (${fileAccountNumber}) does not match the treasury account's number (${accountNumber}).`,
      "StatementAccountMismatchError",
    );
  }
}

export class TreasuryAccountNumberMissingError extends Error {
  readonly code = "TREASURY_ACCOUNT_NUMBER_MISSING";
  messageEn = "";
  constructor(
    readonly treasuryAccountId: string,
    readonly fileAccountNumber: string,
  ) {
    super();
    bilingual(
      this,
      `الملف يخص الحساب البنكي ${fileAccountNumber}، ولا يحمل حساب الخزينة رقم حساب بنكي يُقارن به؛ سجّل رقم الحساب البنكي أولاً.`,
      `The file belongs to bank account ${fileAccountNumber}, and the treasury account carries no bank account number to check it against; record the bank account number first.`,
      "TreasuryAccountNumberMissingError",
    );
  }
}

export class MatchCurrencyMismatchError extends Error {
  readonly code = "MATCH_CURRENCY_MISMATCH";
  messageEn = "";
  constructor(
    readonly entryId: string,
    readonly entryCurrency: string,
    readonly statementCurrency: string,
  ) {
    super();
    bilingual(
      this,
      `القيد "${entryId}" مُرحَّل بعملة ${entryCurrency} بينما الكشف بعملة ${statementCurrency}؛ لا يمكن مطابقته دون سعر صرف مُسجَّل على القيد.`,
      `Entry "${entryId}" is posted in ${entryCurrency} while the statement is in ${statementCurrency}; it cannot be matched without a rate recorded on the posting.`,
      "MatchCurrencyMismatchError",
    );
  }
}

export class StatementOutOfBranchScopeError extends Error {
  readonly code = "STATEMENT_OUT_OF_BRANCH_SCOPE";
  messageEn = "";
  constructor(readonly statementId: string) {
    super();
    bilingual(
      this,
      "كشف البنك يخص فرعاً خارج نطاق صلاحيتك.",
      "This bank statement belongs to a branch outside your authority.",
      "StatementOutOfBranchScopeError",
    );
  }
}

export class TreasuryAccountOutOfBranchScopeError extends Error {
  readonly code = "TREASURY_ACCOUNT_OUT_OF_BRANCH_SCOPE";
  messageEn = "";
  constructor(readonly treasuryAccountId: string) {
    super();
    bilingual(
      this,
      "حساب الخزينة يخص فرعاً خارج نطاق صلاحيتك.",
      "This treasury account belongs to a branch outside your authority.",
      "TreasuryAccountOutOfBranchScopeError",
    );
  }
}
