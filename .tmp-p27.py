p = "packages/domain/src/sales-returns/sales-return-document.ts"
s = open(p).read()
o = """  /** Proportional tax on this line's returned qty (0 if the item/customer is tax-exempt). */
  readonly taxAmount: Money;
}"""
n = """  /** Proportional tax on this line's returned qty (0 if the item/customer is tax-exempt). */
  readonly taxAmount: Money;
  /**
   * The VAT rate the source invoice line charged, carried onto the return so
   * the posting can tag both the credit and its base with it. Without it a
   * mixed-rate return collapsed into one untagged VAT line and the VAT return
   * could only divide tax by base, inventing a rate nobody charged (D28, D76).
   * Optional: a return created before the dimension existed carries none and
   * posts exactly the entry it always did.
   */
  readonly taxRatePercent?: number | null;
}"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
