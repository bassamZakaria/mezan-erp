import { describe, expect, it } from "vitest";
import { PLAIN_SALES_TAX_DEPS } from "./test-support.js";
import { Money, Qty } from "../money/index.js";
import type { Account } from "../accounts/account.js";
import { InMemoryAccountRepository } from "../accounts/test-helpers/in-memory-account-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { StockLedgerService } from "../inventory/index.js";
import { InMemoryStockLedger, InMemoryCostLayers, InMemorySnapshots } from "../inventory/test-helpers/in-memory-stores.js";
import type { DocumentWorkflowGate, DocumentWorkflowInput } from "../documents/hooks.js";
import { SalesInvoiceService, createSalesInvoiceGlHook, createSalesInvoiceStockHook, type CreateSalesInvoiceCommand } from "./index.js";
import { InMemorySalesInvoiceRepository } from "./test-helpers/in-memory-sales-invoice-repository.js";
import {
  PricingGuardApprovalUnconfiguredError,
  PricingGuardBlockedError,
  PricingGuardMode,
  PricingGuardOverrideKind,
  PricingGuardRuleStatus,
  PricingGuardService,
  type PricingGuardOverride,
  type PricingGuardRule,
} from "../pricing-guard/index.js";

const AR = "1300";
const REVENUE = "4000";
const TAX = "2200";
const NOW = "2026-08-22T10:00:00.000Z";

function account(id: string, overrides: Partial<Account> = {}): Account {
  return { id, code: id, nameAr: id, nameEn: null, type: "asset", naturalBalance: "debit", parentId: null, isHeader: false, status: "active", ...overrides };
}

function floorRule(mode: PricingGuardMode): PricingGuardRule {
  return {
    id: "R-FLOOR",
    nameAr: "حد أدنى",
    itemId: "SVC-1",
    categoryId: null,
    customerCategory: null,
    floorPrice: Money.fromMajor("600"),
    minMarginPercent: null,
    mode,
    status: PricingGuardRuleStatus.Active,
    note: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: "owner",
    updatedBy: "owner",
  };
}

async function build(opts: { mode: PricingGuardMode; chain: boolean; workflow?: DocumentWorkflowGate; actorRoles?: readonly string[]; rules?: PricingGuardRule[] }) {
  const accounts = new InMemoryAccountRepository();
  await accounts.create(account(AR));
  await accounts.create(account(REVENUE, { type: "revenue", naturalBalance: "credit" }));
  await accounts.create(account(TAX, { type: "liability", naturalBalance: "credit" }));
  const periods = new InMemoryFiscalPeriodRepository();
  await periods.create({ id: "fp", year: 2026, periodNumber: 8, startDate: "2026-08-01", endDate: "2026-08-31", status: "open" });
  const ledger = new InMemoryLedgerRepository();
  const gl = createSalesInvoiceGlHook({ ledger, accounts, periods, numbering: new NextNumberService(new InMemorySequenceStore()), now: () => NOW, actor: "u1" });
  const stock = createSalesInvoiceStockHook(
    new StockLedgerService({ ledger: new InMemoryStockLedger(), layers: new InMemoryCostLayers(), snapshots: new InMemorySnapshots(), policy: { allowNegativeStock: true }, clock: () => NOW }),
  );
  const recorded: PricingGuardOverride[] = [];
  const guard = new PricingGuardService({
    rules: { list: async () => opts.rules ?? [floorRule(opts.mode)] },
    overrides: { recordAll: async (rows) => void recorded.push(...rows), list: async () => recorded },
    costs: { unitCostAsOf: async () => null, itemCostPrice: async () => null },
    categoryAncestry: async () => [],
    customerCategory: async () => null,
    rateOn: async () => null,
    baseCurrency: async () => "EGP",
    approvalChainConfigured: async () => opts.chain,
  });
  const repo = new InMemorySalesInvoiceRepository();
  const numbering = new NextNumberService(new InMemorySequenceStore());
  const svc = new SalesInvoiceService({
    ...PLAIN_SALES_TAX_DEPS,
    repo,
    numbering: { next: () => numbering.next("SALES_INVOICE") },
    gl,
    stock,
    now: () => NOW,
    actor: "u1",
    actorRoles: opts.actorRoles,
    pricingGuard: guard,
    workflow: opts.workflow,
  });
  return { svc, recorded };
}

