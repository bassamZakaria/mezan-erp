// @vitest-environment jsdom
/**
 * The other half of `hooks.ts`'s untested branches: the query-string builders.
 *
 * Every list surface in the app is three sibling hooks — rows, chip counts and
 * the KPI strip — over one `xxxParams(filter)` builder, and each builder is a
 * run of `if (filter.x) params.set("x", …)` lines. A filter axis the builder
 * silently drops is the failure this catches: the rows narrow, the chips and
 * the strip do not, and the screen shows a header that describes a different
 * set of rows than the ones under it.
 *
 * So each builder is driven once with EVERY axis set, and the request path is
 * asserted to carry every one of them. The chips are the deliberate exception:
 * `xxxCounts` drops its own status axis, because a chip states how many rows
 * it WOULD show — counting the already status-filtered set renders every chip
 * but the active one as zero. That exception is asserted here rather than
 * assumed.
 */
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { testAdminSession } from "./test-support";
import type { Transport } from "./transport";
import * as hooks from "./hooks";

function recordingProvider() {
  const paths: string[] = [];
  const transport: Transport = (path) => {
    paths.push(path);
    return Promise.resolve({
      status: 200,
      ok: true,
      json: <T,>() => Promise.resolve([] as unknown as T),
      text: () => Promise.resolve("[]"),
    });
  };
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppI18nProvider>
        <QueryClientProvider client={createQueryClient()}>
          <ApiProvider transport={transport} initialSession={testAdminSession}>
            {children}
          </ApiProvider>
        </QueryClientProvider>
      </AppI18nProvider>
    );
  }
  return { paths, Wrapper };
}

/**
 * One case per list family: the three sibling hooks, a filter with every axis
 * this family's builder reads, and the query parameters that must survive.
 *
 * `status` is deliberately a real value rather than "all" — every builder
 * treats "all" as "no filter", which is the one value that must NOT reach the
 * wire.
 */
interface Family {
  readonly name: string;
  readonly hooks: readonly string[];
  readonly filter: Record<string, unknown>;
  readonly expected: readonly string[];
  /**
   * Whether the client drops the status axis before calling `/counts`.
   * Vouchers are the exception: that list has TWO chip axes (status and
   * type), so the SERVER drops whichever axis it is counting and the client
   * has to send both.
   */
  readonly countsKeepsStatus?: boolean;
}

