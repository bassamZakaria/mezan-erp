import { Button } from "@mezan/ui";
import { useAppTranslation } from "../i18n";

export interface ReversibleVoucher {
  readonly reversesDocId?: string | null;
  readonly reversedByDocId?: string | null;
}

export function VoucherReversalNotice({ document, onOpen }: { document: ReversibleVoucher; onOpen: (voucherId: string) => void }) {
  const { t } = useAppTranslation();
  const reversedBy = document.reversedByDocId ?? null;
  const reverses = document.reversesDocId ?? null;
  const linked = reversedBy ?? reverses;
  if (!linked) return null;
  return (
    <p role="note" className="flex flex-wrap items-center gap-[10px] rounded-md border border-border bg-surface-2 px-[12px] py-[10px] text-[12.5px] text-ink">
      <span>{reversedBy ? t("vouchers.reversedByNotice") : t("vouchers.reversesNotice")}</span>
      <Button size="sm" onClick={() => onOpen(linked)}>
        {reversedBy ? t("vouchers.openReversingVoucher") : t("vouchers.openReversedVoucher")}
      </Button>
    </p>
  );
}
