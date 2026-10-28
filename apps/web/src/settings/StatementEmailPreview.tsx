import { Money, renderOpenItemStatement } from "@mezan/domain";
import { todayIso } from "../lib/dates";
import { useAppTranslation } from "../i18n";

export interface StatementEmailPreviewProps {
  readonly subject: string;
  readonly body: string;
  readonly companyName: string;
  readonly currency: string;
}

export function StatementEmailPreview({ subject, body, companyName, currency }: StatementEmailPreviewProps) {
  const { t } = useAppTranslation();
  const rendered = renderOpenItemStatement(
    { customerName: t("settingsGeneral.emailPreviewCustomer"), companyName, asOfDate: todayIso(), currency, items: [], balance: Money.zero() },
    { subject, body },
  );
  return (
    <section aria-label={t("settingsGeneral.emailPreview")} className="flex flex-col gap-[6px] rounded-md border border-dashed border-border bg-surface-2 p-[12px]">
      <div className="text-[11.5px] font-semibold text-ink-faint">{t("settingsGeneral.emailPreview")}</div>
      <div dir="auto" className="text-[12.5px] text-ink">
        <span className="text-ink-muted">{t("settingsGeneral.emailPreviewSubject")} </span>
        {rendered.subject}
      </div>
      <pre dir="auto" className="whitespace-pre-wrap font-sans text-[12.5px] leading-[1.7] text-ink">
        {rendered.body}
      </pre>
    </section>
  );
}
