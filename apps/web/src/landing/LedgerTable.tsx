import type { CSSProperties } from "react";
import { Money, cn } from "@mezan/ui";
import { useAppTranslation, type AppTranslationKey } from "../i18n";
import { LedgerAccount, LedgerSide, piastresToDecimal, sumSide, type LedgerLine } from "./ledger-math";

const ACCOUNT_LABEL: Record<LedgerAccount, AppTranslationKey> = {
  [LedgerAccount.Customers]: "landing.acct.customers",
  [LedgerAccount.Sales]: "landing.acct.sales",
  [LedgerAccount.Vat]: "landing.acct.vat",
  [LedgerAccount.Cogs]: "landing.acct.cogs",
  [LedgerAccount.Inventory]: "landing.acct.inventory",
};

function Amount({ piastres }: { piastres: number }) {
  return piastres === 0 ? <span className="text-ink-faint">—</span> : <Money value={piastresToDecimal(piastres)} showUnit={false} />;
}

export function LedgerTable({ lines, animated = false }: { lines: readonly LedgerLine[]; animated?: boolean }) {
  const { t } = useAppTranslation();
  const rowClass = animated ? "mz-landing-row" : undefined;
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-border text-xs text-ink-muted">
          <th scope="col" className="py-[8px] text-start font-semibold">{t("landing.ledger.account")}</th>
          <th scope="col" className="w-[28%] py-[8px] text-end font-semibold">{t("landing.ledger.debit")}</th>
          <th scope="col" className="w-[28%] py-[8px] text-end font-semibold">{t("landing.ledger.credit")}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={line.account} className={cn("border-b border-border", rowClass)} style={{ "--row": index } as CSSProperties}>
            <td className="py-[9px] text-ink">{t(ACCOUNT_LABEL[line.account])}</td>
            <td className="py-[9px] text-end font-mono tabular-nums text-ink">
              <Amount piastres={line.debitPiastres} />
            </td>
            <td className="py-[9px] text-end font-mono tabular-nums text-ink">
              <Amount piastres={line.creditPiastres} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={cn("font-semibold", rowClass)} style={{ "--row": lines.length } as CSSProperties}>
          <th scope="row" className="pt-[10px] text-start text-ink">{t("landing.ledger.total")}</th>
          <td className="pt-[10px] text-end font-mono tabular-nums text-ink">
            <Money value={piastresToDecimal(sumSide(lines, LedgerSide.Debit))} showUnit={false} />
          </td>
          <td className="pt-[10px] text-end font-mono tabular-nums text-ink">
            <Money value={piastresToDecimal(sumSide(lines, LedgerSide.Credit))} showUnit={false} />
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
