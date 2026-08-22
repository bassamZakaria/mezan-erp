import { describe, it, expect } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { StockLedgerService } from "../inventory/index.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "../inventory/test-helpers/in-memory-stores.js";
import { CreditLimitExceededError } from "../credit-control/index.js";
import {
  SalesInvoiceService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  createSalesInvoiceCustomerExposureHook,
  type CreateSalesInvoiceCommand,
  type SalesInvoiceCreditControlDeps,
} from "./index.js";
import { InMemorySalesInvoiceRepository } from "./test-helpers/in-memory-sales-invoice-repository.js";

/**
 * Confirms that `SalesInvoiceService.confirm()` actually enforces credit
 * control end to end (docs/catalog/01/09 §"الرقابة الائتمانية") — WARNING mode
 * surfaces `creditWarning` and still posts; BLOCK mode throws
 * `CreditLimitExceededError` and posts nothing. `credit-check.test.ts` covers
 * the pure decision function in isolation; this covers the wiring, including
 * summing a customer's PRIOR confirmed invoices into their exposure.
 */

const AR = "1300";
const REVENUE = "4000";
const TAX = "2200";
const NOW = "2026-08-22T10:00:00.000Z";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    code: id,
    nameAr: id,
    nameEn: null,
    type: "asset",
    naturalBalance: "debit",
    parentId: null,
    isHeader: false,
    status: "active",
    ...overrides,
  };
}

