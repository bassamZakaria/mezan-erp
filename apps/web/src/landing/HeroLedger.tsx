import { useState, type CSSProperties } from "react";
import { Money } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import { LedgerTable } from "./LedgerTable";
import { piastresToDecimal, postSale } from "./ledger-math";

const HERO_SALE = postSale({ quantity: 120, unitPricePiastres: 31_000, unitCostPiastres: 25_500, withVat: true });

function BalanceScale() {
  return (
    <div className="flex justify-center">
      <svg viewBox="0 0 240 150" aria-hidden="true" className="h-auto w-full max-w-[260px] text-brand">
        <line x1="120" y1="34" x2="120" y2="132" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <path d="M86 140h68" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <g className="mz-landing-beam">
          <line x1="34" y1="34" x2="206" y2="34" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          <g className="mz-landing-pan-a">
            <line x1="34" y1="34" x2="18" y2="78" stroke="currentColor" strokeWidth="1.6" />
            <line x1="34" y1="34" x2="50" y2="78" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10 78h48a24 12 0 0 1-48 0Z" fill="var(--brand-soft)" stroke="currentColor" strokeWidth="2" />
          </g>
          <g className="mz-landing-pan-b">
            <line x1="206" y1="34" x2="190" y2="78" stroke="currentColor" strokeWidth="1.6" />
            <line x1="206" y1="34" x2="222" y2="78" stroke="currentColor" strokeWidth="1.6" />
            <path d="M182 78h48a24 12 0 0 1-48 0Z" fill="var(--accent-soft)" stroke="currentColor" strokeWidth="2" />
          </g>
        </g>
        <circle cx="120" cy="34" r="6" fill="var(--accent-bright)" />
      </svg>
    </div>
  );
}

export function HeroLedger() {
  const { t } = useAppTranslation();
  const [run, setRun] = useState(0);
  const settle = { "--settle": `${HERO_SALE.lines.length * 260 + 650}ms` } as CSSProperties;

  return (
    <div key={run} className="relative rounded-lg bg-surface p-[18px] shadow-2 sm:p-[24px]" style={settle}>
      <div className="flex flex-wrap items-baseline justify-between gap-[8px] border-b border-border pb-[12px]">
        <div>
          <p className="text-xs text-ink-muted">{t("landing.ledger.caption")}</p>
          <p className="font-display text-lg font-bold text-ink">{t("landing.ledger.invoice")}</p>
          <p className="text-[13px] text-ink-muted">
            {t("landing.ledger.customer")} · {t("landing.ledger.item")}
          </p>
          <p className="text-[13px] text-ink-muted">{t("landing.ledger.people")}</p>
        </div>
        <Money value={piastresToDecimal(HERO_SALE.totalPiastres)} className="font-display text-xl font-bold text-ink" />
      </div>

      <div className="mt-[14px] grid items-center gap-[14px] md:grid-cols-[1fr_200px]">
        <div>
          <p className="mb-[4px] text-xs font-semibold text-ink-muted">{t("landing.ledger.entry")}</p>
          <LedgerTable lines={HERO_SALE.lines} animated />
        </div>
        <div className="hidden md:block">
          <BalanceScale />
        </div>
      </div>

      <div className="mz-landing-settle mt-[14px] flex items-center justify-between gap-[10px]">
        <p className="inline-flex items-center gap-[8px] rounded-pill bg-success-soft px-[12px] py-[6px] text-[13px] font-semibold text-success-ink">
          <svg viewBox="0 0 16 16" className="h-[14px] w-[14px]" aria-hidden="true">
            <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t("landing.ledger.balanced")}
        </p>
        <button
          type="button"
          onClick={() => setRun((n) => n + 1)}
          className="min-h-[44px] rounded-md px-[10px] text-[13px] font-semibold text-accent hover:bg-surface-2"
        >
          {t("landing.ledger.replay")}
        </button>
      </div>
    </div>
  );
}
