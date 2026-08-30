p = "packages/domain/src/inventory/wac.ts"
s = open(p).read()
anchor = """/**
 * Replay an ordered movement list into the authoritative position."""
helper = """/**
 * The share of a revaluation the goods still on hand can carry: `remaining` of
 * the `original` quantity the named receipt brought in, split by largest
 * remainder so absorbed + unabsorbed is EXACTLY the amount booked.
 */
function absorbShare(amount: Money, remaining: bigint, original: bigint): Money {
  if (original <= 0n || remaining <= 0n) return Money.zero();
  if (remaining >= original) return amount;
  return allocate(amount, [remaining, original - remaining])[0] as Money;
}

"""
assert anchor in s
s = s.replace(anchor, helper + anchor, 1)
open(p, "w").write(s)
print("ok")
