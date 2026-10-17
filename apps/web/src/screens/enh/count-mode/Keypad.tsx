import { Delete } from "lucide-react";
import { useAppTranslation } from "../../../i18n";

const DIGIT_ROWS: readonly (readonly string[])[] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
];

const KEY_CLASS =
  "mz-num flex min-h-[56px] items-center justify-center rounded-md border border-border-strong bg-surface text-[22px] font-semibold text-ink transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:cursor-not-allowed disabled:text-ink-faint";

const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

export function Keypad({ disabled, onDigit, onBackspace, onClear }: { disabled?: boolean; onDigit: (key: string) => void; onBackspace: () => void; onClear: () => void }) {
  const { t } = useAppTranslation();
  return (
    <div role="group" aria-label={t("countMode.keypad")} dir="ltr" className="grid grid-cols-3 gap-[8px]">
      {DIGIT_ROWS.flat().map((key) => (
        <button key={key} type="button" className={KEY_CLASS} disabled={disabled} onMouseDown={keepFocus} onClick={() => onDigit(key)}>
          {key}
        </button>
      ))}
      <button type="button" className={KEY_CLASS} disabled={disabled} onMouseDown={keepFocus} onClick={() => onDigit(".")} aria-label={t("countMode.keypadPoint")}>
        .
      </button>
      <button type="button" className={KEY_CLASS} disabled={disabled} onMouseDown={keepFocus} onClick={() => onDigit("0")}>
        0
      </button>
      <button type="button" className={KEY_CLASS} disabled={disabled} onMouseDown={keepFocus} onClick={onBackspace} onDoubleClick={onClear} aria-label={t("countMode.keypadBackspace")}>
        <Delete aria-hidden className="h-[22px] w-[22px]" />
      </button>
    </div>
  );
}
