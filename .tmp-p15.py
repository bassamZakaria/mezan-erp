p = "packages/domain/src/inventory/index.ts"
s = open(p).read()
o = "  type IssueLineCost,"
n = "  type IssueLineCost,\n  type LandedCostAbsorption,"
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
