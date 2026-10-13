import { DocumentStatusCode } from "@mezan/domain";
import { useFormat } from "@mezan/ui";
import { useAppTranslation } from "../i18n";

export interface IntendedAllocation {
  readonly allocationId: string;
  readonly invoiceId: string;
  readonly amount: string | null;
}

const NOT_YET_POSTED: ReadonlySet<string> = new Set([DocumentStatusCode.Draft, DocumentStatusCode.Pending]);

export function IntendedAllocationsNote({
  voucher,
  invoices,
}: {
  readonly voucher: { readonly status: string; readonly heldAllocations?: readonly IntendedAllocation[] };
  readonly invoices: readonly { readonly id: string; readonly invoiceNo: string }[];
}) {
  const { t } = useAppTranslation();
  const format = useFormat();
  const intended = voucher.heldAllocations ?? [];
  if (intended.length === 0 || !NOT_YET_POSTED.has(voucher.status)) return null;
  const numberOf = (invoiceId: string) => invoices.find((invoice) => invoice.id === invoiceId)?.invoiceNo ?? invoiceId;
  return (
    <div role="note" className="mb-[12px] rounded-md border border-info bg-info-soft px-[14px] py-[10px] text-start text-[12.5px] text-info-ink">
      <span className="font-semibold">{t("vouchers.intendedAllocations")}</span>
      <ul className="mt-[4px] flex flex-col gap-[2px]">
        {intended.map((allocation) => (
          <li key={allocation.allocationId}>
            <span className="mz-lat">{numberOf(allocation.invoiceId)}</span>
            {" — "}
            {allocation.amount === null ? t("vouchers.intendedAllocations.remainder") : <span className="mz-num">{format.money(allocation.amount)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
