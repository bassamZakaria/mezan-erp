import { TextInput } from "@mezan/ui";
import { TextField } from "../../../settings/form-controls";
import { useAppTranslation } from "../../../i18n";

export interface LotTracking {
  readonly trackBatches?: boolean;
  readonly trackExpiry?: boolean;
}

export interface LotValue {
  readonly batchNo: string;
  readonly expiryDate: string;
}

export const EMPTY_LOT: LotValue = { batchNo: "", expiryDate: "" };

export function tracksLots(item: LotTracking | undefined | null): boolean {
  return Boolean(item?.trackBatches || item?.trackExpiry);
}

export function lotIsComplete(item: LotTracking | undefined | null, lot: LotValue): boolean {
  if (item?.trackBatches && lot.batchNo.trim() === "") return false;
  if (item?.trackExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(lot.expiryDate)) return false;
  return true;
}

export function lotPayload(lot: LotValue): { batchNo: string | null; expiryDate: string | null } {
  const batchNo = lot.batchNo.trim();
  return { batchNo: batchNo === "" ? null : batchNo, expiryDate: lot.expiryDate === "" ? null : lot.expiryDate };
}

export function LotFields({ item, value, onChange }: { item: LotTracking | undefined | null; value: LotValue; onChange: (next: LotValue) => void }) {
  const { t } = useAppTranslation();
  if (!tracksLots(item)) return null;
  return (
    <div className="mt-[10px] grid grid-cols-2 gap-[8px]">
      {item?.trackBatches ? (
        <TextField label={t("expiry.lot.batchNo")} value={value.batchNo} onChange={(batchNo) => onChange({ ...value, batchNo })} />
      ) : null}
      {item?.trackExpiry ? (
        <TextField
          label={t("expiry.lot.expiryDate")}
          type="date"
          value={value.expiryDate}
          onChange={(expiryDate) => onChange({ ...value, expiryDate })}
          placeholder="YYYY-MM-DD"
        />
      ) : null}
    </div>
  );
}

export function LotCells({
  item,
  value,
  onChange,
  disabled,
  lineNumber,
}: {
  item: LotTracking | undefined | null;
  value: LotValue;
  onChange: (next: LotValue) => void;
  disabled?: boolean;
  lineNumber: number;
}) {
  const { t } = useAppTranslation();
  return (
    <>
      <td className="px-[12px] py-[8px]">
        {item?.trackBatches && !disabled ? (
          <TextInput
            size="sm"
            className="w-[120px]"
            aria-label={t("expiry.lot.lineBatchNo", { number: lineNumber })}
            value={value.batchNo}
            onChange={(e) => onChange({ ...value, batchNo: e.target.value })}
          />
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </td>
      <td className="px-[12px] py-[8px]">
        {item?.trackExpiry && !disabled ? (
          <TextInput
            size="sm"
            type="date"
            className="w-[140px]"
            aria-label={t("expiry.lot.lineExpiryDate", { number: lineNumber })}
            value={value.expiryDate}
            onChange={(e) => onChange({ ...value, expiryDate: e.target.value })}
          />
        ) : (
          <span className="text-ink-muted">—</span>
        )}
      </td>
    </>
  );
}
