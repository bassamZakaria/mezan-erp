p = "packages/domain/src/purchase-returns/purchase-return-document.ts"
s = open(p).read()
o = "import { Money, Qty } from \"../money/index.js\";"
n = "import { Money, Qty, allocate } from \"../money/index.js\";"
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
