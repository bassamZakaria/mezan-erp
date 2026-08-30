p = "packages/domain/src/purchase-returns/purchase-return-document.ts"
s = open(p).read()
o = """  readonly unitCost: Money;
  readonly taxAmount: Money;
}"""
n = """  readonly unitCost: Money;
  readonly taxAmount: Money;
  /**
   * The VAT rate the source invoice line was charged at, carried onto the
   * return so the posting can tag the input-tax credit and its base with it.
   * Without it a mixed-rate return collapsed into one untagged credit and the
   * VAT return could only divide tax by base (D28, D76). Optional: a return
   * carrying none posts exactly the entry it always did.
   */
  readonly taxRatePercent?: number | null;
}"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
