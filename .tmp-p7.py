p = "packages/domain/src/inventory/wac.fuzz.test.ts"
s = open(p).read()
o = """    // The value is added anyway: 100.00 of inventory value with no units behind
    // it. Nothing refuses it and nothing reports it — the drift report reads
    // this as the documented layer-versus-WAC divergence rather than as the
    // orphan it is. When D84 is fixed, this expectation is the one to rewrite:
    // the cost belongs on the sold goods (COGS), not on an empty position.
    expect(position.totalValue.toString()).toBe("100.000000");
    expect(position.averageCost.scaled).toBe(0n);
  });"""
n = """    // The cost belongs to the sold goods, so inventory carries none of it and
    // the whole 100.00 is reported for the caller to post to cost of sales.
    // Capitalising it left 100.00 of inventory value with no units behind it,
    // invisible because the average of zero units is zero.
    expect(position.totalValue.toString()).toBe("0.000000");
    expect(position.averageCost.scaled).toBe(0n);
    expect(position.unabsorbedRevaluation.toString()).toBe("100.000000");
  });"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
