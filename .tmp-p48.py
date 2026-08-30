p = "packages/api/src/bank-reconciliation-routes.test.ts"
s = open(p).read()
start = s.index("  it(\"LIMITATION (D82): finalizes with lines still unmatched, then locks every mutation with 409\", async () => {")
new = open(".tmp-d110.txt").read()
s = s[:start] + new
open(p, "w").write(s)
print("ok")
