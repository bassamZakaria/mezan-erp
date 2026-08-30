p = "packages/domain/src/inventory/wac.ts"
s = open(p).read()
stale = """      continue;
    }
            const share = shares[i] as Money;
            if (l.remainingQty.isZero() || share.scaled === 0n) return [l.id, l] as const;
            return [l.id, { ...l, unitCost: l.unitCost.add(unitCostOf(share, l.remainingQty)) }] as const;
          }),
        );
        layers = layers.map((l) => bumped.get(l.id) ?? l);
      }
      continue;
    }
"""
good = """      continue;
    }
"""
assert stale in s
s = s.replace(stale, good, 1)
open(p, "w").write(s)
print("ok")
