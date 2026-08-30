p = "packages/domain/src/bank-reconciliation/index.ts"
s = open(p).read()
edits = [
 ("export {\n  BankStatementNotFoundError,",
  "export {\n  BankStatementNotFoundError,\n  FinalizeOverrideReasonRequiredError,\n  StatementHasUnmatchedLinesError,"),
 ("  type ImportStatementCommand,",
  "  type FinalizeOptions,\n  type ImportStatementCommand,"),
]
for old, new in edits:
    assert old in s, old[:40]
    s = s.replace(old, new, 1)
open(p, "w").write(s)
print("ok")
