import { QuotaKind, type SalesInvoiceRepository } from "@mezan/domain";
import type { QuotaEnforcement } from "./plan-quota.js";

/** The last day of `YYYY-MM`, so a month's window never depends on the local clock. */
function lastDayOfMonth(month: string): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(year, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * Counts what the tenant has already RECORDED this month, from the invoice
 * table itself — the number is never anything the client sent, and a voided or
 * returned invoice still counts, because the quota is on raising documents,
 * not on the ones that survived.
 */
export function createSalesInvoiceQuota(
  repo: SalesInvoiceRepository,
  serializeWrite: <T>(fn: () => Promise<T>) => Promise<T>,
): QuotaEnforcement {
  return {
    async countInMonth(kind, month) {
      if (kind !== QuotaKind.SalesInvoicesPerMonth) return 0;
      return repo.count({ fromDate: `${month}-01`, toDate: lastDayOfMonth(month) });
    },
    serializeWrite,
  };
}
