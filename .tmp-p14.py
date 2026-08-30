p = "packages/domain/src/reports/inventory-drift.ts"
s = open(p).read()
o = "import { checkDrift } from \"../inventory/wac.js\";"
n = "import { Money } from \"../money/index.js\";\nimport { checkDrift } from \"../inventory/wac.js\";"
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
