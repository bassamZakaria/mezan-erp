import { useEffect, useState } from "react";
import { Button, Checkbox } from "@mezan/ui";
import type { OneTimeCredentialDTO } from "@mezan/contracts";
import { useAppTranslation } from "../../../i18n";

export interface CredentialSheetProps {
  readonly credentials: readonly OneTimeCredentialDTO[];
  readonly onClose: () => void;
}

export function CredentialSheet({ credentials, onClose }: CredentialSheetProps) {
  const { t, locale } = useAppTranslation();
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return (
    <section className="w-full min-w-0" aria-labelledby="credential-sheet-title">
      <div className="mb-[14px] flex flex-col gap-[10px] print:hidden">
        <h1 id="credential-sheet-title" className="font-display text-2xl font-bold text-ink">
          {t("provisioning.sheet.title")}
        </h1>
        <p role="alert" className="rounded-md border border-warning bg-warning-soft px-[12px] py-[10px] text-[12.5px] text-warning-ink">
          {t("provisioning.sheet.warning")}
        </p>
        <div className="flex flex-wrap items-center gap-[9px]">
          <Button variant="primary" onClick={() => window.print()}>
            {t("provisioning.sheet.print")}
          </Button>
          <Checkbox label={t("provisioning.sheet.printed")} checked={printed} onChange={(event) => setPrinted(event.target.checked)} />
          <Button disabled={!printed} onClick={onClose}>
            {t("provisioning.sheet.close")}
          </Button>
        </div>
      </div>

      <div className="hidden print:block">
        <p className="text-lg font-bold">{t("provisioning.sheet.title")}</p>
        <p className="text-[12px]">{t("provisioning.sheet.issuedAt", { date: new Date().toLocaleString(locale) })}</p>
      </div>
      <p className="mb-[8px] text-[12.5px] text-ink-muted">{t("provisioning.sheet.hint")}</p>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-start text-ink-muted">
            <th scope="col" className="px-[8px] py-[6px] text-start font-semibold">
              {t("provisioning.sheet.col.name")}
            </th>
            <th scope="col" className="px-[8px] py-[6px] text-start font-semibold">
              {t("provisioning.sheet.col.email")}
            </th>
            <th scope="col" className="px-[8px] py-[6px] text-start font-semibold">
              {t("provisioning.sheet.col.pin")}
            </th>
            <th scope="col" className="px-[8px] py-[6px] text-start font-semibold">
              {t("provisioning.sheet.col.password")}
            </th>
          </tr>
        </thead>
        <tbody>
          {credentials.map((entry) => (
            <tr key={entry.userId} className="border-b border-border">
              <td className="px-[8px] py-[8px]">{entry.nameAr}</td>
              <td className="px-[8px] py-[8px]" dir="ltr">
                {entry.email}
              </td>
              <td className="px-[8px] py-[8px] font-mono tracking-[0.12em]" dir="ltr">
                {entry.pin}
              </td>
              <td className="px-[8px] py-[8px] font-mono" dir="ltr">
                {entry.password}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
