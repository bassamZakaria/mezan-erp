/**
 * The price-list شريحة has to survive out of the pricing engine and into the
 * invoice the confirm measures. The confirm consults `listPriceFor` with a
 * quantity and compares the answer to what the line charged (D35) — so both
 * the QUANTITY it asks with and the PRICE it compares against are load-bearing.
 */

import { describe, it, expect } from "vitest";
import { PLAIN_SALES_TAX_DEPS } from "./test-support.js";
import { Money, Qty } from "../money/index.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { StockLedgerService } from "../inventory/index.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "../inventory/test-helpers/in-memory-stores.js";
import { resolvePrice } from "../price-lists/pricing.js";
import type { PriceList } from "../price-lists/price-list.js";
import {
  SalesInvoiceService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  type CreateSalesInvoiceCommand,
} from "./index.js";
import { InMemorySalesInvoiceRepository } from "./test-helpers/in-memory-sales-invoice-repository.js";

const AR = "1105";
const REVENUE = "4000";
const TAX = "2201";
const NOW = "2026-08-22T10:00:00.000Z";

const LIST: PriceList = {
  id: "PL-1",
  code: "WHOLESALE",
  nameAr: "قائمة الجملة",
  nameEn: null,
  description: null,
  isBase: false,
  active: true,
  lines: [
    { itemId: "ITEM-A", unitCode: "PCS", minQty: Qty.fromMajor("10"), price: Money.fromMajor("92.00") },
    { itemId: "ITEM-A", unitCode: "PCS", minQty: Qty.fromMajor("50"), price: Money.fromMajor("85.00") },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
};

interface AskedFor {
  readonly customerId: string;
  readonly itemId: string;
  readonly qty: string;
}

async function harness() {
  const accounts = new InMemoryAccountRepository();
  await accounts.create({ id: AR, code: AR, nameAr: AR, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active" });
  await accounts.create({ id: REVENUE, code: REVENUE, nameAr: REVENUE, nameEn: null, type: "revenue", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" });
  await accounts.create({ id: TAX, code: TAX, nameAr: TAX, nameEn: null, type: "liability", naturalBalance: "credit", parentId: null, isHeader: false, status: "active" });

  const periods = new InMemoryFiscalPeriodRepository();
  await periods.create({ id: "fp", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });

  const ledger = new InMemoryLedgerRepository();
  const asked: AskedFor[] = [];
  const svc = new SalesInvoiceService({
    ...PLAIN_SALES_TAX_DEPS,
    repo: new InMemorySalesInvoiceRepository(),
    numbering: { next: () => new NextNumberService(new InMemorySequenceStore()).next("SALES_INVOICE") },
    gl: createSalesInvoiceGlHook({
      ledger,
      accounts,
      periods,
      numbering: new NextNumberService(new InMemorySequenceStore()),
      now: () => NOW,
      actor: "u1",
    }),
    stock: createSalesInvoiceStockHook(
      new StockLedgerService({
        ledger: new InMemoryStockLedger(),
        layers: new InMemoryCostLayers(),
        snapshots: new InMemorySnapshots(),
        policy: { allowNegativeStock: true },
        clock: () => NOW,
      }),
    ),
    pricing: {
      listPriceFor: async (customerId, itemId, qty) => {
        asked.push({ customerId, itemId, qty: qty.toString() });
        const resolved = resolvePrice(LIST, itemId, Money.zero(), qty);
        return resolved.scaled === 0n ? null : resolved;
      },
    },
    now: () => NOW,
    actor: "u1",
  });
  return { svc, asked };
}

function cmd(overrides: Partial<CreateSalesInvoiceCommand> = {}): CreateSalesInvoiceCommand {
  return {
    id: "inv-1",
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "عميل الجملة",
    warehouseId: "WH1",
    branchId: "BR1",
    arAccountId: AR,
    taxAccountId: TAX,
    lines: [
      {
        lineId: "L1",
        itemId: "ITEM-A",
        itemNameAr: "صنف أ",
        isStock: false,
        qty: Qty.fromMajor("10"),
        unitPrice: Money.fromMajor("92.00"),
        taxRatePercent: 0,
        revenueAccountId: REVENUE,
      },
    ],
    ...overrides,
  };
}

describe("the tier the line was priced at survives into the confirm", () => {
  it("asks the pricing engine for THIS line quantity, and raises no variance when the tier price was charged", async () => {
    const { svc, asked } = await harness();
    await svc.createDraft(cmd());
    const result = await svc.confirm("inv-1");

    expect(asked).toEqual([{ customerId: "cust-1", itemId: "ITEM-A", qty: "10.000000" }]);
    expect(result.pricingVariances).toHaveLength(0);
    expect(result.invoice.lines[0]!.unitPrice.toString()).toBe("92.000000");
    expect(svc.totalsOf(result.invoice).grandTotal.toString()).toBe("920.000000");
  });

  it("flags the exact shortfall when the line is charged the 10-up price at a 50-up quantity", async () => {
    const { svc } = await harness();
    await svc.createDraft(
      cmd({
        lines: [
          { lineId: "L1", itemId: "ITEM-A", itemNameAr: "صنف أ", isStock: false, qty: Qty.fromMajor("50"), unitPrice: Money.fromMajor("80.00"), taxRatePercent: 0, revenueAccountId: REVENUE },
        ],
      }),
    );
    const result = await svc.confirm("inv-1");

    expect(result.pricingVariances).toHaveLength(1);
    expect(result.pricingVariances[0]!.listPrice.toString()).toBe("85.000000");
    expect(result.pricingVariances[0]!.chargedPrice.toString()).toBe("80.000000");
  });

  it("raises no variance at a quantity BELOW the first tier, because the list quotes nothing there", async () => {
    const { svc, asked } = await harness();
    await svc.createDraft(
      cmd({
        lines: [
          { lineId: "L1", itemId: "ITEM-A", itemNameAr: "صنف أ", isStock: false, qty: Qty.fromMajor("3"), unitPrice: Money.fromMajor("60.00"), taxRatePercent: 0, revenueAccountId: REVENUE },
        ],
      }),
    );
    const result = await svc.confirm("inv-1");

    expect(asked[0]!.qty).toBe("3.000000");
    expect(result.pricingVariances).toHaveLength(0);
  });
});

describe("LIMITATION: the tier is looked up in BASE units while the price compared is per ENTERED unit", () => {
  /**
   * A price-list tier is quoted in whatever unit the caller prices the line in
   * (price-list.ts: the unitCode "names that unit rather than converting it").
   * `SalesInvoiceService.checkPricing` nevertheless asks for the tier with
   * `line.baseQty` and compares the answer to `line.unitPrice`, which is the
   * price of one ENTERED unit.
   *
   * Five cartons of twelve is 5 entered units and 60 base units. The lookup
   * therefore lands on the 50-up tier of 85.00 PER PIECE and compares it to a
   * PER-CARTON price of 1,020.00 — two different things.
   */
  it("asks with baseQty (60) rather than the entered qty (5)", async () => {
    const { svc, asked } = await harness();
    await svc.createDraft(
      cmd({
        lines: [
          {
            lineId: "L1",
            itemId: "ITEM-A",
            itemNameAr: "صنف أ",
            isStock: false,
            qty: Qty.fromMajor("5"),
            unitCode: "CTN",
            unitFactor: 12,
            unitPrice: Money.fromMajor("1020.00"),
            taxRatePercent: 0,
            revenueAccountId: REVENUE,
          },
        ],
      }),
    );
    const result = await svc.confirm("inv-1");

    expect(asked).toEqual([{ customerId: "cust-1", itemId: "ITEM-A", qty: "60.000000" }]);
    // 1,020.00 per carton is 85.00 per piece — exactly the tier. Nothing is
    // flagged, but only because the per-carton price happens to be ABOVE the
    // per-piece tier; the comparison itself is between two different units.
    expect(result.pricingVariances).toHaveLength(0);
  });

  it("misses a genuine undercharge because a per-carton price always dwarfs a per-piece tier", async () => {
    const { svc } = await harness();
    await svc.createDraft(
      cmd({
        lines: [
          {
            lineId: "L1",
            itemId: "ITEM-A",
            itemNameAr: "صنف أ",
            isStock: false,
            qty: Qty.fromMajor("5"),
            unitCode: "CTN",
            unitFactor: 12,
            // 100.00 per carton is 8.33 per piece — barely a tenth of the
            // 85.00 tier, and the biggest undercharge on the file.
            unitPrice: Money.fromMajor("100.00"),
            taxRatePercent: 0,
            revenueAccountId: REVENUE,
          },
        ],
      }),
    );
    const result = await svc.confirm("inv-1");

    // 100.00 > 85.00, so the guard stays silent on a line sold at a tenth of
    // the list price. When this is fixed the comparison must be made in one
    // unit, and this expectation becomes toHaveLength(1).
    expect(result.pricingVariances).toHaveLength(0);
    expect(result.invoice.lines[0]!.baseQty.toString()).toBe("60.000000");
    expect(result.invoice.lines[0]!.unitPrice.toString()).toBe("100.000000");
  });
});
