p = "packages/domain/src/inventory/wac.fuzz.test.ts"
s = open(p).read()
o = """    // 50.00 − 20.00 + 60.00 = 90.00 over the 6 units still held.
    expect(position.onHand.toString()).toBe("6.000000");
    expect(position.totalValue.toString()).toBe("90.000000");
    expect(position.averageCost.toString()).toBe("15.000000");
  });"""
n = """    // 50.00 − 20.00 = 30.00 over the 6 units still held. The freight is
    // 60.00 on a receipt of 10 units of which 6 remain, so 36.00 attaches to
    // them (30.00 + 36.00 = 66.00, an average of 11.00) and the 24.00 that
    // belongs to the 4 already sold is reported, not capitalised (D135).
    expect(position.onHand.toString()).toBe("6.000000");
    expect(position.totalValue.toString()).toBe("66.000000");
    expect(position.averageCost.toString()).toBe("11.000000");
    expect(position.unabsorbedRevaluation.toString()).toBe("24.000000");
  });"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
