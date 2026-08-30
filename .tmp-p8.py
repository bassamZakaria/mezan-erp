p = "packages/domain/src/inventory/wac.fuzz.test.ts"
s = open(p).read()
o = """  it("KNOWN LIMITATION (D84): a partial drain leaves the whole freight on the units that remain", () => {
    const halfDrain: StockMovement = { ...drain, id: "MOV-OUT-HALF", qty: Qty.fromMajor("6") };
    const position = replay(ITEM, WAREHOUSE, [receipt, halfDrain, landedCost]);

    // Four units are left and they carry all 100.00 of freight, so their unit
    // cost jumps to 30.00 while the six already sold left at 5.00 — the cost of
    // the sold portion is understated by exactly the freight it should have
    // carried.
    expect(position.onHand.toString()).toBe("4.000000");
    expect(position.layers[0]?.unitCost.toString()).toBe("15.000000");
    expect(position.totalValue.toString()).toBe("120.000000");
    expect(position.averageCost.toString()).toBe("30.000000");
  });"""
n = """  it("GUARANTEE (D84): a partial drain splits the freight over sold and unsold units", () => {
    const halfDrain: StockMovement = { ...drain, id: "MOV-OUT-HALF", qty: Qty.fromMajor("6") };
    const position = replay(ITEM, WAREHOUSE, [receipt, halfDrain, landedCost]);

    // Four of the ten units remain, so they carry 4/10 of the 100.00 — their
    // unit cost rises from 5.00 to 15.00, the same landed cost per unit the
    // whole shipment bore. The 60.00 belonging to the six already sold is
    // reported for the caller to expense. Loading all 100.00 onto the four
    // survivors put their cost at 30.00, double what they actually cost.
    expect(position.onHand.toString()).toBe("4.000000");
    expect(position.layers[0]?.unitCost.toString()).toBe("15.000000");
    expect(position.totalValue.toString()).toBe("60.000000");
    expect(position.averageCost.toString()).toBe("15.000000");
    expect(position.unabsorbedRevaluation.toString()).toBe("60.000000");
  });"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
