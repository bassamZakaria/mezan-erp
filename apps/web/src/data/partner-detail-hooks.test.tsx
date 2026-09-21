// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppI18nProvider } from "../i18n";
import { ApiProvider } from "./ApiContext";
import { createQueryClient } from "./queryClient";
import { stubTransport, testAdminSession } from "./test-support";
import type { Transport } from "./transport";
import {
  agingBucketsFor,
  moneyFromNumber,
  moneyToNumber,
  MONEY_RECONCILIATION_TOLERANCE,
  multiplyMoney,
  parseMoney,
  sumActiveAllocations,
  sumMoney,
  useBranchStockBalance,
  useCustomerAging,
  useSupplierAging,
  useVoucherAllocations,
} from "./partner-detail-hooks";
import { ApiError } from "./hooks";

function makeWrapper(transport: Transport, session = testAdminSession) {
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

describe("scaled-decimal money arithmetic", () => {
  it("parseMoney converts a wire decimal string to a scaled bigint at 6dp", () => {
    expect(parseMoney("13953.60")).toBe(13953_600000n);
    expect(parseMoney("0.000001")).toBe(1n);
    expect(parseMoney(null)).toBe(0n);
    expect(parseMoney(undefined)).toBe(0n);
    expect(parseMoney("")).toBe(0n);
  });

  it("parseMoney preserves the sign on a negative amount", () => {
    expect(parseMoney("-500.25")).toBe(-500_250000n);
  });

  it("parseMoney pads a short fractional part and truncates a long one to 6dp", () => {
    expect(parseMoney("10.5")).toBe(10_500000n);
    expect(parseMoney("10.1234567")).toBe(10_123456n);
  });

  it("moneyFromNumber / moneyToNumber round-trip a plain JS number through scaled space", () => {
    const scaled = moneyFromNumber(1234.56);
    expect(scaled).toBe(1234_560000n);
    expect(moneyToNumber(scaled)).toBeCloseTo(1234.56, 6);
  });

  it("sumMoney adds a list of wire strings without floating-point drift", () => {
    expect(sumMoney(["0.1", "0.2"])).toBe(300000n);
    expect(sumMoney([])).toBe(0n);
  });

  it("multiplyMoney multiplies two wire decimals and stays in scaled-integer space (qty × unitPrice)", () => {
    // 3 × 10.50 = 31.50
    expect(multiplyMoney("3", "10.50")).toBe(31_500000n);
  });

  it("MONEY_RECONCILIATION_TOLERANCE is exactly one piastre (0.01)", () => {
    expect(MONEY_RECONCILIATION_TOLERANCE).toBe(10000n);
  });
});

describe("agingBucketsFor", () => {
  it("returns the row's buckets when present", () => {
    const row = { current: "100.000000", d31to60: "50.000000", d61to90: "20.000000", d91to120: "10.000000", over120: "5.000000", total: "185.000000" } as never;
    expect(agingBucketsFor(row)).toEqual({ current: "100.000000", d31to60: "50.000000", d61to90: "20.000000", d91to120: "10.000000", over120: "5.000000", total: "185.000000" });
  });

  it("defaults every bucket to an exact zero when the row is undefined", () => {
    const zero = "0.000000";
    expect(agingBucketsFor(undefined)).toEqual({ current: zero, d31to60: zero, d61to90: zero, d91to120: zero, over120: zero, total: zero });
  });
});

describe("sumActiveAllocations", () => {
  it("sums only allocations with status 'active', skipping reversed ones", () => {
    const allocations = [
      { amount: "100.00", status: "active" } as never,
      { amount: "50.00", status: "reversed" } as never,
      { amount: "25.00", status: "active" } as never,
    ];
    expect(sumActiveAllocations(allocations)).toBe(125_000000n);
  });

  it("returns 0 for an empty list", () => {
    expect(sumActiveAllocations([])).toBe(0n);
  });
});

describe("useCustomerAging / useSupplierAging", () => {
  it("useCustomerAging hits /reports/aging/customers via useReport", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /reports/aging/customers": (_init, path) => {
        seenPath = path;
        return { body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    const { result } = renderHook(() => useCustomerAging(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/reports/aging/customers");
  });

  it("useSupplierAging hits /reports/aging/suppliers", async () => {
    let seenPath = "";
    const transport = stubTransport({
      "GET /reports/aging/suppliers": (_init, path) => {
        seenPath = path;
        return { body: { rows: [], groups: [], grandTotals: {}, reconciliation: null } };
      },
    });
    const { result } = renderHook(() => useSupplierAging(), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenPath).toBe("/reports/aging/suppliers");
  });
});

describe("useVoucherAllocations", () => {
  it("fans out one request per voucher id and flattens the results", async () => {
    const seen: string[] = [];
    const transport = stubTransport({
      "GET /vouchers/V1/allocations": (_init, path) => {
        seen.push(path);
        return { body: { allocations: [{ id: "AL-1", amount: "100.00", status: "active" }] } };
      },
      "GET /vouchers/V2/allocations": (_init, path) => {
        seen.push(path);
        return { body: { allocations: [{ id: "AL-2", amount: "50.00", status: "active" }] } };
      },
    });
    const { result } = renderHook(() => useVoucherAllocations(["V2", "V1"]), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((a) => a.id).sort()).toEqual(["AL-1", "AL-2"]);
    expect(seen.sort()).toEqual(["/vouchers/V1/allocations", "/vouchers/V2/allocations"]);
  });

  it("is disabled (no request) for an empty voucherIds list", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /vouchers/*/allocations": () => {
        called = true;
        return { body: { allocations: [] } };
      },
    });
    const { result } = renderHook(() => useVoucherAllocations([]), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
    expect(result.current.isPending).toBe(true);
  });

  it("sorts voucher ids so the same set in a different order shares one cache entry", async () => {
    const transport = stubTransport({
      "GET /vouchers/*/allocations": () => ({ body: { allocations: [] } }),
    });
    const { Wrapper, queryClient } = makeWrapper(transport);
    renderHook(() => useVoucherAllocations(["V2", "V1"]), { wrapper: Wrapper });
    await waitFor(() => expect(queryClient.getQueryData(["voucher-allocations", ["V1", "V2"]])).toBeDefined());
  });

  it("surfaces a failure from any one of the fanned-out requests as an ApiError", async () => {
    const transport = stubTransport({
      "GET /vouchers/V1/allocations": () => ({ status: 500, body: {} }),
    });
    const { result } = renderHook(() => useVoucherAllocations(["V1"]), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
  });
});

describe("useBranchStockBalance", () => {
  it("merges per-warehouse rows by item, summing onHand/totalValue/reserved and re-deriving averageCost", async () => {
    const transport = stubTransport({
      "GET /inventory/stock-balance": (_init, path) => {
        if (path.includes("WH-1")) {
          return {
            body: {
              rows: [
                { itemId: "I1", onHand: "10.000000", totalValue: "100.000000", reserved: "2.000000", warehouseCount: 1, warehouses: [{ warehouseId: "WH-1" }] },
              ],
            },
          };
        }
        return {
          body: {
            rows: [
              { itemId: "I1", onHand: "5.000000", totalValue: "60.000000", reserved: "1.000000", warehouseCount: 1, warehouses: [{ warehouseId: "WH-2" }] },
            ],
          },
        };
      },
    });
    const { result } = renderHook(() => useBranchStockBalance(["WH-2", "WH-1"]), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const row = result.current.data?.find((r) => r.itemId === "I1");
    expect(row?.onHand).toBe("15.000000");
    expect(row?.totalValue).toBe("160.000000");
    expect(row?.reserved).toBe("3.000000");
    // averageCost = totalValue / onHand = 160 / 15 = 10.666666...
    expect(row?.averageCost).toBe("10.666666");
    expect(row?.available).toBe("12.000000");
    expect(row?.warehouseCount).toBe(2);
    expect(row?.warehouses.length).toBe(2);
  });

  it("floors available at zero when reserved exceeds on-hand rather than going negative", async () => {
    const transport = stubTransport({
      "GET /inventory/stock-balance": () => ({
        body: { rows: [{ itemId: "I1", onHand: "1.000000", totalValue: "10.000000", reserved: "5.000000", warehouseCount: 1, warehouses: [] }] },
      }),
    });
    const { result } = renderHook(() => useBranchStockBalance(["WH-1"]), { wrapper: makeWrapper(transport).Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.available).toBe("0.000000");
  });

  it("is disabled for an empty warehouseIds list", async () => {
    let called = false;
    const transport = stubTransport({
      "GET /inventory/stock-balance": () => {
        called = true;
        return { body: { rows: [] } };
      },
    });
    const { result } = renderHook(() => useBranchStockBalance([]), { wrapper: makeWrapper(transport).Wrapper });
    await new Promise((r) => setTimeout(r, 10));
    expect(called).toBe(false);
    expect(result.current.isPending).toBe(true);
  });
});
