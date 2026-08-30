p = "packages/domain/src/inventory/stock-ledger-service.ts"
s = open(p).read()
old = """      averageCost: snap.averageCost,
      layers: await this.deps.layers.listByPosition(itemId, warehouseId),
    };"""
new = """      averageCost: snap.averageCost,
      layers: await this.deps.layers.listByPosition(itemId, warehouseId),
      unabsorbedRevaluation: Money.zero(),
    };"""
assert old in s
s = s.replace(old, new, 1)
open(p, "w").write(s)
print("ok")
