p = "packages/domain/src/inventory/stock-ledger-service.ts"
s = open(p).read()
anchor = "export interface StockLedgerPolicy {"
block = """/**
 * How much of one landed-cost line the position could actually absorb.
 *
 * `absorbed` raised the cost basis of stock still on hand; `unabsorbed`
 * belongs to units already issued and is a PERIOD cost the caller must post
 * (D84, D135). The two always sum to the line amount.
 */
export interface LandedCostAbsorption {
  readonly absorbed: Money;
  readonly unabsorbed: Money;
}

"""
assert anchor in s
s = s.replace(anchor, block + anchor, 1)
open(p, "w").write(s)
print("ok")
