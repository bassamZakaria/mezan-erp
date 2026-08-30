p = "packages/domain/src/purchase-returns/purchase-return-document.ts"
s = open(p).read()
o = """      const removed = stock ? stock.valueMoved.negate() : costValue;
      const inventoryCredit = removed.scaled > 0n ? removed : costValue;
      // Supplier credit minus what actually left stock. Positive = the goods
      // were carrying less than the supplier refunds, so the difference is a
      // gain and the variance account is credited.
      const variance = Money.fromScaled(costValue.scaled - inventoryCredit.scaled);"""
n = open(".tmp-pr.txt").read().rstrip("\\n")
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