/** Builds a fresh SalesInvoiceService; pass `repo` to share invoice history across calls (simulating a second invoice for the same customer), and `creditControl` to enable the check. */
async function harness(opts: {
  repo?: InMemorySalesInvoiceRepository;
  creditControl?: SalesInvoiceCreditControlDeps;
} = {}) {
  const accounts = new InMemoryAccountRepository();
  await accounts.create(account(AR));
  await accounts.create(account(REVENUE, { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account(TAX, { type: "liability", naturalBalance: "credit" }));

  const periods = new InMemoryFiscalPeriodRepository();
  await periods.create({
    id: "fp-2026-08",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });

  const ledger = new InMemoryLedgerRepository();
  const glHook = createSalesInvoiceGlHook({
    ledger,
    accounts,
    periods,
    numbering: new NextNumberService(new InMemorySequenceStore()),
    now: () => NOW,
    actor: "u1",
  });

  const stockService = new StockLedgerService({
    ledger: new InMemoryStockLedger(),
    layers: new InMemoryCostLayers(),
    snapshots: new InMemorySnapshots(),
    policy: { allowNegativeStock: true },
    clock: () => NOW,
  });
  const stockHook = createSalesInvoiceStockHook(stockService);

  const repo = opts.repo ?? new InMemorySalesInvoiceRepository();
  const numbering = new NextNumberService(new InMemorySequenceStore());
  const svc = new SalesInvoiceService({
    repo,
    numbering: { next: () => numbering.next("SALES_INVOICE") },
    gl: glHook,
    stock: stockHook,
    creditControl: opts.creditControl,
    now: () => NOW,
    actor: "u1",
  });

  return { svc, repo };
}

function draftCmd(overrides: Partial<CreateSalesInvoiceCommand> = {}): CreateSalesInvoiceCommand {
  return {
    id: "inv-1",
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "محمد الشهابي",
    warehouseId: "WH1",
    branchId: "BR1",
    arAccountId: AR,
    taxAccountId: TAX,
    lines: [
      {
        lineId: "L1",
        itemId: "SVC-1",
        itemNameAr: "خدمة",
        isStock: false,
        qty: Qty.fromMajor("1"),
        unitPrice: Money.fromMajor("1500"),
        taxRatePercent: 0,
        revenueAccountId: REVENUE,
      },
    ],
    ...overrides,
  };
}

describe("SalesInvoiceService.confirm — credit control", () => {
  it("confirms freely when credit control isn't configured at all", async () => {
    const { svc } = await harness();
    await svc.createDraft(draftCmd());
    const result = await svc.confirm("inv-1");
    expect(result.held).toBe(false);
    expect(result.creditWarning).toBeNull();
    expect(result.invoice.status).toBe("confirmed");
  });

  it("confirms freely when credit control is configured but disabled in settings", async () => {
    const repo = new InMemorySalesInvoiceRepository();
    const { svc } = await harness({
      repo,
      creditControl: {
        exposure: createSalesInvoiceCustomerExposureHook(repo),
        getCreditLimit: async () => Money.fromMajor("1000"),
        getPolicy: async () => ({ enabled: false, mode: "BLOCK" }),
      },
    });
    await svc.createDraft(draftCmd());
    const result = await svc.confirm("inv-1");
    expect(result.creditWarning).toBeNull();
    expect(result.invoice.status).toBe("confirmed");
  });

  it("WARNING mode: surfaces creditWarning but still confirms when over the limit", async () => {
    const repo = new InMemorySalesInvoiceRepository();
    const { svc } = await harness({
      repo,
      creditControl: {
        exposure: createSalesInvoiceCustomerExposureHook(repo),
        getCreditLimit: async () => Money.fromMajor("1000"),
        getPolicy: async () => ({ enabled: true, mode: "WARNING" }),
      },
    });
    await svc.createDraft(draftCmd());
    const result = await svc.confirm("inv-1"); // 1500 > 1000 limit
    expect(result.held).toBe(false);
    expect(result.invoice.status).toBe("confirmed");
    expect(result.creditWarning).not.toBeNull();
    expect(result.creditWarning?.status).toBe("warning");
    expect(result.creditWarning?.overBy.toString()).toBe("500.000000");
  });

  it("BLOCK mode: throws CreditLimitExceededError and never confirms when over the limit", async () => {
    const repo = new InMemorySalesInvoiceRepository();
    const { svc } = await harness({
      repo,
      creditControl: {
        exposure: createSalesInvoiceCustomerExposureHook(repo),
        getCreditLimit: async () => Money.fromMajor("1000"),
        getPolicy: async () => ({ enabled: true, mode: "BLOCK" }),
      },
    });
    await svc.createDraft(draftCmd());
    await expect(svc.confirm("inv-1")).rejects.toBeInstanceOf(CreditLimitExceededError);
    const stillDraft = await repo.findById("inv-1");
    expect(stillDraft?.status).toBe("draft");
  });

  it("sums the customer's existing live invoices into the exposure check", async () => {
    const repo = new InMemorySalesInvoiceRepository();
    const creditControl: SalesInvoiceCreditControlDeps = {
      exposure: createSalesInvoiceCustomerExposureHook(repo),
      getCreditLimit: async () => Money.fromMajor("2000"),
      getPolicy: async () => ({ enabled: true, mode: "BLOCK" }),
    };

    const { svc: svc1 } = await harness({ repo, creditControl });
    await svc1.createDraft(draftCmd({ id: "inv-1" }));
    await svc1.confirm("inv-1"); // 1500, under the 2000 limit, no prior exposure yet

    const { svc: svc2 } = await harness({ repo, creditControl });
    await svc2.createDraft(draftCmd({ id: "inv-2" }));
    // inv-1 (1500 confirmed) + inv-2 (1500) = 3000 > 2000 limit → blocked.
    await expect(svc2.confirm("inv-2")).rejects.toBeInstanceOf(CreditLimitExceededError);
  });

  it("excludes the invoice being confirmed from its own prior-exposure sum (no double count on re-check)", async () => {
    const repo = new InMemorySalesInvoiceRepository();
    const creditControl: SalesInvoiceCreditControlDeps = {
      exposure: createSalesInvoiceCustomerExposureHook(repo),
      getCreditLimit: async () => Money.fromMajor("1600"),
      getPolicy: async () => ({ enabled: true, mode: "BLOCK" }),
    };
    const { svc } = await harness({ repo, creditControl });
    await svc.createDraft(draftCmd({ id: "inv-1" }));
    const result = await svc.confirm("inv-1"); // 1500 <= 1600 — must not double-add inv-1 to its own exposure
    expect(result.invoice.status).toBe("confirmed");
  });
});
