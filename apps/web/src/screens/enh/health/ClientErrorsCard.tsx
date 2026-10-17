import { Card, StatusPill, formatDateTime } from "@mezan/ui";
import { ClientErrorPlatformDTO, HealthLevelDTO, type HealthClientErrorsDTO } from "@mezan/contracts";
import { useAppTranslation, type AppTranslationKey } from "../../../i18n";

const PLATFORM_LABEL: Readonly<Record<ClientErrorPlatformDTO, AppTranslationKey>> = {
  [ClientErrorPlatformDTO.Web]: "health.clientErrors.platform.web",
  [ClientErrorPlatformDTO.Desktop]: "health.clientErrors.platform.desktop",
  [ClientErrorPlatformDTO.Mobile]: "health.clientErrors.platform.mobile",
};

const COLUMNS: readonly AppTranslationKey[] = [
  "health.clientErrors.at",
  "health.clientErrors.where",
  "health.clientErrors.route",
  "health.clientErrors.message",
  "health.clientErrors.request",
];

export function ClientErrorsCard({ errors }: { errors: HealthClientErrorsDTO }) {
  const { t, locale } = useAppTranslation();
  const flagged = errors.level !== HealthLevelDTO.Ok;
  return (
    <Card className="flex flex-col gap-[10px] p-[16px_18px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <h2 className="text-[13px] font-bold text-ink">{t("health.item.client_errors")}</h2>
        <StatusPill label={t("health.clientErrors.lastDay", { count: String(errors.lastDay) })} tone={flagged ? "warning" : "success"} />
      </div>
      {errors.recent.length === 0 ? (
        <p className="text-[12px] text-ink-muted">{t("health.clientErrors.none")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border">
                {COLUMNS.map((key) => (
                  <th key={key} className="p-[6px_8px] text-start font-semibold text-ink-muted">{t(key)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {errors.recent.map((error) => (
                <tr key={error.id} className="border-b border-border align-top last:border-0">
                  <td className="mz-num whitespace-nowrap p-[6px_8px]">{formatDateTime(error.receivedAt, { locale })}</td>
                  <td className="whitespace-nowrap p-[6px_8px]">{t(PLATFORM_LABEL[error.platform])}</td>
                  <td className="mz-lat p-[6px_8px] [overflow-wrap:anywhere]" dir="ltr">{error.route ?? "—"}</td>
                  <td className="p-[6px_8px] [overflow-wrap:anywhere]" dir="auto">
                    <details>
                      <summary className="cursor-pointer text-ink">{error.message}</summary>
                      {error.stack ? <pre className="mt-[6px] max-w-full overflow-x-auto text-[11px] text-ink-muted" dir="ltr">{error.stack}</pre> : null}
                    </details>
                  </td>
                  <td className="mz-lat p-[6px_8px]" dir="ltr">{error.requestId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
