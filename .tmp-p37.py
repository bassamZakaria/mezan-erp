p = "packages/domain/src/bank-reconciliation/reconciliation-service.ts"
s = open(p).read()
o = """  /** Lock the statement: قيد التسوية/مستورد → منتهية. Idempotency-guarded — cannot finalize twice. */
  async finalize(statementId: string): Promise<BankStatement> {
    const statement = await this.require(statementId);
    this.assertNotFinalized(statement);
    const updated: BankStatement = { ...statement, status: "completed", finalizedAt: this.now() };
    await this.deps.statements.update(updated);
    return updated;
  }"""
n = open(".tmp-fin.txt").read().rstrip("\\n")
assert o in s
s = s.replace(o, n, 1)
o2 = """  StatementAlreadyFinalizedError,
  StatementLineNotFoundError,
} from "./errors.js";"""
n2 = """  FinalizeOverrideReasonRequiredError,
  StatementAlreadyFinalizedError,
  StatementHasUnmatchedLinesError,
  StatementLineNotFoundError,
} from "./errors.js";

/**
 * Finalising over unmatched lines is a deliberate, recorded act — never a
 * default. `reason` is mandatory whenever `force` is set.
 */
export interface FinalizeOptions {
  readonly force?: boolean;
  readonly reason?: string;
  readonly actor?: string | null;
}"""
assert o2 in s
s = s.replace(o2, n2, 1)
open(p, "w").write(s)
print("ok")
