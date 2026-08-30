p = "packages/domain/src/bank-reconciliation/bank-statement.ts"
s = open(p).read()
o = """  readonly importedAt: string;
  readonly finalizedAt: string | null;
}"""
n = """  readonly importedAt: string;
  readonly finalizedAt: string | null;
  /**
   * How many lines were still unmatched at the moment this statement was
   * locked. Zero on a clean reconciliation; nonzero only when someone used the
   * explicit override, and then `finalizeOverrideReason` says why (D82).
   * Null on statements finalised before the field existed.
   */
  readonly unmatchedAtFinalize?: number | null;
  readonly finalizeOverrideReason?: string | null;
  readonly finalizedBy?: string | null;
}"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
