p = "packages/domain/src/inventory/stock-ledger-service.ts"
s = open(p).read()
o = """   * Which layers absorb it is scoped by `revaluesSourceDocId` — the receipt
   * document whose layers the cost belongs to — and the replay applies the same
   * largest-remainder allocation across their original quantities that this
   * method used to apply by hand. A layer already fully consumed simply is not
   * there to raise; the position-level value still lands, so system-wide
   * valuation stays exact.
   */"""
n = """   * Which layers absorb it is scoped by `revaluesSourceDocId` — the receipt
   * document whose layers the cost belongs to — and the replay allocates it
   * across their remaining quantities by largest remainder.
   *
   * Only the share those goods STILL represent is capitalised. Whatever
   * belongs to units already issued comes back as `unabsorbed`, and the
   * CALLER must post it to cost of sales (or a purchase price variance
   * account) — the landed-cost document debits inventory for the whole amount,
   * so an unabsorbed remainder left unposted is exactly the gap between GL
   * 1200 and the stock valuation report (D84, D135).
   */"""
assert o in s
s = s.replace(o, n, 1)
o2 = """  async applyLandedCostRevaluation(line: {"""
n2 = """  async applyLandedCostRevaluation(line: {"""
assert o2 in s
open(p, "w").write(s)
print("ok")
