p = "packages/domain/src/bank-reconciliation/errors.ts"
s = open(p).read()
block = """
/**
 * Raised when a statement is finalised while lines are still unmatched and no
 * explicit override was given. An unmatched line is a real difference — a bank
 * charge nobody booked, or a payment the books recorded and the bank did not —
 * and locking the statement over it buries the difference where nothing will
 * find it again (D82).
 */
export class StatementHasUnmatchedLinesError extends Error {
  readonly code = "STATEMENT_HAS_UNMATCHED_LINES";
  constructor(
    readonly statementId: string,
    readonly unmatchedCount: number,
  ) {
    super(
      `Bank statement "${statementId}" still has ${unmatchedCount} unmatched line(s); finalizing needs an explicit override with a reason.`,
    );
    this.name = "StatementHasUnmatchedLinesError";
  }
}

/** Raised when the unmatched-lines override is requested without a reason to record. */
export class FinalizeOverrideReasonRequiredError extends Error {
  readonly code = "FINALIZE_OVERRIDE_REASON_REQUIRED";
  constructor(readonly statementId: string) {
    super(`Finalizing bank statement "${statementId}" over unmatched lines requires a recorded reason.`);
    this.name = "FinalizeOverrideReasonRequiredError";
  }
}
"""
s = s + block
open(p, "w").write(s)
print("ok")
