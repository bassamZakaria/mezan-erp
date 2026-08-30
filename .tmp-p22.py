p = "packages/domain/src/inventory/wac.fuzz.test.ts"
s = open(p).read()
extra = open(".tmp-extra.txt").read()
anchor = """      expect(position.averageCost.toString()).toBe("12.500000");
      expect(position.unabsorbedRevaluation.toString()).toBe("0.000000");
    });
  });"""
assert anchor in s
replacement = """      expect(position.averageCost.toString()).toBe("12.500000");
      expect(position.unabsorbedRevaluation.toString()).toBe("0.000000");
    });
""" + extra + """  });"""
s = s.replace(anchor, replacement, 1)
open(p, "w").write(s)
print("ok")
