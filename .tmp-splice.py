import sys
p = "packages/domain/src/inventory/wac.fuzz.test.ts"
s = open(p).read()
start = s.index("  describe(\"a landed cost that arrives after the stock has all been sold (D135)\", () => {")
end = s.index("  it(\"fuzz: the average always re-multiplies back to the position")
new = open(".tmp-nb.txt").read()
s = s[:start] + new + s[end:]
old_hatch = """        // A landed cost booked AFTER the stock is gone is excluded here and
        // pinned separately below (D135) — it is not rounding, it is a whole
        // freight invoice landing on nothing, and folding it into this
        // tolerance would hide it behind a bigger number.
        const revaluedAfterDrain = movements.some((m) => m.sourceDocType === "LANDED_COST");
        if (revaluedAfterDrain) return;

"""
new_hatch = """        // A landed cost booked AFTER the stock is gone used to be excluded
        // here (D135): a whole freight invoice landed on nothing and the
        // exclusion hid it. Its unabsorbable share is now split off into
        // `unabsorbedRevaluation`, so a drained position holds nothing but
        // the rounding residue of its own drain, whatever the ledger held.
"""
assert old_hatch in s, "hatch not found"
s = s.replace(old_hatch, new_hatch)
open(p, "w").write(s)
print("spliced")
