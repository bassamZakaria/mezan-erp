import type { BranchCaveatDTO } from "@mezan/contracts";
import { Money as MoneyValue } from "@mezan/ui";
import { useAppTranslation } from "../../i18n";
import { moneyToNumber, parseMoney } from "../../data/partner-detail-hooks";

export function BranchCaveatNote({ caveat }: { caveat: BranchCaveatDTO }) {
  const { t, locale } = useAppTranslation();
  return (
    <p role="note" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
      {locale === "ar" ? caveat.message : caveat.messageEn}{" "}
      <span className="font-semibold">
        {t("reports.unattributedShare")} <MoneyValue value={moneyToNumber(parseMoney(caveat.unattributedNet))} showUnit={false} />
      </span>
    </p>
  );
}
