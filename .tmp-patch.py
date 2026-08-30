p = "packages/domain/src/inventory/wac.ts"
s = open(p).read()
old = open(".tmp-old-wac.txt").read()
new = open(".tmp-new-wac.txt").read()
assert old in s, "old block not found"
s = s.replace(old, new, 1)
open(p, "w").write(s)
print("patched")
