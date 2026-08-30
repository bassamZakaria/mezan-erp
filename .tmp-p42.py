p = "packages/api/src/bank-reconciliation-routes.ts"
s = open(p).read()
edits = [
 ("""    finalizedAt: s.finalizedAt,\n  };""",
  """    finalizedAt: s.finalizedAt,\n    unmatchedAtFinalize: s.unmatchedAtFinalize ?? null,\n    finalizeOverrideReason: s.finalizeOverrideReason ?? null,\n    finalizedBy: s.finalizedBy ?? null,\n  };"""),
 ("""  if (err instanceof InvalidStatementFileError || err instanceof ColumnNotFoundError || err instanceof InvalidColumnMappingError) {""",
  """  if (err instanceof StatementHasUnmatchedLinesError) {\n    return c.json({ error: err.code, message: err.message, unmatchedCount: err.unmatchedCount }, 422);\n  }\n  if (err instanceof FinalizeOverrideReasonRequiredError) {\n    return c.json({ error: err.code, message: err.message }, 422);\n  }\n  if (err instanceof InvalidStatementFileError || err instanceof ColumnNotFoundError || err instanceof InvalidColumnMappingError) {"""),
]
for old, new in edits:
    assert old in s, old[:50]
    s = s.replace(old, new, 1)
open(p, "w").write(s)
print("ok")
