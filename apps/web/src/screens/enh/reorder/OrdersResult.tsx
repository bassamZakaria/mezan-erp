import { Button, Card, Money, useFormat } from "@mezan/ui";
import type { CreateReorderOrdersResultDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";

export interface OrdersResultProps {
  readonly result: CreateReorderOrdersResultDTO;
  readonly onOpenOrders: () => void;
  readonly onDismiss: () => void;
}

export function OrdersResult({ result, onOpenOrders, onDismiss }: OrdersResultProps) {
  const { t } = useAppTranslation();
  const fmt = useFormat();
  return (
    <Card className="flex flex-col gap-3 p-[14px_16px]" role="status" aria-label={t("reorder.result.title")}>
      {result.created.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="text-[13.5px] font-semibold text-ink">{t("reorder.result.created", { count: result.created.length })}</div>
          <ul className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
            {result.created.map((order) => (
              <li key={order.orderId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="mz-num font-semibold text-ink">{t("reorder.result.order", { number: order.number, supplier: order.supplierName, warehouse: order.warehouseName })}</span>
                <span>{t("reorder.result.lines", { count: order.lineCount })}</span>
                <Money value={order.total} />
                {order.expectedDeliveryDate ? <span>{t("reorder.result.expected", { date: fmt.date(order.expectedDeliveryDate) })}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.needsSupplier.length > 0 ? (
        <div role="alert" className="text-[12.5px] text-warning-ink">
          {t("reorder.result.needsSupplier", { count: result.needsSupplier.length })}
        </div>
      ) : null}
      {result.skipped.length > 0 ? (
        <div className="text-[12.5px] text-ink-muted">
          <div>{t("reorder.result.skipped", { count: result.skipped.length })}</div>
          <ul className="mt-1 list-disc ps-5">
            {result.skipped.map((line) => (
              <li key={`${line.itemId}:${line.warehouseId}`}>{t(`reorder.result.skipReason.${line.reason}` as AppTranslationKey)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex gap-2">
        {result.created.length > 0 ? (
          <Button size="sm" onClick={onOpenOrders}>
            {t("reorder.result.open")}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t("reorder.result.dismiss")}
        </Button>
      </div>
    </Card>
  );
}
