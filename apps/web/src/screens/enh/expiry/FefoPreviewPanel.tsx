import { StatusPill, formatQty } from "@mezan/ui";
import { useFefoPreview } from "../../../data/expiry-hooks";
import { useAppTranslation } from "../../../i18n";
import { majorOf, scaledOf } from "../../../lib/money";

const TH = "border-b border-border bg-surface-2 px-[10px] py-[7px] text-start text-[11px] font-bold uppercase text-ink-muted";
const TH_END = "border-b border-border bg-surface-2 px-[10px] py-[7px] text-end text-[11px] font-bold uppercase text-ink-muted";

export function FefoPreviewPanel({ warehouseId, itemId, qty, title }: { warehouseId: string; itemId: string; qty: number; title?: string }) {
  const { t } = useAppTranslation();
  const preview = useFefoPreview({ warehouseId, itemId, qty });
  if (preview.isError) {
    return <p role="alert" className="text-[12px] text-danger-ink">{preview.error.message}</p>;
  }
  const data = preview.data;
  if (!data) return null;
  if (data.slices.length === 0) {
    return <p className="text-[12px] text-ink-muted">{title ? `${title}: ` : ""}{t("expiry.fefo.noLayers")}</p>;
  }
  const short = scaledOf(data.shortfall) > 0n;
  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-[8px] border-b border-border px-[10px] py-[8px] text-[12px]">
        <span className="font-semibold text-ink">{title ?? t("expiry.fefo.title")}</span>
        <span className="flex flex-wrap gap-[6px]">
          {data.blockedByExpired ? <StatusPill tone="danger" label={t("expiry.fefo.expiredAtHead", { qty: formatQty(majorOf(data.expiredQty)) })} /> : null}
          {short ? <StatusPill tone="warning" label={t("expiry.fefo.shortfall", { qty: formatQty(majorOf(data.shortfall)) })} /> : null}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th scope="col" className={TH}>{t("expiry.lot.batchNo")}</th>
              <th scope="col" className={TH}>{t("expiry.lot.expiryDate")}</th>
              <th scope="col" className={TH_END}>{t("expiry.fefo.available")}</th>
              <th scope="col" className={TH_END}>{t("expiry.fefo.take")}</th>
            </tr>
          </thead>
          <tbody>
            {data.slices.map((slice) => (
              <tr key={slice.layerId} className={`border-b border-border last:border-b-0 ${slice.expired ? "text-danger-ink" : ""}`}>
                <td className="px-[10px] py-[6px]">{slice.batchNo ?? t("expiry.lot.noBatch")}</td>
                <td className="mz-num px-[10px] py-[6px]">
                  {slice.expiryDate ?? "—"}
                  {slice.expired ? ` · ${t("expiry.status.expired")}` : ""}
                </td>
                <td className="mz-num px-[10px] py-[6px] text-end">{formatQty(majorOf(slice.available))}</td>
                <td className="mz-num px-[10px] py-[6px] text-end font-semibold">{scaledOf(slice.take) > 0n ? formatQty(majorOf(slice.take)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
