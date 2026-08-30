p = "packages/domain/src/inventory/wac.ts"
s = open(p).read()
old = open(".tmp-old2.txt").read()
new = open(".tmp-new2.txt").read()
assert old in s, "anchor missing"
s = s.replace(old, new, 1)
open(p, "w").write(s)
print("ok")