const FAMILIES: readonly Family[] = [
  {
    name: "items",
    hooks: ["useItems", "useItemCounts", "useItemStats"],
    filter: {
      status: "active",
      categoryId: "cat-1",
      brandId: "br-1",
      seasonId: "se-1",
      unitCode: "PCS",
      search: "شاي",
    },
    expected: ["status=active", "categoryId=cat-1", "brandId=br-1", "seasonId=se-1", "unitCode=PCS", "search="],
  },
  {
    name: "customers",
    hooks: ["useCustomers", "useCustomerCounts", "useCustomerStats"],
    filter: { status: "active", priceListId: "pl-1", overLimit: true, q: "أحمد" },
    expected: ["status=active", "priceListId=pl-1", "overLimit=true", "q="],
  },
  {
    name: "suppliers",
    hooks: ["useSuppliers", "useSupplierCounts", "useSupplierStats"],
    filter: { status: "inactive", q: "النور" },
    expected: ["status=inactive", "q="],
  },
  {
    name: "sales quotes",
    hooks: ["useSalesQuotes", "useSalesQuoteCounts", "useSalesQuoteStats"],
    filter: {
      status: "sent",
      customerId: "c-1",
      branchId: "BR1",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "QT",
    },
    expected: ["status=sent", "customerId=c-1", "branchId=BR1", "fromDate=2026-08-01", "toDate=2026-08-31", "search=QT"],
  },
  {
    name: "sales invoices",
    hooks: ["useSalesInvoices", "useSalesInvoiceCounts", "useSalesInvoiceStats"],
    filter: {
      status: "overdue",
      customerId: "c-1",
      branchId: "BR1",
      warehouseId: "WH1",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "INV",
      page: 2,
      pageSize: 25,
    },
    expected: [
      "status=overdue",
      "customerId=c-1",
      "branchId=BR1",
      "warehouseId=WH1",
      "fromDate=2026-08-01",
      "toDate=2026-08-31",
      "search=INV",
    ],
  },
  {
    name: "sales returns",
    hooks: ["useSalesReturns", "useSalesReturnCounts", "useSalesReturnStats"],
    filter: {
      status: "confirmed",
      customerId: "c-1",
      awaitingRefund: true,
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "SR",
    },
    expected: ["status=confirmed", "customerId=c-1", "fromDate=2026-08-01", "toDate=2026-08-31", "search=SR"],
  },
  {
    name: "journal entries",
    hooks: ["useJournalEntries", "useJournalEntryCounts", "useJournalEntryStats"],
    filter: {
      status: "posted",
      source: "manual",
      sourceModule: "sales",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "JE",
    },
    expected: [
      "status=posted",
      "source=manual",
      "sourceModule=sales",
      "fromDate=2026-08-01",
      "toDate=2026-08-31",
      "search=JE",
    ],
  },
  {
    name: "vouchers",
    countsKeepsStatus: true,
    hooks: ["useVouchers", "useVoucherCounts", "useVoucherStats"],
    filter: {
      status: "confirmed",
      type: "customer_collection",
      branchId: "BR1",
      needsAllocation: "receipt",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "CV",
    },
    expected: [
      "status=confirmed",
      "type=customer_collection",
      "branchId=BR1",
      "needsAllocation=receipt",
      "fromDate=2026-08-01",
      "toDate=2026-08-31",
      "search=CV",
    ],
  },
  {
    name: "purchase orders",
    hooks: ["usePurchaseOrders", "usePurchaseOrderCounts", "usePurchaseOrderStats"],
    filter: {
      status: "sent",
      supplierId: "s-1",
      branchId: "BR1",
      warehouseId: "WH1",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "PO",
    },
    expected: [
      "status=sent",
      "supplierId=s-1",
      "branchId=BR1",
      "warehouseId=WH1",
      "fromDate=2026-08-01",
      "toDate=2026-08-31",
      "search=PO",
    ],
  },
  {
    name: "goods receipts",
    hooks: ["useGoodsReceipts", "useGoodsReceiptCounts", "useGoodsReceiptStats"],
    filter: {
      status: "confirmed",
      supplierId: "s-1",
      warehouseId: "WH1",
      invoiced: false,
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "GR",
    },
    expected: [
      "status=confirmed",
      "supplierId=s-1",
      "warehouseId=WH1",
      "invoiced=false",
      "fromDate=2026-08-01",
      "toDate=2026-08-31",
      "search=GR",
    ],
  },
  {
    name: "purchase invoices",
    hooks: ["usePurchaseInvoices", "usePurchaseInvoiceCounts", "usePurchaseInvoiceStats"],
    filter: {
      status: "confirmed",
      supplierId: "s-1",
      branchId: "BR1",
      warehouseId: "WH1",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "PI",
    },
    expected: [
      "status=confirmed",
      "supplierId=s-1",
      "branchId=BR1",
      "warehouseId=WH1",
      "fromDate=2026-08-01",
      "toDate=2026-08-31",
      "search=PI",
    ],
  },
  {
    name: "purchase returns",
    hooks: ["usePurchaseReturns", "usePurchaseReturnCounts", "usePurchaseReturnStats"],
    filter: {
      status: "confirmed",
      supplierId: "s-1",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "PR",
    },
    expected: ["status=confirmed", "supplierId=s-1", "fromDate=2026-08-01", "toDate=2026-08-31", "search=PR"],
  },
  {
    name: "stock transfers",
    hooks: ["useStockTransfers", "useStockTransferCounts", "useStockTransferStats"],
    filter: {
      status: "confirmed",
      warehouseId: "WH1",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "TR",
    },
    expected: ["status=confirmed", "warehouseId=WH1", "fromDate=2026-08-01", "toDate=2026-08-31", "search=TR"],
  },
  {
    name: "stock adjustments",
    hooks: ["useStockAdjustments", "useStockAdjustmentCounts", "useStockAdjustmentStats"],
    filter: {
      status: "draft",
      reason: "DAMAGE",
      warehouseId: "WH1",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "ADJ",
    },
    expected: [
      "status=draft",
      "reason=DAMAGE",
      "warehouseId=WH1",
      "fromDate=2026-08-01",
      "toDate=2026-08-31",
      "search=ADJ",
    ],
  },
  {
    name: "physical counts",
    hooks: ["usePhysicalCounts", "usePhysicalCountCounts", "usePhysicalCountStats"],
    filter: { status: "IN_PROGRESS", warehouseId: "WH1", search: "PC" },
    expected: ["status=IN_PROGRESS", "warehouseId=WH1", "search=PC"],
  },
  {
    name: "RFQs",
    hooks: ["useRfqs", "useRfqCounts", "useRfqStats"],
    filter: {
      status: "sent",
      branchId: "BR1",
      warehouseId: "WH1",
      fromDate: "2026-08-01",
      toDate: "2026-08-31",
      search: "RFQ",
    },
    expected: [
      "status=sent",
      "branchId=BR1",
      "warehouseId=WH1",
      "fromDate=2026-08-01",
      "toDate=2026-08-31",
      "search=RFQ",
    ],
  },
  {
    name: "assets",
    hooks: ["useAssets", "useAssetCounts", "useAssetStats"],
    filter: { status: "active", categoryId: "cat-1", branchId: "BR1", search: "AST" },
    expected: ["status=active", "categoryId=cat-1", "branchId=BR1", "search=AST"],
  },
  {
    name: "work orders",
    hooks: ["useWorkOrders", "useWorkOrderCounts", "useWorkOrderStats"],
    filter: { status: "released", stage: "CUTTING", priority: "high", search: "WO" },
    expected: ["status=released", "stage=CUTTING", "priority=high", "search=WO"],
  },
  {
    name: "installment plans",
    hooks: ["useInstallmentPlans", "useInstallmentPlanCounts", "useInstallmentPlanStats"],
    filter: { status: "active" },
    expected: ["status=active"],
  },
];

