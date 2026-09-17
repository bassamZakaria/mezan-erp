import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { buildForm41Return } from "./form41-return.js";
import type { WithholdingTaxContext } from "./withholding-tax.js";

function payment(overrides: Partial<WithholdingTaxContext["rows"][number]> = {}): WithholdingTaxContext["rows"][number] {
  return {
    voucherId: "v-1",
    voucherNo: "PV-0001",
    date: "2026-08-10",
    partyId: "sup-1",
    partyNameAr: "شركة النور للتوريدات",
    grossAmount: Money.fromMajor("10000.00"),
    ratePercent: 1,
    withheldAmount: Money.fromMajor("100.00"),
    ...overrides,
  };
}

describe("buildForm41Return", () => {
  it("reports the quarter it was asked for", () => {
    const out = buildForm41Return({ rows: [] }, 2026, 3);
    expect(out.period).toMatchObject({ periodFrom: "2026-07-01", periodTo: "2026-09-30", dueDate: "2026-10-31" });
    expect(out.rows).toEqual([]);
    expect(out.totalWithheld.toString()).toBe("0.000000");
  });

  it("collapses several payments to one payee into one line, as the form asks", () => {
    const out = buildForm41Return(
      {
        rows: [
          payment({ voucherId: "v-1", grossAmount: Money.fromMajor("10000"), withheldAmount: Money.fromMajor("100") }),
          payment({ voucherId: "v-2", grossAmount: Money.fromMajor("5000"), withheldAmount: Money.fromMajor("50") }),
        ],
      },
      2026,
      3,
    );

    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ partyId: "sup-1", voucherCount: 2, ratePercent: 1 });
    expect(out.rows[0]?.grossAmount.toString()).toBe("15000.000000");
    expect(out.rows[0]?.withheldAmount.toString()).toBe("150.000000");
    expect(out.rows[0]?.netPaidAmount.toString()).toBe("14850.000000");
    expect(out.voucherCount).toBe(2);
  });

  it("refuses to average two different rates into one that is neither", () => {
    const out = buildForm41Return(
      {
        rows: [
          payment({ voucherId: "v-1", ratePercent: 1 }),
          payment({ voucherId: "v-2", ratePercent: 5 }),
        ],
      },
      2026,
      3,
    );
    expect(out.rows[0]?.ratePercent).toBeNull();
  });

  it("keeps payees apart, and sums the return exactly", () => {
    const out = buildForm41Return(
      {
        rows: [
          payment({ voucherId: "v-1", partyId: "sup-1", grossAmount: Money.fromMajor("1000.33"), withheldAmount: Money.fromMajor("10.01") }),
          payment({ voucherId: "v-2", partyId: "sup-2", partyNameAr: "مؤسسة الفجر", grossAmount: Money.fromMajor("2000.67"), withheldAmount: Money.fromMajor("20.02") }),
        ],
      },
      2026,
      3,
    );

    expect(out.rows).toHaveLength(2);
    expect(out.totalGross.toString()).toBe("3001.000000");
    expect(out.totalWithheld.toString()).toBe("30.030000");
  });

  it("orders payees by what was withheld from them, largest first", () => {
    const out = buildForm41Return(
      {
        rows: [
          payment({ voucherId: "v-1", partyId: "sup-1", partyNameAr: "أ", withheldAmount: Money.fromMajor("10") }),
          payment({ voucherId: "v-2", partyId: "sup-2", partyNameAr: "ب", withheldAmount: Money.fromMajor("90") }),
          payment({ voucherId: "v-3", partyId: "sup-3", partyNameAr: "ج", withheldAmount: Money.fromMajor("50") }),
        ],
      },
      2026,
      3,
    );
    expect(out.rows.map((r) => r.partyNameAr)).toEqual(["ب", "ج", "أ"]);
  });

  it("takes only the payments dated inside the quarter, boundaries included", () => {
    const out = buildForm41Return(
      {
        rows: [
          payment({ voucherId: "v-0", date: "2026-06-30" }),
          payment({ voucherId: "v-1", date: "2026-07-01" }),
          payment({ voucherId: "v-2", date: "2026-09-30" }),
          payment({ voucherId: "v-3", date: "2026-10-01" }),
        ],
      },
      2026,
      3,
    );
    expect(out.voucherCount).toBe(2);
    expect(out.totalWithheld.toString()).toBe("200.000000");
  });

  it("ignores a payment that withheld nothing — it is not on this form", () => {
    const out = buildForm41Return(
      { rows: [payment({ voucherId: "v-1", withheldAmount: Money.zero() })] },
      2026,
      3,
    );
    expect(out.rows).toEqual([]);
    expect(out.voucherCount).toBe(0);
  });

  it("still lists a payee with no supplier record, keyed by name rather than dropped", () => {
    const out = buildForm41Return(
      {
        rows: [
          payment({ voucherId: "v-1", partyId: null, partyNameAr: "مورد نقدي" }),
          payment({ voucherId: "v-2", partyId: null, partyNameAr: "مورد نقدي" }),
          payment({ voucherId: "v-3", partyId: null, partyNameAr: "مورد آخر" }),
        ],
      },
      2026,
      3,
    );
    expect(out.rows).toHaveLength(2);
    expect(out.rows.find((r) => r.partyNameAr === "مورد نقدي")?.voucherCount).toBe(2);
  });
});
