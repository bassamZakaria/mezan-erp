import { describe, expect, it } from "vitest";
import { Money, Qty } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { StockLedgerService } from "../inventory/index.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "../inventory/test-helpers/in-memory-stores.js";
import {
  SalesInvoiceService,
  createSalesInvoiceGlHook,
  createSalesInvoiceStockHook,
  type ContractBillingRoutingPort,
  type CreateSalesInvoiceCommand,
} from "./index.js";
import { InMemorySalesInvoiceRepository } from "./test-helpers/in-memory-sales-invoice-repository.js";

/**
 * D-03's billing arrow, on an ORDINARY invoice.
 *
 * A project running a live cost-to-cost works contract recognises revenue from
 * the monthly EAS 48 run. An ordinary invoice raised on that project used to
 * credit 4100, so the same work reached the P&L twice — once from the invoice
 * and once from the run.
 */

const AR = "1105";
const REVENUE = "4100";
const BILLINGS = "2165";
const RETENTION = "1150";
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

async function harness(contractBilling?: ContractBillingRoutingPort) {
  const accounts = new InMemoryAccountRepository();
  await accounts.create(account(AR));
  await accounts.create(account(RETENTION));
  await accounts.create(account(REVENUE, { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account(BILLINGS, { type: "liability", naturalBalance: "credit" }));
  await accounts.create(account(TAX, { type: "liability", naturalBalance: "credit" }));

  const periods = new InMemoryFiscalPeriodRepository();
  await periods.create({
    id: "fp",
    year: 2026,
    periodNumber: 8,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    status: "open",
  });

  const ledger = new InMemoryLedgerRepository();
  const repo = new InMemorySalesInvoiceRepository();
  const numbering = new NextNumberService(new InMemorySequenceStore());
  const svc = new SalesInvoiceService({
    repo,
    numbering: { next: () => numbering.next("SALES_INVOICE") },
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
    now: () => NOW,
    actor: "u1",
    ...(contractBilling ? { contractBilling } : {}),
  });
  return { svc, repo, ledger };
}

const COST_TO_COST: ContractBillingRoutingPort = {
  async resolve(projectId) {
    if (projectId !== "PRJ-1") return null;
    return {
      billingsAccountId: BILLINGS,
      revenueAccountIds: new Set([REVENUE]),
      memoAr: "عقد مقاولات بنظام نسبة الإتمام — الترحيل إلى حساب فواتير المستخلصات.",
    };
  },
};

function draftCmd(overrides: Partial<CreateSalesInvoiceCommand> = {}): CreateSalesInvoiceCommand {
  return {
    id: "INV-1",
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "CUST-1",
    customerNameAr: "شركة النيل للتطوير",
    warehouseId: "WH1",
    branchId: "BR1",
    projectId: "PRJ-1",
    arAccountId: AR,
    taxAccountId: TAX,
    lines: [
      {
        lineId: "L1",
        itemId: "SVC-1",
        itemNameAr: "أعمال إضافية",
        isStock: false,
        qty: Qty.fromMajor("1"),
        unitPrice: Money.fromMajor("210000"),
        taxRatePercent: 0,
        revenueAccountId: REVENUE,
      },
    ],
    ...overrides,
  };
}

describe("sales invoice confirm — contracting billing re-route", () => {
  it("credits billings instead of revenue on a live cost_to_cost project, and says so in the memo", async () => {
    const { svc, ledger, repo } = await harness(COST_TO_COST);
    await svc.createDraft(draftCmd());
    const { invoice } = await svc.confirm("INV-1");

    const entry = await ledger.findById(invoice.journalEntryId as string);
    expect(entry!.lines.some((l) => l.accountId === REVENUE)).toBe(false);
    expect(entry!.lines.find((l) => l.accountId === BILLINGS)?.credit.toString()).toBe("210000.000000");
    expect((await repo.findById("INV-1"))?.notes).toMatch(/فواتير المستخلصات/);
  });

  it("leaves an invoice alone when the project has no live cost_to_cost contract", async () => {
    const { svc, ledger } = await harness(COST_TO_COST);
    await svc.createDraft(draftCmd({ id: "INV-2", projectId: "PRJ-OTHER" }));
    const { invoice } = await svc.confirm("INV-2");

    const entry = await ledger.findById(invoice.journalEntryId as string);
    expect(entry!.lines.find((l) => l.accountId === REVENUE)?.credit.toString()).toBe("210000.000000");
    expect(entry!.lines.some((l) => l.accountId === BILLINGS)).toBe(false);
  });

  it("moves only REVENUE lines — a retention-release line keeps its own account", async () => {
    const { svc, ledger } = await harness(COST_TO_COST);
    await svc.createDraft(
      draftCmd({
        id: "INV-3",
        lines: [
          {
            lineId: "L1",
            itemId: "SVC-RET",
            itemNameAr: "الإفراج عن المحتجزات",
            isStock: false,
            qty: Qty.fromMajor("1"),
            unitPrice: Money.fromMajor("50000"),
            taxRatePercent: 0,
            revenueAccountId: RETENTION,
          },
        ],
      }),
    );
    const { invoice } = await svc.confirm("INV-3");
    const entry = await ledger.findById(invoice.journalEntryId as string);
    expect(entry!.lines.find((l) => l.accountId === RETENTION)?.credit.toString()).toBe("50000.000000");
    expect(entry!.lines.some((l) => l.accountId === BILLINGS)).toBe(false);
  });

  it("posts exactly where the lines say when no contracting port is wired at all", async () => {
    const { svc, ledger } = await harness();
    await svc.createDraft(draftCmd({ id: "INV-4" }));
    const { invoice } = await svc.confirm("INV-4");
    const entry = await ledger.findById(invoice.journalEntryId as string);
    expect(entry!.lines.find((l) => l.accountId === REVENUE)?.credit.toString()).toBe("210000.000000");
  });
});
