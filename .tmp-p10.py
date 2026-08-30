p = "packages/domain/src/inventory/stock-ledger-service.ts"
s = open(p).read()
o = """    readonly occurredAt?: string;
  }): Promise<void> {"""
n = """    readonly occurredAt?: string;
  }): Promise<LandedCostAbsorption> {"""
assert o in s
s = s.replace(o, n, 1)
o2 = """      await this.rebuildWithin(line.itemId, line.warehouseId);
    });
  }"""
n2 = """      const after = await this.rebuildWithin(line.itemId, line.warehouseId);
      const unabsorbed = Money.fromScaled(
        after.unabsorbedRevaluation.scaled - before.unabsorbedRevaluation.scaled,
      );
      return {
        absorbed: Money.fromScaled(line.valueDelta.scaled - unabsorbed.scaled),
        unabsorbed,
      };
    });
  }"""
assert o2 in s
s = s.replace(o2, n2, 1)
o3 = """      const movements = await this.deps.ledger.listByPosition(line.itemId, line.warehouseId);
      const last = movements[movements.length - 1]?.occurredAt;"""
n3 = """      const movements = await this.deps.ledger.listByPosition(line.itemId, line.warehouseId);
      const before =
        movements.length === 0
          ? emptyPosition(line.itemId, line.warehouseId)
          : replay(line.itemId, line.warehouseId, movements);
      const last = movements[movements.length - 1]?.occurredAt;"""
assert o3 in s
s = s.replace(o3, n3, 1)
open(p, "w").write(s)
print("ok")
