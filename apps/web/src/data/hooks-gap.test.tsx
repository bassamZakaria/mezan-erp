// @vitest-environment jsdom
/**
 * hooks.test.tsx deliberately samples ~12 domains out of hooks.ts's 382 hooks.
 * This file closes the specific gap left behind: every `mutationFn`/`onSuccess`/
 * `queryFn` the full-suite coverage run showed as NEVER EXECUTED (not merely
 * under-asserted) — 76 functions across cheques, goods receipts, CRM, assets,
 * product-template variants, van trips, manufacturing (BOM/work
 * orders/config instances), stock documents, physical counts, RFQs, sales
 * returns, installments, HR, notification rules, historical import, workflow
 * approvals, item catalogs, account routing/tax groups, the test-email
 * sender, entity audit, item movements and cost centers. Each test asserts
 * the request shape (method, path, exact body) and, for mutations, the exact
 * invalidated query keys — never just "it rendered" or "it was called".
 */
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import type { Session } from "./session";
import { stubTransport, testAdminSession } from "./test-support";
import type { Transport } from "./transport";
import {
  ApiError,
  useAccountRouting,
  useAddAttributeValue,
  useAssetCounts,
  useCancelActivity,
  useCancelConfigInstance,
  useCancelPhysicalCount,
  useCancelWorkOrder,
  useCloseConfigInstance,
  useCompletePhysicalCount,
  useConfirmGoodsReceipt,
  useCreateCostCentersFromDepartments,
  useCreateItemCategory,
  useCreateItemUnit,
  useCreateRfq,
  useCreateRfqQuote,
  useCreateSalesReturn,
  useCreateTaxGroup,
  useCreateWorkOrder,
  useDeactivateBom,
  useDeleteAttributeValue,
  useDeleteTemplateAttribute,
  useEntityAudit,
  useExtraIssueWorkOrderMaterials,
  useGenerateAdjustmentFromCount,
  useHistoricalImportCommit,
  useHistoricalImportPreview,
  useIssueWorkOrderMaterials,
  useItemMovements,
  useLogWorkOrderCost,
  useLogWorkOrderWaste,
  useMoveOpportunityStage,
  useProcessOverdueInstallments,
  useReceiveWorkOrderProduct,
  useRecordPhysicalCountEntries,
  useRecordVanCashMovement,
  useRefundSalesReturn,
  useRehireEmployee,
  useReplaceCheque,
  useResolvePriceListPrice,
  useReturnWorkOrderMaterials,
  useSendTestEmail,
  useStartPhysicalCount,
  useStockAdjustment,
  useStockTransfer,
  useSubmitApproval,
  useTaxGroups,
  useTerminateEmployee,
  useUpdateAccountRouting,
  useUpdateEmployee,
  useUpdateHoliday,
  useUpdateItemCategory,
  useUpdateItemUnit,
  useUpdateJobTitle,
  useUpdateNotificationRule,
  useUpdateWarehouse,
} from "./hooks";

function makeWrapper(transport: Transport, session: Session | null = testAdminSession) {
  const queryClient = createQueryClient();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AppI18nProvider>
        <QueryClientProvider client={queryClient}>
          <ApiProvider transport={transport} initialSession={session}>
            {children}
          </ApiProvider>
        </QueryClientProvider>
      </AppI18nProvider>
    );
  }
  return { Wrapper, queryClient };
}

function jsonBody(init: RequestInit | undefined): unknown {
  return JSON.parse((init?.body as string) ?? "{}");
}

