p = "packages/domain/src/sales-returns/return-tax-rate-d76.test.ts"
s = open(p).read()
start = s.index("describe(\"LIMITATION (D76): the purchase-return twin has the same hole\", () => {")
new = open(".tmp-d76b.txt").read()
s = s[:start] + new
open(p, "w").write(s)
print("ok")
