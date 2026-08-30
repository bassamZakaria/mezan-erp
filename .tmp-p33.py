import io
edits = [
 ("packages/domain/src/sales-returns/ports.ts",
  "  readonly taxAmount: Money;\n}",
  "  readonly taxAmount: Money;\n  /** The VAT rate this line was charged at, carried onto the return line (D76). */\n  readonly taxRatePercent?: number | null;\n}"),
 ("packages/domain/src/purchase-returns/ports.ts",
  "  readonly taxAmount: Money;\n}",
  "  readonly taxAmount: Money;\n  /** The VAT rate this line was charged at, carried onto the return line (D76). */\n  readonly taxRatePercent?: number | null;\n}"),
 ("packages/domain/src/sales-returns/from-invoice.ts",
  "      taxAmount: taxShare,\n    });",
  "      taxAmount: taxShare,\n      taxRatePercent: invLine.taxRatePercent ?? null,\n    });"),
]
for path, old, new in edits:
    s = open(path).read()
    assert old in s, path
    s = s.replace(old, new, 1)
    open(path, "w").write(s)
print("ok")
