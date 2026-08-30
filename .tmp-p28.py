p = "packages/domain/src/sales-returns/sales-return-document.ts"
s = open(p).read()
o = """      const { revenueValue, costValue, taxValue, grandTotal } = totals(doc.lines);
      if (grandTotal.scaled === 0n) return null;
      const lines = [
        { accountId: accounts.salesReturnsAccountId, debit: revenueValue, credit: Money.zero() },
        ...(taxValue.scaled > 0n
          ? [{ accountId: accounts.outputTaxPayableAccountId, debit: taxValue, credit: Money.zero() }]
          : []),
        { accountId: accounts.accountsReceivableId, debit: Money.zero(), credit: grandTotal },
      ];"""
n = open(".tmp-sr.txt").read().rstrip("\\n")
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
