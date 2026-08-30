p = "packages/domain/src/inventory/wac.fuzz.test.ts"
s = open(p).read()

old1 = """  it("fuzz: a revaluation adds its whole value and moves no quantity", () => {"""
new1 = """  it("fuzz: a revaluation is conserved between inventory and the unabsorbed bucket", () => {"""
assert old1 in s
s = s.replace(old1, new1, 1)

old2 = """        expect(after.onHand.scaled).toBe(before.onHand.scaled);
        expect(after.totalValue.scaled).toBe(before.totalValue.scaled + valueMicro);"""
new2 = """        expect(after.onHand.scaled).toBe(before.onHand.scaled);
        // A landed cost is CONSERVED, not unconditionally capitalised: the
        // share the remaining goods can still carry raises inventory value,
        // and the share belonging to goods already issued is reported as
        // unabsorbed for the caller to expense (D135). Nothing is invented
        // and nothing is lost between the two.
        expect(after.totalValue.scaled + after.unabsorbedRevaluation.scaled).toBe(
          before.totalValue.scaled + before.unabsorbedRevaluation.scaled + valueMicro,
        );
        // It can never raise inventory by MORE than it was worth, nor lower it.
        expect(after.totalValue.scaled <= before.totalValue.scaled + valueMicro).toBe(true);
        expect(after.totalValue.scaled >= before.totalValue.scaled).toBe(true);"""
assert old2 in s
s = s.replace(old2, new2, 1)
open(p, "w").write(s)
print("ok")
