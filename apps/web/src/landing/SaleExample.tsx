import { useId, useState, type ReactNode } from "react";
import { Checkbox, Money, TextInput } from "@mezan/ui";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { LedgerTable } from "./LedgerTable";
import { piastresToDecimal, postSale } from "./ledger-math";

const START_STOCK = 400;

interface StepperProps {
  readonly label: AppTranslationKey;
  readonly value: number;
  readonly step: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}

function Stepper({ label, value, step, min, max, onChange }: StepperProps) {
  const { t } = useAppTranslation();
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const name = t(label);
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next)));
  function commit(raw: string) {
    setDraft(null);
    const parsed = Number(raw);
    if (raw.trim() !== "" && Number.isFinite(parsed)) onChange(clamp(parsed));
  }
  return (
    <div>
      <label htmlFor={id} className="mb-[6px] block text-xs font-semibold text-ink-muted">
        {name}
      </label>
      <div className="flex items-stretch overflow-hidden rounded-md border border-border-strong bg-surface">
        <button
          type="button"
          aria-label={t("landing.example.decrease", { field: name })}
          onClick={() => onChange(clamp(value - step))}
          disabled={value <= min}
          className="min-h-[44px] w-[44px] flex-none text-lg font-bold text-ink hover:bg-surface-2 disabled:text-ink-faint"
        >
          −
        </button>
        <TextInput
          id={id}
          type="number"
          inputMode="numeric"
          numeric
          min={min}
          max={max}
          step={step}
          value={draft ?? String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const parsed = Number(raw);
            if (raw.trim() !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= max) onChange(Math.round(parsed));
          }}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value);
          }}
          className="min-h-[44px] w-full min-w-0 rounded-none border-0 border-x border-border bg-transparent text-center text-[15px]"
        />
        <button
          type="button"
          aria-label={t("landing.example.increase", { field: name })}
          onClick={() => onChange(clamp(value + step))}
          disabled={value >= max}
          className="min-h-[44px] w-[44px] flex-none text-lg font-bold text-ink hover:bg-surface-2 disabled:text-ink-faint"
        >
          +
        </button>
      </div>
    </div>
  );
}

function Figure({ label, live = false, children }: { label: AppTranslationKey; live?: boolean; children: ReactNode }) {
  const { t } = useAppTranslation();
  return (
    <div className="rounded-md bg-surface-2 px-[14px] py-[12px]">
      <dt className="text-xs text-ink-muted">{t(label)}</dt>
      <dd className="mt-[2px] font-display text-lg font-bold text-ink" aria-live={live ? "polite" : undefined}>
        {children}
      </dd>
    </div>
  );
}

export function SaleExample() {
  const { t } = useAppTranslation();
  const [quantity, setQuantity] = useState(120);
  const [price, setPrice] = useState(310);
  const [cost, setCost] = useState(255);
  const [withVat, setWithVat] = useState(true);
  const sale = postSale({ quantity, unitPricePiastres: price * 100, unitCostPiastres: cost * 100, withVat });

  return (
    <div className="grid gap-[20px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="flex flex-col gap-[14px] rounded-lg bg-surface p-[18px] shadow-1">
        <Stepper label="landing.example.qty" value={quantity} step={10} min={1} max={START_STOCK} onChange={setQuantity} />
        <Stepper label="landing.example.price" value={price} step={5} min={1} max={100_000} onChange={setPrice} />
        <Stepper label="landing.example.cost" value={cost} step={5} min={1} max={100_000} onChange={setCost} />
        <Checkbox
          className="min-h-[44px] items-center text-[13px] font-semibold text-ink"
          checked={withVat}
          onChange={(event) => setWithVat(event.target.checked)}
          label={t("landing.example.vat")}
        />
      </div>

      <div className="flex flex-col gap-[14px]">
        <dl className="grid grid-cols-2 gap-[10px] sm:grid-cols-4">
          <Figure label="landing.example.invoiceTotal" live>
            <Money value={piastresToDecimal(sale.totalPiastres)} />
          </Figure>
          <Figure label="landing.example.customerOwes">
            <Money value={piastresToDecimal(sale.totalPiastres)} />
          </Figure>
          <Figure label="landing.example.profit">
            <Money value={piastresToDecimal(sale.netPiastres - sale.costPiastres)} />
          </Figure>
          <Figure label="landing.example.stockLeft">
            <span className="text-base">{t("landing.example.stockUnit", { count: START_STOCK - quantity, start: START_STOCK })}</span>
          </Figure>
        </dl>
        <div className="rounded-lg bg-surface p-[18px] shadow-1">
          <p className="mb-[4px] text-xs font-semibold text-ink-muted">{t("landing.ledger.entry")}</p>
          <LedgerTable lines={sale.lines} />
        </div>
        <p className="text-xs text-ink-muted">{t("landing.example.note")}</p>
      </div>
    </div>
  );
}
