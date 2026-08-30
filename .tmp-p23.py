p = "packages/domain/src/sales-returns/return-tax-rate-d76.test.ts"
s = open(p).read()
o = """ * D76 — a confirmed RETURN aggregates every line tax into ONE untagged journal
 * line, so the per-line taxRatePercent D28 added to invoices does not extend to
 * returns and the VAT return (إقرار القيمة المضافة) cannot split a mixed-rate
 * return by rate.
 *
 * These tests PIN the broken behaviour. When D76 is closed they must be
 * rewritten to assert one tagged tax line per rate.
 */"""
n = """ * D76 — a confirmed RETURN used to aggregate every line tax into ONE untagged
 * journal line, so the per-line taxRatePercent D28 added to invoices did not
 * extend to returns and the VAT return (إقرار القيمة المضافة) could not split a
 * mixed-rate return by rate.
 *
 * These tests now assert the guarantee: one TAGGED tax line per rate, and a
 * base line tagged with the same rate beside it, on both the sales and the
 * purchase side.
 */"""
assert o in s
s = s.replace(o, n, 1)
open(p, "w").write(s)
print("ok")
