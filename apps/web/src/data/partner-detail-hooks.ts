import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AgingCustomersRow, AgingSuppliersRow } from "@mezan/domain";
import type { StockBalanceRowDTO, VoucherAllocationDTO } from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { ApiError } from "./hooks";
import { useReport, type ReportResult } from "./reports-hooks";
import { useAppTranslation } from "../i18n";

/**
 * Data hooks for the customer / supplier / branch **detail** tabs — the
 * per-partner and per-branch reads that the master-record hooks in
 * `data/hooks.ts` don't cover. Everything here goes through the same
 * `useApi().request` transport (session permission headers merged in), so
 * every figure a detail tab renders comes off the live API.
 */

/* ------------------------------------------------------------------ */
/* Scaled-decimal money arithmetic                                     */
/* ------------------------------------------------------------------ */

/** The wire's money scale — DTO amounts cross as fixed 6-dp decimal strings ("13953.600000"). */
const MONEY_SCALE = 6;
const MONEY_SCALE_FACTOR = 10n ** BigInt(MONEY_SCALE);

/**
 * Parses a wire money string into a scaled integer. Statement running
 * balances are summed as `bigint` and only turned into a `number` at the
 * render boundary — a float is never used as an accumulator.
 */
export function parseMoney(value: string | null | undefined): bigint {
  if (!value) return 0n;
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const padded = (fraction + "0".repeat(MONEY_SCALE)).slice(0, MONEY_SCALE);
  const scaled = BigInt(whole || "0") * MONEY_SCALE_FACTOR + BigInt(padded || "0");
  return negative ? -scaled : scaled;
}

/** Converts a report endpoint's already-computed `number` total into the same scaled integer space. */
export function moneyFromNumber(value: number): bigint {
  return BigInt(Math.round(value * Number(MONEY_SCALE_FACTOR)));
}

/** Render boundary only: turns a scaled integer back into the `number` the `<Money>` atom takes. */
export function moneyToNumber(scaled: bigint): number {
  return Number(scaled) / Number(MONEY_SCALE_FACTOR);
}

export function sumMoney(values: readonly string[]): bigint {
  return values.reduce<bigint>((total, value) => total + parseMoney(value), 0n);
}

/** Multiplies two wire decimals (qty × unit price) without ever leaving scaled-integer space. */
export function multiplyMoney(a: string | null | undefined, b: string | null | undefined): bigint {
  return (parseMoney(a) * parseMoney(b)) / MONEY_SCALE_FACTOR;
}

/** Tolerance for reconciling a computed running balance against a report total — one piastre. */
export const MONEY_RECONCILIATION_TOLERANCE = MONEY_SCALE_FACTOR / 100n;

/* ------------------------------------------------------------------ */
/* Partner aging                                                        */
/* ------------------------------------------------------------------ */

export interface AgingBuckets {
  readonly current: number;
  readonly d31to60: number;
  readonly d61to90: number;
  readonly d91to120: number;
  readonly over120: number;
  readonly total: number;
}

/**
 * أعمار ديون العملاء scoped to one customer — the AR aging ladder the
 * `/reports/aging/customers` report already computes per customer from every
 * live invoice's `grandTotal − amountPaid`.
 */
export function useCustomerAging(): UseQueryResult<ReportResult<AgingCustomersRow>, ApiError> {
  return useReport<AgingCustomersRow>("aging.customers", "/aging/customers", {});
}

/**
 * أعمار فواتير الموردين — `/reports/aging/suppliers`. NOTE the domain's own
 * caveat (packages/domain/src/reports/aging-suppliers.ts): purchase invoices
 * carry no payment tracking, so every confirmed invoice's FULL total is
 * bucketed. These figures are gross invoice age, not a net payable.
 */
export function useSupplierAging(): UseQueryResult<ReportResult<AgingSuppliersRow>, ApiError> {
  return useReport<AgingSuppliersRow>("aging.suppliers", "/aging/suppliers", {});
}

