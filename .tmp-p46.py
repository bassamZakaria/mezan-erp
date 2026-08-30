p = "packages/domain/src/bank-reconciliation/reconciliation-service.test.ts"
s = open(p).read()
start = s.index("  it(\"LIMITATION (D82): finalises with every line still unmatched, and locks the statement anyway\", async () => {")
end = s.index("  it(\"rejects finalizing twice\", async () => {")
new = open(".tmp-d82.txt").read()
s = s[:start] + new + "\n" + s[end:]
o = "    await service.finalize(\"stmt-1\");\n    await expect(service.finalize(\"stmt-1\")).rejects.toThrow(StatementAlreadyFinalizedError);"
n = "    await service.finalize(\"stmt-1\", { force: true, reason: \"إغلاق تجريبي\" });\n    await expect(service.finalize(\"stmt-1\")).rejects.toThrow(StatementAlreadyFinalizedError);"
assert o in s
s = s.replace(o, n, 1)
o2 = "    const { lines } = await service.importStatement(importCmd());\n    await service.finalize(\"stmt-1\");"
n2 = "    const { lines } = await service.importStatement(importCmd());\n    await service.finalize(\"stmt-1\", { force: true, reason: \"إغلاق تجريبي\" });"
assert o2 in s
s = s.replace(o2, n2, 1)
open(p, "w").write(s)
print("ok")
