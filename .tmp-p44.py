p = "packages/api/src/bank-reconciliation-routes.ts"
s = open(p).read()
edits = [
 ("  StatementAlreadyFinalizedError,\n  StatementLineNotFoundError,",
  "  FinalizeOverrideReasonRequiredError,\n  StatementAlreadyFinalizedError,\n  StatementHasUnmatchedLinesError,\n  StatementLineNotFoundError,"),
 ("import { createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from \"./permission-gate.js\";",
  "import { callerUserId, createPermissionGate, headerAuthContextResolver, type AuthContextResolver } from \"./permission-gate.js\";"),
]
for old, new in edits:
    assert old in s, old[:50]
    s = s.replace(old, new, 1)
open(p, "w").write(s)
print("ok")
