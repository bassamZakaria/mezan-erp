import { Money, convertFromBase, convertToBase, roundMoney } from "@mezan/domain";
import { useAppTranslation } from "../i18n";

export interface TreasuryCurrencyRate {
  readonly currency: string;
  readonly rate: string;
  readonly effectiveDate: string;
  readonly status: string;
}

export interface TreasuryCurrencyAccount {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
}

const USABLE_RATE_STATUSES: ReadonlySet<string> = new Set(["approved", "locked"]);

export function approvedRateOn(rates: readonly TreasuryCurrencyRate[], currency: string, date: string): string | null {
  const usable = rates.filter((rate) => rate.currency === currency && USABLE_RATE_STATUSES.has(rate.status) && rate.effectiveDate <= date);
  return usable.sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1))[0]?.rate ?? null;
}

function twoDecimals(amount: Money): string {
  return roundMoney(amount, 2, "HALF_UP").toString().slice(0, -4);
}

const MONEY_DECIMAL = /^-?\d+(\.\d{1,6})?$/;

function statedAmount(amount: string): Money {
  return MONEY_DECIMAL.test(amount) ? Money.fromMajor(amount) : Money.zero();
}

interface TreasuryCurrencyNoticeProps {
  readonly baseCurrency: string;
  readonly accounts: readonly TreasuryCurrencyAccount[];
  readonly voucherCurrency: string;
  readonly onVoucherCurrencyChange: (currency: string) => void;
  readonly amount: string;
  readonly date: string;
  readonly rates: readonly TreasuryCurrencyRate[];
}

export function TreasuryCurrencyNotice({ baseCurrency, accounts, voucherCurrency, onVoucherCurrencyChange, amount, date, rates }: TreasuryCurrencyNoticeProps) {
  const { t } = useAppTranslation();
  const foreign = accounts.filter((account) => account.currency !== baseCurrency);
  if (foreign.length === 0) return null;
  const stated = statedAmount(amount);
  const choices = [...new Set([...foreign.map((account) => account.currency), baseCurrency])];

  return (
    <div role="group" aria-label={t("vouchers.treasuryCurrency")} className="flex flex-col gap-[10px] rounded-md border border-border bg-surface-2 p-[12px]">
      <div className="text-[12.5px] font-semibold text-ink">{t("vouchers.treasuryCurrency")}</div>
      <div role="radiogroup" aria-label={t("vouchers.voucherCurrency")} className="flex flex-wrap items-center gap-[8px] text-[12.5px] text-ink">
        <span className="text-ink-muted">{t("vouchers.voucherCurrency")}</span>
        {choices.map((currency) => (
          <button
            key={currency}
            type="button"
            role="radio"
            aria-checked={voucherCurrency === currency}
            onClick={() => onVoucherCurrencyChange(currency)}
            className={`mz-num min-h-[32px] rounded-md border px-[12px] ${voucherCurrency === currency ? "border-brand bg-brand-soft font-bold text-ink" : "border-border text-ink-muted"}`}
          >
            {currency}
          </button>
        ))}
      </div>
      {foreign.map((account) => {
        const rate = approvedRateOn(rates, account.currency, date);
        if (!rate) {
          return (
            <div key={account.id} role="alert" className="rounded-md border border-danger bg-danger-soft px-[10px] py-[8px] text-[12px] text-danger-ink">
              {t("vouchers.noApprovedRate", { name: account.name, currency: account.currency, date })}
            </div>
          );
        }
        const inAccountCurrency = voucherCurrency === account.currency ? stated : convertFromBase(stated, rate);
        const inBase = voucherCurrency === account.currency ? convertToBase(stated, rate) : stated;
        return (
          <dl key={account.id} className="grid gap-[4px] text-[12px] text-ink-muted">
            <dt className="font-semibold text-ink">{t("vouchers.accountInCurrency", { name: account.name, currency: account.currency })}</dt>
            <dd>
              {t("vouchers.approvedRate")}: <span className="mz-num text-ink">{rate}</span>
            </dd>
            <dd>
              {t("vouchers.amountInAccountCurrency")}: <span className="mz-num text-ink">{twoDecimals(inAccountCurrency)} {account.currency}</span>
            </dd>
            <dd>
              {t("vouchers.baseEquivalent")}: <span className="mz-num text-ink">{twoDecimals(inBase)} {baseCurrency}</span>
            </dd>
          </dl>
        );
      })}
    </div>
  );
}
