import re
p = "packages/domain/src/inventory/wac.ts"
s = open(p).read()

old_iface = """  /** Immutable layers with their current remainders, in FIFO (receipt) order. */
  readonly layers: readonly CostLayer[];
}"""
new_iface = """  /** Immutable layers with their current remainders, in FIFO (receipt) order. */
  readonly layers: readonly CostLayer[];
  /**
   * Landed cost this ledger could NOT capitalise, because the goods it
   * attaches to had already been issued by the time it was booked (D84, D135).
   * It is a period cost: the caller must post it to cost of sales (or a
   * purchase-price-variance account) instead of to inventory. Nonzero here and
   * the GL inventory control account will exceed the stock valuation by exactly
   * this amount until that posting is made.
   */
  readonly unabsorbedRevaluation: Money;
}"""
assert old_iface in s
s = s.replace(old_iface, new_iface, 1)

old_empty = """    averageCost: Money.zero(),
    layers: [],
  };"""
new_empty = """    averageCost: Money.zero(),
    layers: [],
    unabsorbedRevaluation: Money.zero(),
  };"""
assert old_empty in s
s = s.replace(old_empty, new_empty, 1)

old_init = """  let layers: CostLayer[] = [];"""
new_init = """  let layers: CostLayer[] = [];
  let unabsorbedRevaluation = Money.zero();"""
assert old_init in s
s = s.replace(old_init, new_init, 1)

old_ret = """    averageCost: unitCostOf(totalValue, onHand),
    layers,
  };"""
new_ret = """    averageCost: unitCostOf(totalValue, onHand),
    layers,
    unabsorbedRevaluation,
  };"""
assert old_ret in s
s = s.replace(old_ret, new_ret, 1)
open(p, "w").write(s)
print("ok")
