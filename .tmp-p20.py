p = "packages/domain/src/inventory/wac.ts"
s = open(p).read()
o = """        batchNo: m.batchNo ?? null,
        expiryDate: m.expiryDate ?? null,
      });
    } else {"""
n = """        batchNo: m.batchNo ?? null,
        expiryDate: m.expiryDate ?? null,
      });
      const seen = receipts.get(m.sourceDocId) ?? { original: 0n, remaining: 0n };
      seen.original += m.qty.scaled;
      seen.remaining += m.qty.scaled;
      receipts.set(m.sourceDocId, seen);
    } else {"""
assert o in s
s = s.replace(o, n, 1)
o2 = """      layers = consumeLayers(layers, m.qty);
    }
  }"""
n2 = """      layers = consumeLayers(layers, m.qty);
      recountRemaining();
    }
  }"""
assert o2 in s
s = s.replace(o2, n2, 1)
open(p, "w").write(s)
print("ok")
