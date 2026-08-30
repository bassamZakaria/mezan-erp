p = "packages/domain/src/inventory/wac.fuzz.test.ts"
s = open(p).read()

old = """describe("a revaluation that names a receipt whose layers are gone (D84)", () => {"""
new = """describe("a revaluation that names a receipt whose layers are gone (D84)", () => {"""
assert old in s

o1 = """  it("KNOWN LIMITATION (D84): the value lands on a position with nothing in it, and no layer is bumped", () => {
    const position = replay(ITEM, WAREHOUSE, [receipt, drain, landedCost]);

    // Everything was sold before the freight invoice arrived, so the layer the
    // landed cost names no longer exists.
    expect(position.onHand.scaled).toBe(0n);
    expect(position.layers).toHaveLength(0);
"""
n1 = """  it("GUARANTEE (D84): the value does NOT land on a position with nothing in it", () => {
    const position = replay(ITEM, WAREHOUSE, [receipt, drain, landedCost]);

    // Everything was sold before the freight invoice arrived, so the layer the
    // landed cost names no longer exists.
    expect(position.onHand.scaled).toBe(0n);
    expect(position.layers).toHaveLength(0);
"""
assert o1 in s
s = s.replace(o1, n1, 1)
open(p, "w").write(s)
print("ok")
