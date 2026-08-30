p = "packages/domain/src/inventory/stock-ledger-service.ts"
s = open(p).read()
o = """    await this.runInTransaction(async () => {
      const movements = await this.deps.ledger.listByPosition(line.itemId, line.warehouseId);
      const before ="""
n = """    return this.runInTransaction(async () => {
      const movements = await this.deps.ledger.listByPosition(line.itemId, line.warehouseId);
      const before ="""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
p2 = "packages/domain/src/reports/inventory-drift.ts"
t = open(p2).read()
o2 = "checkDrift({ ...snapshot, layers: [] }, positionMovements)"
n2 = "checkDrift({ ...snapshot, layers: [], unabsorbedRevaluation: Money.zero() }, positionMovements)"
assert o2 in t
t = t.replace(o2, n2, 1)
open(p2, "w").write(t)
print("ok")
