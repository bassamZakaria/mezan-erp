p = "packages/domain/src/inventory/wac.ts"
s = open(p).read()
old = """  /** True when |cacheDrift| is within `tolerance` (cache is trustworthy). */
  readonly withinTolerance: boolean;
}"""
new = """  /** True when |cacheDrift| is within `tolerance` (cache is trustworthy). */
  readonly withinTolerance: boolean;
  /**
   * Landed cost the ledger could not capitalise because the goods had already
   * been issued (D84, D135). This is the amount the GL inventory control
   * account holds that the stock valuation does not, until it is posted to
   * cost of sales. Not part of `cacheDrift`: the cache is not wrong, the
   * posting is missing.
   */
  readonly unabsorbedRevaluation: Money;
}"""
assert old in s
s = s.replace(old, new, 1)
old2 = """    cacheDrift,
    layerDrift,
    withinTolerance: driftMagnitude <= tolerance.scaled,
  };"""
new2 = """    cacheDrift,
    layerDrift,
    withinTolerance: driftMagnitude <= tolerance.scaled,
    unabsorbedRevaluation: recomputed.unabsorbedRevaluation,
  };"""
assert old2 in s
s = s.replace(old2, new2, 1)
open(p, "w").write(s)
print("ok")