function draft(): CreateSalesInvoiceCommand {
  return {
    id: "inv-1",
    date: "2026-08-22",
    dueDate: "2026-09-21",
    customerId: "cust-1",
    customerNameAr: "عميل",
    warehouseId: "WH1",
    branchId: "BR1",
    arAccountId: AR,
    taxAccountId: TAX,
    lines: [{ lineId: "L1", itemId: "SVC-1", itemNameAr: "خدمة", isStock: false, qty: Qty.fromMajor("1"), unitPrice: Money.fromMajor("500"), taxRatePercent: 0, revenueAccountId: REVENUE }],
  };
}

function recordingGate(granted: boolean, seen: DocumentWorkflowInput[]): DocumentWorkflowGate {
  return {
    evaluate: async (input) => {
      seen.push(input);
      return { granted, requestId: input.requestId };
    },
  };
}

describe("SalesInvoiceService.confirm — price floor (ENH-E2-08)", () => {
  it("refuses a Block-rule breach and leaves the invoice a draft", async () => {
    const { svc } = await build({ mode: PricingGuardMode.Block, chain: true });
    await svc.createDraft(draft());
    await expect(svc.confirm("inv-1")).rejects.toBeInstanceOf(PricingGuardBlockedError);
    expect((await svc.findById("inv-1"))?.status).toBe("draft");
  });

  it("fails closed when approve-mode has no chain to route to", async () => {
    const seen: DocumentWorkflowInput[] = [];
    const { svc } = await build({ mode: PricingGuardMode.Approval, chain: false, workflow: recordingGate(true, seen) });
    await svc.createDraft(draft());
    await expect(svc.confirm("inv-1")).rejects.toBeInstanceOf(PricingGuardApprovalUnconfiguredError);
    expect(seen).toHaveLength(0);
  });

  it("holds an approve-mode breach under the price-floor action, not the ordinary confirm", async () => {
    const seen: DocumentWorkflowInput[] = [];
    const { svc } = await build({ mode: PricingGuardMode.Approval, chain: true, workflow: recordingGate(false, seen) });
    await svc.createDraft(draft());
    const result = await svc.confirm("inv-1");
    expect(result.held).toBe(true);
    expect(seen[0]?.actionType).toBe("SALES_PRICE_FLOOR_OVERRIDE");
    expect(result.invoice.workflowRequestId).toBe("inv-1:price-floor");
  });

  it("posts once approved and records the override against the approval request", async () => {
    const seen: DocumentWorkflowInput[] = [];
    const { svc, recorded } = await build({ mode: PricingGuardMode.Approval, chain: true, workflow: recordingGate(true, seen) });
    await svc.createDraft(draft());
    const result = await svc.confirm("inv-1");
    expect(result.invoice.status).toBe("confirmed");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.kind).toBe(PricingGuardOverrideKind.ApprovedByChain);
    expect(recorded[0]?.approvalRequestId).toBe("inv-1:price-floor");
    expect(recorded[0]?.netUnitPrice.toString()).toBe(Money.fromMajor("500").toString());
  });

  it("lets a wildcard administrator sell below the floor without a chain, recorded as a bypass", async () => {
    const { svc, recorded } = await build({ mode: PricingGuardMode.Approval, chain: false, actorRoles: ["*"] });
    await svc.createDraft(draft());
    expect((await svc.confirm("inv-1")).invoice.status).toBe("confirmed");
    expect(recorded[0]?.kind).toBe(PricingGuardOverrideKind.AdminBypass);
  });

  it("re-points a held invoice at the request that now holds it once the breach is gone", async () => {
    const seen: DocumentWorkflowInput[] = [];
    const rules = [floorRule(PricingGuardMode.Approval)];
    const { svc } = await build({ mode: PricingGuardMode.Approval, chain: true, workflow: recordingGate(false, seen), rules });
    await svc.createDraft(draft());
    expect((await svc.confirm("inv-1")).invoice.workflowRequestId).toBe("inv-1:price-floor");
    rules.length = 0;
    const again = await svc.confirm("inv-1");
    expect(again.held).toBe(true);
    expect(seen.at(-1)?.actionType).toBe("SALES_INVOICE_CONFIRM");
    expect((await svc.findById("inv-1"))?.workflowRequestId).toBe("inv-1:confirm");
  });
});
