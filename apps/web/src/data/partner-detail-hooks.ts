import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ScreenRequest, type AgingCustomersRow, type AgingSuppliersRow } from "@mezan/domain";
import type { PartyStatementDTO, StockBalanceRowDTO, VoucherAllocationDTO, StockBalanceWarehouseRowDTO } from "@mezan/contracts";
import { useApi } from "./ApiContext";
import { ApiError, readError, useMayAskScreen } from "./hooks";
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

/** Exact decimal strings, as `/reports/aging/*` sends them (D345). */
export interface AgingBuckets {
  readonly current: string;
  readonly d31to60: string;
  readonly d61to90: string;
  readonly d91to120: string;
  readonly over120: string;
  readonly total: string;
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
  const enabled = useMayAskScreen(ScreenRequest.SupplierAging);
  return useReport<AgingSuppliersRow>("aging.suppliers", "/aging/suppliers", {}, { enabled });
}

const ZERO_MONEY = "0.000000";

export function agingBucketsFor(row: AgingCustomersRow | AgingSuppliersRow | undefined): AgingBuckets {
  return {
    current: row?.current ?? ZERO_MONEY,
    d31to60: row?.d31to60 ?? ZERO_MONEY,
    d61to90: row?.d61to90 ?? ZERO_MONEY,
    d91to120: row?.d91to120 ?? ZERO_MONEY,
    over120: row?.over120 ?? ZERO_MONEY,
    total: row?.total ?? ZERO_MONEY,
  };
}

/* ------------------------------------------------------------------ */
/* Party statement                                                      */
/* ------------------------------------------------------------------ */

/**
 * كشف حساب العميل / المورد, built on the server from the aging ladder's own
 * terms in base currency, so it closes on the party's aging row (D200–D205).
 */
export function usePartyStatement(kind: "customer" | "supplier", partyId: string): UseQueryResult<PartyStatementDTO, ApiError> {
  const { t } = useAppTranslation();
  const { request, session } = useApi();
  return useQuery<PartyStatementDTO, ApiError>({
    queryKey: ["party-statement", kind, partyId],
    enabled: session !== null && partyId !== "",
    queryFn: async () => {
      const res = await request(`/reports/statements/${kind === "customer" ? "customers" : "suppliers"}/${encodeURIComponent(partyId)}`);
      if (!res.ok) {
        const fallback = kind === "customer" ? t("customers.statement.loadFailed") : t("suppliers.statement.loadFailed");
        throw new ApiError(res.status, await readError(res, fallback, t));
      }
      return res.json<PartyStatementDTO>();
    },
  });
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
          if (!res.ok) throw new ApiError(res.status, await readError(res, t("partnerApi.theVoucherAllocationsCouldNot"), t));
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
          if (!res.ok) throw new ApiError(res.status, await readError(res, t("api.theStockBalanceCouldNot"), t));
          const body = await res.json<{ rows: StockBalanceRowDTO[] }>();
          return body.rows;
        }),
      );

      const merged = new Map<
        string,
        { onHand: bigint; totalValue: bigint; reserved: bigint; warehouseCount: number; warehouses: StockBalanceWarehouseRowDTO[] }
      >();
      for (const rows of perWarehouse) {
        for (const row of rows) {
          const existing =
            merged.get(row.itemId) ?? { onHand: 0n, totalValue: 0n, reserved: 0n, warehouseCount: 0, warehouses: [] };
          merged.set(row.itemId, {
            onHand: existing.onHand + parseMoney(row.onHand),
            totalValue: existing.totalValue + parseMoney(row.totalValue),
            // Each per-warehouse call reports the item's reservation for that
            // warehouse only, so these add rather than double-count.
            reserved: existing.reserved + parseMoney(row.reserved),
            warehouseCount: existing.warehouseCount + row.warehouseCount,
            warehouses: [...existing.warehouses, ...row.warehouses],
          });
        }
      }

      return [...merged.entries()].map(([itemId, agg]) => ({
        itemId,
        onHand: formatScaled(agg.onHand),
        totalValue: formatScaled(agg.totalValue),
        averageCost: agg.onHand === 0n ? formatScaled(0n) : formatScaled((agg.totalValue * MONEY_SCALE_FACTOR) / agg.onHand),
        warehouseCount: agg.warehouseCount,
        reserved: formatScaled(agg.reserved),
        available: formatScaled(agg.onHand - agg.reserved > 0n ? agg.onHand - agg.reserved : 0n),
        warehouses: agg.warehouses,
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
