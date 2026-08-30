p = "packages/domain/src/purchase-returns/purchase-return-document.ts"
s = open(p).read()
o = """        lines: [
          { accountId: accounts.accountsPayableId, debit: grandTotal, credit: Money.zero() },
          ...(taxValue.scaled > 0n
            ? [{ accountId: accounts.inputTaxPayableId, debit: Money.zero(), credit: taxValue }]
            : []),
          { accountId: accounts.inventoryAccountId, debit: Money.zero(), credit: inventoryCredit },
          ...(variance.scaled === 0n
            ? []
            : variance.scaled > 0n
              ? [{ accountId: accounts.priceVarianceAccountId, debit: Money.zero(), credit: variance }]
              : [{ accountId: accounts.priceVarianceAccountId, debit: variance.negate(), credit: Money.zero() }]),
        ],"""
n = open(".tmp-pr2.txt").read().rstrip("\\n")
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
