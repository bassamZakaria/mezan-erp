import { describe, expect, it } from "vitest";
import { LedgerAccount, LedgerSide, piastresToDecimal, postSale, sumSide } from "./ledger-math";

describe("postSale", () => {
  it("posts the hero's sale with 14% VAT and a balanced entry", () => {
    const sale = postSale({ quantity: 120, unitPricePiastres: 31_000, unitCostPiastres: 25_500, withVat: true });

    expect(sale.netPiastres).toBe(3_720_000);
    expect(sale.vatPiastres).toBe(520_800);
    expect(sale.totalPiastres).toBe(4_240_800);
    expect(sumSide(sale.lines, LedgerSide.Debit)).toBe(sumSide(sale.lines, LedgerSide.Credit));
  });

  it("rounds VAT to the piastre and still balances", () => {
    const sale = postSale({ quantity: 3, unitPricePiastres: 1_001, unitCostPiastres: 700, withVat: true });

    expect(sale.vatPiastres).toBe(420);
    expect(sumSide(sale.lines, LedgerSide.Debit)).toBe(sumSide(sale.lines, LedgerSide.Credit));
  });

  it("drops the VAT line when the sale carries none", () => {
    const sale = postSale({ quantity: 1, unitPricePiastres: 100, unitCostPiastres: 50, withVat: false });

    expect(sale.lines.map((line) => line.account)).not.toContain(LedgerAccount.Vat);
  });
});

describe("piastresToDecimal", () => {
  it("writes the decimal string the Money component reads", () => {
    expect(piastresToDecimal(4_240_800)).toBe("42408.00");
    expect(piastresToDecimal(5)).toBe("0.05");
    expect(piastresToDecimal(-1_250)).toBe("-12.50");
  });
});
