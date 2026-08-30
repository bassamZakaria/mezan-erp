edits = [
 ("packages/contracts/src/sales-returns.ts",
  "  taxAmount: positiveDecimalString,\n});",
  "  taxAmount: positiveDecimalString,\n  /** The VAT rate the source invoice line charged, so a mixed-rate return posts one tagged VAT line per rate (D76). */\n  taxRatePercent: z.number().nullable().optional(),\n});"),
 ("packages/contracts/src/purchase-returns.ts",
  "  taxAmount: positiveDecimalString,\n});",
  "  taxAmount: positiveDecimalString,\n  /** The VAT rate the source invoice line charged, so a mixed-rate return posts one tagged VAT line per rate (D76). */\n  taxRatePercent: z.number().nullable().optional(),\n});"),
 ("packages/api/src/sales-returns-routes.ts",
  "    taxAmount: l.taxAmount.toString(),\n  };",
  "    taxAmount: l.taxAmount.toString(),\n    taxRatePercent: l.taxRatePercent ?? null,\n  };"),
 ("packages/api/src/purchase-returns-routes.ts",
  "    taxAmount: l.taxAmount.toString(),\n  };",
  "    taxAmount: l.taxAmount.toString(),\n    taxRatePercent: l.taxRatePercent ?? null,\n  };"),
 ("packages/api/src/sales-returns-routes.ts",
  "          taxAmount: Money.fromMajor(l.taxAmount),",
  "          taxAmount: Money.fromMajor(l.taxAmount),\n          taxRatePercent: l.taxRatePercent ?? null,"),
 ("packages/api/src/purchase-returns-routes.ts",
  "          taxAmount: Money.fromMajor(l.taxAmount),",
  "          taxAmount: Money.fromMajor(l.taxAmount),\n          taxRatePercent: l.taxRatePercent ?? null,"),
]
for path, old, new in edits:
    s = open(path).read()
    assert old in s, path
    s = s.replace(old, new, 1)
    open(path, "w").write(s)
print("ok")
