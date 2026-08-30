p = "packages/domain/src/bank-reconciliation/reconciliation-service.test.ts"
s = open(p).read()
o = "import {\n  LineAlreadyMatchedError,\n  LineNotMatchedError,\n  StatementAlreadyFinalizedError,\n} from \"./errors.js\";"
n = "import {\n  FinalizeOverrideReasonRequiredError,\n  LineAlreadyMatchedError,\n  LineNotMatchedError,\n  StatementAlreadyFinalizedError,\n  StatementHasUnmatchedLinesError,\n} from \"./errors.js\";"
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
