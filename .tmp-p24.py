p = "packages/domain/src/sales-returns/return-tax-rate-d76.test.ts"
s = open(p).read()
o = """    unitCost: Money.zero(),
    taxAmount: Money.zero(),
    ...overrides,
  };
}

describe("LIMITATION (D76): a mixed-rate sales return posts one untagged VAT line", () => {"""
n = """    unitCost: Money.zero(),
    taxAmount: Money.zero(),
    ...overrides,
  };
}

describe("GUARANTEE (D76): a mixed-rate sales return posts one TAGGED VAT line per rate", () => {"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