export function agingBucketsFor(row: AgingCustomersRow | AgingSuppliersRow | undefined): AgingBuckets {
  return {
    current: row?.current ?? 0,
    d31to60: row?.d31to60 ?? 0,
    d61to90: row?.d61to90 ?? 0,
    d91to120: row?.d91to120 ?? 0,
    over120: row?.over120 ?? 0,
    total: row?.total ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Voucher allocations                                                  */
/* ------------------------------------------------------------------ */

/**
 * The allocation sub-ledger rows of a set of vouchers — `GET
 * /vouchers/:id/allocations` fanned out over `voucherIds` and flattened. This
 * is what turns a partner statement's settlements into DATED movements: an
 * allocation carries the invoice it was applied to, and its voucher carries the
 * date and the GL posting.
 */
export function useVoucherAllocations(voucherIds: readonly string[]): UseQueryResult<VoucherAllocationDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const ids = [...voucherIds].sort();
  return useQuery<VoucherAllocationDTO[], ApiError>({
    queryKey: ["voucher-allocations", ids],
    enabled: session !== null && ids.length > 0,
    queryFn: async () => {
      const perVoucher = await Promise.all(
        ids.map(async (voucherId) => {
          const res = await request(`/vouchers/${encodeURIComponent(voucherId)}/allocations`);
          if (!res.ok) throw new ApiError(res.status, t("partnerApi.theVoucherAllocationsCouldNot"));
          const body = await res.json<{ allocations: VoucherAllocationDTO[] }>();
          return body.allocations;
        }),
      );
      return perVoucher.flat();
    },
  });
}

/** Sums the ACTIVE allocations of one voucher — a reversed allocation moves no money. */
export function sumActiveAllocations(allocations: readonly VoucherAllocationDTO[]): bigint {
  return allocations.reduce<bigint>((total, alloc) => (alloc.status === "active" ? total + parseMoney(alloc.amount) : total), 0n);
}

/* ------------------------------------------------------------------ */
/* Branch detail                                                        */
/* ------------------------------------------------------------------ */

/**
 * Stock on hand for a whole branch. `/inventory/stock-balance` only narrows by
 * ONE `warehouseId`, so the branch rollup is the per-warehouse balances of
 * every warehouse in the branch, merged by item (qty and value added as
 * scaled integers, average cost re-derived from the merged totals).
 */
export function useBranchStockBalance(warehouseIds: readonly string[]): UseQueryResult<StockBalanceRowDTO[], ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  const ids = [...warehouseIds].sort();
  return useQuery<StockBalanceRowDTO[], ApiError>({
    queryKey: ["stock-balance", "branch", ids],
    enabled: session !== null && ids.length > 0,
    queryFn: async () => {
      const perWarehouse = await Promise.all(
        ids.map(async (warehouseId) => {
          const res = await request(`/inventory/stock-balance?warehouseId=${encodeURIComponent(warehouseId)}`);
          if (!res.ok) throw new ApiError(res.status, t("api.theStockBalanceCouldNot"));
          const body = await res.json<{ rows: StockBalanceRowDTO[] }>();
          return body.rows;
        }),
      );

      const merged = new Map<string, { onHand: bigint; totalValue: bigint; warehouseCount: number }>();
      for (const rows of perWarehouse) {
        for (const row of rows) {
          const existing = merged.get(row.itemId) ?? { onHand: 0n, totalValue: 0n, warehouseCount: 0 };
          merged.set(row.itemId, {
            onHand: existing.onHand + parseMoney(row.onHand),
            totalValue: existing.totalValue + parseMoney(row.totalValue),
            warehouseCount: existing.warehouseCount + row.warehouseCount,
          });
        }
      }

      return [...merged.entries()].map(([itemId, agg]) => ({
        itemId,
        onHand: formatScaled(agg.onHand),
        totalValue: formatScaled(agg.totalValue),
        averageCost: agg.onHand === 0n ? formatScaled(0n) : formatScaled((agg.totalValue * MONEY_SCALE_FACTOR) / agg.onHand),
        warehouseCount: agg.warehouseCount,
      }));
    },
  });
}

/** Renders a scaled integer back into the wire's fixed 6-dp decimal string. */
function formatScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / MONEY_SCALE_FACTOR;
  const fraction = (abs % MONEY_SCALE_FACTOR).toString().padStart(MONEY_SCALE, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