type AnyHook = (...args: unknown[]) => unknown;

async function pathsFor(hookName: string, filter: Record<string, unknown>): Promise<readonly string[]> {
  const hook = (hooks as unknown as Record<string, AnyHook | undefined>)[hookName];
  if (!hook) throw new Error(`${hookName} is not exported from hooks.ts`);
  const { paths, Wrapper } = recordingProvider();
  const { result } = renderHook(() => hook(filter), { wrapper: Wrapper });
  await waitFor(() => {
    expect((result.current as { isPending: boolean }).isPending).toBe(false);
  });
  return paths;
}

describe("hooks.ts — the rows, the chips and the strip narrow by the same axes", () => {
  for (const family of FAMILIES) {
    const statusParam = family.expected.find((p) => p.startsWith("status="));
    const [listHook, countsHook, statsHook] = family.hooks;

    describe(family.name, () => {
      for (const hookName of [listHook, statsHook]) {
        it(`${hookName} carries every filter axis onto the wire`, async () => {
          const paths = await pathsFor(hookName!, family.filter);
          expect(paths).toHaveLength(1);
          for (const param of family.expected) {
            expect(paths[0]!, `${hookName} → ${param}`).toContain(param);
          }
        });
      }

      it(`${countsHook} carries every axis but its own status one`, async () => {
        const paths = await pathsFor(countsHook!, family.filter);
        expect(paths).toHaveLength(1);
        const path = paths[0]!;
        for (const param of family.expected) {
          if (param === statusParam) continue;
          expect(path, `${countsHook} → ${param}`).toContain(param);
        }
        // The chip's own axis is deliberately dropped: counting the already
        // status-filtered set would render every other chip as zero.
        if (statusParam && !family.countsKeepsStatus) expect(path).not.toContain(statusParam);
        if (statusParam && family.countsKeepsStatus) expect(path).toContain(statusParam);
      });
    });
  }
});
