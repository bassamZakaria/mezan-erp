p = "packages/domain/src/purchase-returns/from-invoice.ts"
s = open(p).read()
o = "      taxAmount: taxShare,"
n = "      taxAmount: taxShare,\n      taxRatePercent: invLine.taxRatePercent ?? null,"
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