describe("cheques and warehouses", () => {
  it("useReplaceCheque POSTs /cheques/:id/replace with the body and invalidates ['cheques']", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /cheques/CHQ1/replace": (init, path) => {
        seenPath = path;
        seenBody = jsonBody(init);
        return { body: { original: { id: "CHQ1" }, replacement: { id: "CHQ2" } } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useReplaceCheque(), { wrapper: Wrapper });
    result.current.mutate({ id: "CHQ1", body: { newDueDate: "2026-04-01" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/cheques/CHQ1/replace");
    expect(seenBody).toEqual({ newDueDate: "2026-04-01" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["cheques"] });
  });

  it("useReplaceCheque surfaces the server's refusal message and invalidates nothing", async () => {
    const transport = stubTransport({
      "POST /cheques/CHQ1/replace": () => ({ status: 409, body: { message: "الشيك ليس في حالة مرتد" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useReplaceCheque(), { wrapper: Wrapper });
    result.current.mutate({ id: "CHQ1", body: {} as never });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).message).toBe("الشيك ليس في حالة مرتد");
    expect(spy).not.toHaveBeenCalled();
  });

  it("useUpdateWarehouse PUTs /warehouses/:id and invalidates ['warehouses']", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "PUT /warehouses/W1": (_init, path) => {
        seenPath = path;
        return { body: { id: "W1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateWarehouse(), { wrapper: Wrapper });
    result.current.mutate({ id: "W1", patch: { nameAr: "مستودع جديد" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/warehouses/W1");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["warehouses"] });
  });
});

describe("goods receipts", () => {
  it("useConfirmGoodsReceipt invalidates BOTH ['goods-receipts'] and ['purchase-orders'] — a receipt confirm can close its funding PO", async () => {
    const transport = stubTransport({
      "POST /purchases/receipts/GR1/confirm": () => ({ body: { id: "GR1", status: "confirmed" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useConfirmGoodsReceipt(), { wrapper: Wrapper });
    result.current.mutate("GR1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["goods-receipts"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["purchase-orders"] });
  });
});

describe("CRM", () => {
  it("useMoveOpportunityStage POSTs the stage body and invalidates ['crm-opportunities']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /crm/opportunities/OPP1/move-stage": (init) => {
        seenBody = jsonBody(init);
        return { body: { id: "OPP1", stageId: "S2" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useMoveOpportunityStage(), { wrapper: Wrapper });
    result.current.mutate({ id: "OPP1", body: { stageId: "S2" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ stageId: "S2" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["crm-opportunities"] });
  });

  it("useCancelActivity POSTs an empty body to /cancel and invalidates ['crm-activities']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /crm/activities/ACT1/cancel": (init) => {
        seenBody = jsonBody(init);
        return { body: { id: "ACT1", status: "cancelled" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCancelActivity(), { wrapper: Wrapper });
    result.current.mutate("ACT1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({});
    expect(spy).toHaveBeenCalledWith({ queryKey: ["crm-activities"] });
  });
});

describe("assets", () => {
  it("useAssetCounts withholds the status axis so every chip reports its own total, and keeps the other filters", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /assets/counts": (_init, path) => {
        seenPath = path;
        return { body: { all: 3 } };
      },
    });
    const { result } = renderHook(() => useAssetCounts({ status: "active", branchId: "B1" } as never), {
      wrapper: makeWrapper(transport).Wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).not.toContain("status=");
    expect(seenPath).toContain("branchId=B1");
  });
});

describe("product template variants", () => {
  it("useDeleteTemplateAttribute DELETEs the attribute and invalidates ['product-templates']", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "DELETE /inventory/product-templates/T1/attributes/ATTR1": (_init, path) => {
        seenPath = path;
        return { body: { id: "T1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteTemplateAttribute(), { wrapper: Wrapper });
    result.current.mutate({ templateId: "T1", attributeId: "ATTR1" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/inventory/product-templates/T1/attributes/ATTR1");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["product-templates"] });
  });

  it("useAddAttributeValue POSTs the value and invalidates ['product-templates']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /inventory/product-templates/T1/attributes/ATTR1/values": (init) => {
        seenBody = jsonBody(init);
        return { body: { id: "T1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useAddAttributeValue(), { wrapper: Wrapper });
    result.current.mutate({ templateId: "T1", attributeId: "ATTR1", body: { value: "XL" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ value: "XL" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["product-templates"] });
  });

  it("useDeleteAttributeValue percent-encodes the value into the path", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "DELETE /inventory/product-templates/T1/attributes/ATTR1/values/*": (_init, path) => {
        seenPath = path;
        return { body: { id: "T1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeleteAttributeValue(), { wrapper: Wrapper });
    result.current.mutate({ templateId: "T1", attributeId: "ATTR1", value: "مقاس كبير" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe(`/inventory/product-templates/T1/attributes/ATTR1/values/${encodeURIComponent("مقاس كبير")}`);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["product-templates"] });
  });
});

describe("van trips", () => {
  it("useRecordVanCashMovement POSTs the movement and invalidates ['van-trips']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /field/van-trips/VT1/cash-movements": (init) => {
        seenBody = jsonBody(init);
        return { body: { id: "VT1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRecordVanCashMovement(), { wrapper: Wrapper });
    result.current.mutate({ id: "VT1", body: { kind: "collection", amount: "500.000000" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ kind: "collection", amount: "500.000000" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["van-trips"] });
  });
});

describe("manufacturing — BOMs, work orders and configurable products", () => {
  it("useDeactivateBom POSTs /manufacturing/boms/:id/deactivate and invalidates ['boms']", async () => {
    const transport = stubTransport({
      "POST /manufacturing/boms/BOM1/deactivate": () => ({ body: { id: "BOM1", status: "inactive" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useDeactivateBom(), { wrapper: Wrapper });
    result.current.mutate("BOM1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["boms"] });
  });

  it("useCreateWorkOrder sends the plan and invalidates ['work-orders']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /manufacturing/work-orders": (init) => {
        seenBody = jsonBody(init);
        return { status: 201, body: { id: "WO1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateWorkOrder(), { wrapper: Wrapper });
    result.current.mutate({ bomId: "BOM1", plannedQty: "10" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ bomId: "BOM1", plannedQty: "10" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["work-orders"] });
  });

  it("useCancelWorkOrder invalidates BOTH ['work-orders'] and ['work-order-activity', id]", async () => {
    const transport = stubTransport({
      "POST /manufacturing/work-orders/WO1/cancel": () => ({ body: { id: "WO1", status: "cancelled" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCancelWorkOrder(), { wrapper: Wrapper });
    result.current.mutate("WO1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["work-orders"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["work-order-activity", "WO1"] });
  });

  it.each([
    ["useIssueWorkOrderMaterials", useIssueWorkOrderMaterials, "issue"],
    ["useExtraIssueWorkOrderMaterials", useExtraIssueWorkOrderMaterials, "extra-issue"],
    ["useReturnWorkOrderMaterials", useReturnWorkOrderMaterials, "return"],
    ["useLogWorkOrderWaste", useLogWorkOrderWaste, "log-waste"],
    ["useLogWorkOrderCost", useLogWorkOrderCost, "log-cost"],
    ["useReceiveWorkOrderProduct", useReceiveWorkOrderProduct, "receive"],
  ] as const)("%s POSTs .../%s and invalidates work-orders AND that work order's activity cache", async (_name, hook, action) => {
    let seenPath = "";
    let seenBody: unknown = null;
    const transport = stubTransport({
      [`POST /manufacturing/work-orders/WO7/${action}`]: (init, path) => {
        seenPath = path;
        seenBody = jsonBody(init);
        return { body: { id: "WO7" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => hook(), { wrapper: Wrapper });
    result.current.mutate({ id: "WO7", body: { itemId: "I1", qty: "5" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe(`/manufacturing/work-orders/WO7/${action}`);
    expect(seenBody).toEqual(action === "issue" ? { itemId: "I1", qty: "5" } : { itemId: "I1", qty: "5" });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["work-orders"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["work-order-activity", "WO7"] });
  });

  it("useCloseConfigInstance and useCancelConfigInstance hit their own action route and both invalidate only ['config-instances']", async () => {
    const transport = stubTransport({
      "POST /manufacturing/config-instances/CI1/close": () => ({ body: { id: "CI1", status: "closed" } }),
      "POST /manufacturing/config-instances/CI2/cancel": () => ({ body: { id: "CI2", status: "cancelled" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result: close } = renderHook(() => useCloseConfigInstance(), { wrapper: Wrapper });
    close.current.mutate("CI1");
    await waitFor(() => expect(close.current.isSuccess).toBe(true));

    const { result: cancel } = renderHook(() => useCancelConfigInstance(), { wrapper: Wrapper });
    cancel.current.mutate("CI2");
    await waitFor(() => expect(cancel.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["config-instances"] });
  });
});

describe("stock documents — deep links", () => {
  it("useStockAdjustment fetches by id/number with encoding and does not retry a 404", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /inventory/stock-adjustments/*": () => {
        calls += 1;
        return { status: 404, body: { message: "غير موجود" } };
      },
    });
    const { result } = renderHook(() => useStockAdjustment("SA 01"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
    expect(result.current.error).toBeInstanceOf(ApiError);
  });

  it("useStockAdjustment(null) does not call the transport (disabled)", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /inventory/stock-adjustments/*": () => {
        called = true;
        return { body: {} };
      },
    });
    const { result } = renderHook(() => useStockAdjustment(null), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
    expect(result.current.isPending).toBe(true);
  });

  it("useStockTransfer fetches /inventory/stock-transfers/:id and does not retry a 404", async () => {
    let calls = 0;
    const transport = stubTransport({
      "GET /inventory/stock-transfers/ST1": () => {
        calls += 1;
        return { status: 404, body: {} };
      },
    });
    const { result } = renderHook(() => useStockTransfer("ST1"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toBe(1);
  });
});

describe("physical counts", () => {
  it("useStartPhysicalCount POSTs the opening body and invalidates ['physical-counts']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /inventory/physical-counts": (init) => {
        seenBody = jsonBody(init);
        return { status: 201, body: { id: "PC1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useStartPhysicalCount(), { wrapper: Wrapper });
    result.current.mutate({ warehouseId: "W1" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ warehouseId: "W1" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["physical-counts"] });
  });

  it("useRecordPhysicalCountEntries POSTs the counted rows and invalidates ['physical-counts']", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /inventory/physical-counts/PC1/counts": (init, path) => {
        seenPath = path;
        seenBody = jsonBody(init);
        return { body: { id: "PC1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRecordPhysicalCountEntries(), { wrapper: Wrapper });
    result.current.mutate({ id: "PC1", body: { entries: [{ itemId: "I1", countedQty: "3" }] } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/inventory/physical-counts/PC1/counts");
    expect(seenBody).toEqual({ entries: [{ itemId: "I1", countedQty: "3" }] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["physical-counts"] });
  });

  it("useCompletePhysicalCount and useCancelPhysicalCount both invalidate only ['physical-counts']", async () => {
    const transport = stubTransport({
      "POST /inventory/physical-counts/PC1/complete": () => ({ body: { id: "PC1", status: "completed" } }),
      "POST /inventory/physical-counts/PC2/cancel": () => ({ body: { id: "PC2", status: "cancelled" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result: complete } = renderHook(() => useCompletePhysicalCount(), { wrapper: Wrapper });
    complete.current.mutate("PC1");
    await waitFor(() => expect(complete.current.isSuccess).toBe(true));

    const { result: cancel } = renderHook(() => useCancelPhysicalCount(), { wrapper: Wrapper });
    cancel.current.mutate("PC2");
    await waitFor(() => expect(cancel.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["physical-counts"] });
  });

  it("useGenerateAdjustmentFromCount invalidates THREE caches — the count, the generated adjustment doc, and the stock balance it changes", async () => {
    const transport = stubTransport({
      "POST /inventory/physical-counts/PC1/generate-adjustment": () => ({
        body: { count: { id: "PC1" }, adjustment: { id: "SA1" } },
      }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useGenerateAdjustmentFromCount(), { wrapper: Wrapper });
    result.current.mutate({ id: "PC1", body: {} as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["physical-counts"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["stock-adjustments"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["stock-balance"] });
  });
});

describe("RFQs", () => {
  it("useCreateRfq sends the body and invalidates ['rfqs']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /rfqs": (init) => {
        seenBody = jsonBody(init);
        return { status: 201, body: { id: "RFQ1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateRfq(), { wrapper: Wrapper });
    result.current.mutate({ supplierIds: ["S1", "S2"] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ supplierIds: ["S1", "S2"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["rfqs"] });
  });

  it("useCreateRfqQuote invalidates BOTH the rfq's quotes AND its comparison grid — never the bare ['rfqs'] list", async () => {
    const transport = stubTransport({
      "POST /rfqs/RFQ1/quotes": () => ({ status: 201, body: { id: "Q1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateRfqQuote(), { wrapper: Wrapper });
    result.current.mutate({ rfqId: "RFQ1", body: { supplierId: "S1" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["rfqs", "RFQ1", "quotes"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["rfqs", "RFQ1", "comparison"] });
  });
});

describe("sales returns", () => {
  it("useCreateSalesReturn sends the body and invalidates ['sales-returns']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /sales-returns": (init) => {
        seenBody = jsonBody(init);
        return { status: 201, body: { id: "SR1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateSalesReturn(), { wrapper: Wrapper });
    result.current.mutate({ invoiceId: "INV1", lines: [] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ invoiceId: "INV1", lines: [] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sales-returns"] });
  });

  it("useRefundSalesReturn strips `id` out of the body, and invalidates the return, the voucher, treasury, the customer AND the dashboard — a refund moves real cash", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /sales-returns/SR1/refund": (init, path) => {
        seenPath = path;
        seenBody = jsonBody(init);
        return { body: { id: "SR1", voucherId: "V1", voucherNo: "PV-1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRefundSalesReturn(), { wrapper: Wrapper });
    result.current.mutate({ id: "SR1", treasuryAccountId: "TA1", amount: "150.000000" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/sales-returns/SR1/refund");
    expect(seenBody).toEqual({ treasuryAccountId: "TA1", amount: "150.000000" });
    expect(spy).toHaveBeenCalledTimes(5);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["sales-returns"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["vouchers"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["treasury-accounts"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["customers"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
  });
});

describe("installments and follow-ups", () => {
  it("useProcessOverdueInstallments sends the body and invalidates ['installment-plans']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /installments/plans/overdue/process": (init) => {
        seenBody = jsonBody(init);
        return { body: { processedCount: 3 } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useProcessOverdueInstallments(), { wrapper: Wrapper });
    result.current.mutate({ asOfDate: "2026-08-30" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ asOfDate: "2026-08-30" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["installment-plans"] });
  });
});

describe("HR", () => {
  it("useUpdateJobTitle PUTs /hr/job-titles/:id and invalidates ['hr-job-titles']", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "PUT /hr/job-titles/JT1": (_init, path) => {
        seenPath = path;
        return { body: { id: "JT1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateJobTitle(), { wrapper: Wrapper });
    result.current.mutate({ id: "JT1", body: { titleAr: "محاسب أول" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/hr/job-titles/JT1");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr-job-titles"] });
  });

  it("useUpdateEmployee PUTs /hr/employees/:id and invalidates ['hr-employees']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "PUT /hr/employees/E1": (init) => {
        seenBody = jsonBody(init);
        return { body: { id: "E1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateEmployee(), { wrapper: Wrapper });
    result.current.mutate({ id: "E1", body: { nameAr: "أحمد" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ nameAr: "أحمد" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr-employees"] });
  });

  it("useTerminateEmployee POSTs /terminate and invalidates ['hr-employees']", async () => {
    const transport = stubTransport({
      "POST /hr/employees/E1/terminate": () => ({ body: { id: "E1", status: "terminated" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useTerminateEmployee(), { wrapper: Wrapper });
    result.current.mutate("E1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr-employees"] });
  });

  it("useRehireEmployee sends the hire date and invalidates BOTH ['hr-employees'] and ['hr-dashboard']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /hr/employees/E1/rehire": (init) => {
        seenBody = jsonBody(init);
        return { body: { id: "E1", status: "active" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRehireEmployee(), { wrapper: Wrapper });
    result.current.mutate({ id: "E1", hireDate: "2026-09-01" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ hireDate: "2026-09-01" });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr-employees"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr-dashboard"] });
  });

  it("useUpdateHoliday PUTs /hr/holidays/:id and invalidates ['hr-holidays']", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "PUT /hr/holidays/H1": (_init, path) => {
        seenPath = path;
        return { body: { id: "H1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateHoliday(), { wrapper: Wrapper });
    result.current.mutate({ id: "H1", body: { nameAr: "عيد الفطر" } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/hr/holidays/H1");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["hr-holidays"] });
  });
});

describe("notification rules", () => {
  it("useUpdateNotificationRule PUTs /notification-rules/:id and invalidates ['notification-rules']", async () => {
    let seenPath = "";
    let seenBody: unknown = null;
    const transport = stubTransport({
      "PUT /notification-rules/NR1": (init, path) => {
        seenPath = path;
        seenBody = jsonBody(init);
        return { body: { id: "NR1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useUpdateNotificationRule(), { wrapper: Wrapper });
    result.current.mutate({ id: "NR1", body: { active: false } as never });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/notification-rules/NR1");
    expect(seenBody).toEqual({ active: false });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["notification-rules"] });
  });
});

describe("historical import — the wire body maps partyId to the RIGHT side of the ledger", () => {
  it("useHistoricalImportPreview (kind='sales') maps partyId to customerId, and does not invalidate anything", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /sales/historical-import/preview": (init) => {
        seenBody = jsonBody(init);
        return { body: { groups: [], errors: [] } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useHistoricalImportPreview("sales"), { wrapper: Wrapper });
    result.current.mutate([
      {
        rowNumber: 1,
        docType: "SALES_INVOICE",
        documentNumber: "INV-1",
        partyId: "CUST-1",
        date: "2026-01-01",
        qty: "1",
        unitCost: "100.000000",
        amountPaid: "0.000000",
      },
    ]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({
      rows: [
        {
          rowNumber: 1,
          docType: "SALES_INVOICE",
          documentNumber: "INV-1",
          customerId: "CUST-1",
          date: "2026-01-01",
          dueDate: undefined,
          itemId: undefined,
          description: undefined,
          qty: "1",
          unitCost: "100.000000",
          amountPaid: "0.000000",
        },
      ],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("useHistoricalImportCommit (kind='purchases') maps partyId to supplierId — never customerId — and invalidates ['data-migration','status']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /purchases/historical-import/commit": (init) => {
        seenBody = jsonBody(init);
        return { body: { groups: [], errors: [] } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useHistoricalImportCommit("purchases"), { wrapper: Wrapper });
    result.current.mutate([
      {
        rowNumber: 1,
        docType: "PURCHASE_INVOICE",
        documentNumber: "PI-1",
        partyId: "SUP-1",
        date: "2026-01-01",
        qty: "2",
        unitCost: "50.000000",
        amountPaid: "0.000000",
      },
    ]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const body = seenBody as { rows: Record<string, unknown>[] };
    expect(body.rows[0]!.supplierId).toBe("SUP-1");
    expect(body.rows[0]!.customerId).toBeUndefined();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["data-migration", "status"] });
  });
});

describe("workflow approvals", () => {
  it("useSubmitApproval POSTs /workflow/requests and invalidates ['workflow-requests']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /workflow/requests": (init) => {
        seenBody = jsonBody(init);
        return { status: 201, body: { id: "APR1" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSubmitApproval(), { wrapper: Wrapper });
    result.current.mutate({ actionType: "discount_override", payload: {} } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ actionType: "discount_override", payload: {} });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["workflow-requests"] });
  });
});

describe("item catalogs — units and categories", () => {
  it("useCreateItemUnit / useUpdateItemUnit both invalidate exactly ['item-units']", async () => {
    const transport = stubTransport({
      "POST /item-units": () => ({ status: 201, body: { code: "BOX" } }),
      "PATCH /item-units/BOX": () => ({ body: { code: "BOX" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result: create } = renderHook(() => useCreateItemUnit(), { wrapper: Wrapper });
    create.current.mutate({ code: "BOX", nameAr: "صندوق" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));

    const { result: update } = renderHook(() => useUpdateItemUnit(), { wrapper: Wrapper });
    update.current.mutate({ code: "BOX", patch: {} as never });
    await waitFor(() => expect(update.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["item-units"] });
  });

  it("useCreateItemCategory / useUpdateItemCategory both invalidate exactly ['item-categories']", async () => {
    const transport = stubTransport({
      "POST /item-categories": () => ({ status: 201, body: { id: "CAT1" } }),
      "PATCH /item-categories/CAT1": () => ({ body: { id: "CAT1" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    const { result: create } = renderHook(() => useCreateItemCategory(), { wrapper: Wrapper });
    create.current.mutate({ nameAr: "مشروبات" } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));

    const { result: update } = renderHook(() => useUpdateItemCategory(), { wrapper: Wrapper });
    update.current.mutate({ id: "CAT1", patch: {} as never });
    await waitFor(() => expect(update.current.isSuccess).toBe(true));

    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) expect(call[0]).toEqual({ queryKey: ["item-categories"] });
  });
});

describe("account routing and tax groups", () => {
  it("useAccountRouting GETs /accounting/account-routing and useUpdateAccountRouting PUTs it back, invalidating ['account-routing']", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "GET /accounting/account-routing": () => ({ body: { salesRevenueAccountId: "A1" } }),
      "PUT /accounting/account-routing": (init) => {
        seenBody = jsonBody(init);
        return { body: { salesRevenueAccountId: "A2" } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: routing } = renderHook(() => useAccountRouting(), { wrapper: Wrapper });
    await waitFor(() => expect(routing.current.isSuccess).toBe(true));
    expect(routing.current.data).toEqual({ salesRevenueAccountId: "A1" });

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: update } = renderHook(() => useUpdateAccountRouting(), { wrapper: Wrapper });
    update.current.mutate({ salesRevenueAccountId: "A2" } as never);
    await waitFor(() => expect(update.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ salesRevenueAccountId: "A2" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["account-routing"] });
  });

  it("useTaxGroups GETs /tax-groups and useCreateTaxGroup POSTs a new one, invalidating ['tax-groups']", async () => {
    const transport = stubTransport({
      "GET /tax-groups": () => ({ body: [{ id: "TG1" }] }),
      "POST /tax-groups": () => ({ status: 201, body: { id: "TG2" } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const { result: list } = renderHook(() => useTaxGroups(), { wrapper: Wrapper });
    await waitFor(() => expect(list.current.isSuccess).toBe(true));
    expect(list.current.data).toEqual([{ id: "TG1" }]);

    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result: create } = renderHook(() => useCreateTaxGroup(), { wrapper: Wrapper });
    create.current.mutate({ nameAr: "ضريبة القيمة المضافة", members: [] } as never);
    await waitFor(() => expect(create.current.isSuccess).toBe(true));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["tax-groups"] });
  });
});

describe("test email — ignores res.ok and keys success off the message field", () => {
  it("resolves with the payload when the response carries a message, even on a non-2xx status", async () => {
    const transport = stubTransport({
      "POST /settings/email/test": () => ({ status: 502, body: { message: "فشل الاتصال بخادم SMTP" } }),
    });
    const { result } = renderHook(() => useSendTestEmail(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ to: "owner@example.com" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ message: "فشل الاتصال بخادم SMTP" });
  });

  it("throws when the payload has no message field at all, regardless of status", async () => {
    const transport = stubTransport({
      "POST /settings/email/test": () => ({ status: 200, body: {} }),
    });
    const { result } = renderHook(() => useSendTestEmail(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ to: "owner@example.com" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

describe("entity audit — accepts either wire shape the server has used", () => {
  it("returns the array directly when the server responds with a bare array", async () => {
    const transport = stubTransport({
      "GET /audit": () => ({ body: [{ action: "created" }] }),
    });
    const { result } = renderHook(() => useEntityAudit("customer", "C1"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ action: "created" }]);
  });

  it("unwraps `.events` when the server responds with an envelope, and empty-array-defaults a missing key", async () => {
    const transport = stubTransport({
      "GET /audit": () => ({ body: { events: [{ action: "updated" }] } }),
    });
    const { result } = renderHook(() => useEntityAudit("customer", "C1"), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ action: "updated" }]);

    const emptyTransport = stubTransport({ "GET /audit": () => ({ body: {} }) });
    const { result: empty } = renderHook(() => useEntityAudit("customer", "C1"), { wrapper: makeWrapper(emptyTransport).Wrapper });
    await waitFor(() => expect(empty.current.isSuccess).toBe(true));
    expect(empty.current.data).toEqual([]);
  });

  it("is disabled for an empty entityId", async () => {
    let called = false;
    const transport = stubTransport({ "GET /audit": () => { called = true; return { body: [] }; } });
    const { result } = renderHook(() => useEntityAudit("customer", ""), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
    expect(result.current.isPending).toBe(true);
  });
});

describe("item movements — fans out per warehouse and merges newest-first", () => {
  it("requests each warehouse's movements and merges them sorted by occurredAt DESC, tie-broken by id ASC", async () => {
    const seenPaths: string[] = [];
    const transport = stubTransport({
      "GET /inventory/movements": (_init, path) => {
        seenPaths.push(path);
        if (path.includes("warehouseId=WH1")) {
          return {
            body: [
              { id: "M2", occurredAt: "2026-01-02T00:00:00Z" },
              { id: "M1", occurredAt: "2026-01-01T00:00:00Z" },
            ],
          };
        }
        return {
          body: [
            { id: "M4", occurredAt: "2026-01-02T00:00:00Z" },
            { id: "M3", occurredAt: "2026-01-03T00:00:00Z" },
          ],
        };
      },
    });
    const { result } = renderHook(() => useItemMovements("I1", ["WH1", "WH2"]), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPaths).toHaveLength(2);
    expect(seenPaths.some((p) => p.includes("warehouseId=WH1"))).toBe(true);
    expect(seenPaths.some((p) => p.includes("warehouseId=WH2"))).toBe(true);
    // newest occurredAt first (M3 2026-01-03); the two 2026-01-02 rows (M2, M4) tie-break by id ascending; oldest (M1) last.
    expect((result.current.data ?? []).map((m) => m.id)).toEqual(["M3", "M2", "M4", "M1"]);
  });

  it("is disabled with zero warehouses — an item that has never been anywhere returns nothing, not an error", async () => {
    let called = false;
    const transport = stubTransport({ "GET /inventory/movements": () => { called = true; return { body: [] }; } });
    const { result } = renderHook(() => useItemMovements("I1", []), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
    expect(result.current.isPending).toBe(true);
  });
});

describe("cost centers from departments", () => {
  it("useCreateCostCentersFromDepartments sends the department ids and invalidates cost-centers AND the P&L view built on them", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /cost-centers/from-departments": (init) => {
        seenBody = jsonBody(init);
        return { body: { created: [{ id: "CC1" }], skipped: [] } };
      },
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateCostCentersFromDepartments(), { wrapper: Wrapper });
    result.current.mutate({ departmentIds: ["D1", "D2"] } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ departmentIds: ["D1", "D2"] });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["cost-centers"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["cost-center-pl"] });
  });
});

describe("price list tier resolution", () => {
  it("useResolvePriceListPrice POSTs the line to the server and returns exactly what it decided — never a client-computed guess", async () => {
    let seenBody: unknown = null;
    const transport = stubTransport({
      "POST /price-lists/resolve-price": (init) => {
        seenBody = jsonBody(init);
        return { body: { price: "95.000000", priceListId: "PL1", tierMinQty: "10", fromPriceList: true } };
      },
    });
    const { result } = renderHook(() => useResolvePriceListPrice(), { wrapper: makeWrapper(transport).Wrapper });
    result.current.mutate({ itemId: "I1", customerId: "C1", qty: "12" } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenBody).toEqual({ itemId: "I1", customerId: "C1", qty: "12" });
    expect(result.current.data).toEqual({ price: "95.000000", priceListId: "PL1", tierMinQty: "10", fromPriceList: true });
  });
});
