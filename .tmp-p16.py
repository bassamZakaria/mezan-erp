p = "packages/domain/src/landed-costs/service.ts"
s = open(p).read()
o = """  async confirm(id: string, opts: ConfirmOptions = {}): Promise<ConfirmResult<LandedCostLine>> {
    const result = await this.documents.confirm(id, opts);
    if (result.held) return result; // pending approval — no revaluation until it actually confirms

    for (const line of result.document.lines) {
      await this.stock.applyLandedCostRevaluation({"""
n = """  async confirm(id: string, opts: ConfirmOptions = {}): Promise<LandedCostConfirmResult> {
    const result = await this.documents.confirm(id, opts);
    if (result.held) return { ...result, unabsorbed: [], unabsorbedTotal: Money.zero() };

    const unabsorbed: UnabsorbedLandedCost[] = [];
    for (const line of result.document.lines) {
      const absorption = await this.stock.applyLandedCostRevaluation({"""
assert o in s
s = s.replace(o, n, 1)
o2 = """        occurredAt: occurredAtFromDocumentDate(result.document.date),
      });
    }
    return result;
  }
}"""
n2 = """        occurredAt: occurredAtFromDocumentDate(result.document.date),
      });
      if (absorption.unabsorbed.scaled !== 0n) {
        unabsorbed.push({
          itemId: line.itemId,
          warehouseId: line.warehouseId,
          sourceInvoiceId: line.sourceInvoiceId,
          amount: absorption.unabsorbed,
        });
      }
    }
    return { ...result, unabsorbed, unabsorbedTotal: Money.sum(unabsorbed.map((u) => u.amount)) };
  }
}"""
assert o2 in s
s = s.replace(o2, n2, 1)
open(p, "w").write(s)
print("ok")
