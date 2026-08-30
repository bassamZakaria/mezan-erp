p = "packages/persistence/src/bank-reconciliation-repository.ts"
s = open(p).read()
edits = [
 ("""  imported_at         TEXT NOT NULL,\n  finalized_at        TEXT\n);""",
  """  imported_at         TEXT NOT NULL,\n  finalized_at        TEXT,\n  unmatched_at_finalize      INTEGER,\n  finalize_override_reason   TEXT,\n  finalized_by               TEXT\n);"""),
 ("""  imported_at: string;\n  finalized_at: string | null;\n}""",
  """  imported_at: string;\n  finalized_at: string | null;\n  unmatched_at_finalize: bigint | number | null;\n  finalize_override_reason: string | null;\n  finalized_by: string | null;\n}"""),
 ("""    importedAt: row.imported_at,\n    finalizedAt: row.finalized_at,\n  };""",
  """    importedAt: row.imported_at,\n    finalizedAt: row.finalized_at,\n    unmatchedAtFinalize: row.unmatched_at_finalize === null ? null : Number(row.unmatched_at_finalize),\n    finalizeOverrideReason: row.finalize_override_reason,\n    finalizedBy: row.finalized_by,\n  };"""),
 ("""    imported_at: s.importedAt,\n    finalized_at: s.finalizedAt,\n  };""",
  """    imported_at: s.importedAt,\n    finalized_at: s.finalizedAt,\n    unmatched_at_finalize: s.unmatchedAtFinalize ?? null,\n    finalize_override_reason: s.finalizeOverrideReason ?? null,\n    finalized_by: s.finalizedBy ?? null,\n  };"""),
 ("""        opening_balance, closing_balance, status, imported_at, finalized_at\n      ) VALUES (\n        @opening_balance, @closing_balance, @status, @imported_at, @finalized_at\n      )""",
  """        opening_balance, closing_balance, status, imported_at, finalized_at,\n        unmatched_at_finalize, finalize_override_reason, finalized_by\n      ) VALUES (\n        @opening_balance, @closing_balance, @status, @imported_at, @finalized_at,\n        @unmatched_at_finalize, @finalize_override_reason, @finalized_by\n      )"""),
 ("""      UPDATE bank_statement SET status = @status, finalized_at = @finalized_at WHERE id = @id""",
  """      UPDATE bank_statement SET status = @status, finalized_at = @finalized_at,\n        unmatched_at_finalize = @unmatched_at_finalize,\n        finalize_override_reason = @finalize_override_reason,\n        finalized_by = @finalized_by\n      WHERE id = @id"""),
]
for old, new in edits:
    assert old in s, old[:60]
    s = s.replace(old, new, 1)
open(p, "w").write(s)
print("ok")
