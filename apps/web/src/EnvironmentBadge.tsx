import { DEPLOYMENT_ENVIRONMENT_META, DeploymentEnvironment } from "@mezan/contracts";
import { useAppTranslation } from "./i18n";

const isStaging = () => document.querySelector(`meta[name="${DEPLOYMENT_ENVIRONMENT_META}"]`)?.getAttribute("content") === DeploymentEnvironment.Staging;

export function EnvironmentBadge() {
  const { t } = useAppTranslation();
  if (!isStaging()) return null;
  return (
    <div
      role="note"
      className="pointer-events-none fixed inset-x-0 bottom-[8px] z-20 mx-auto w-fit rounded-md border border-warning bg-warning-soft px-[10px] py-[4px] text-[12px] font-semibold text-warning-ink opacity-90 shadow-sm print:hidden"
    >
      {t("environment.staging")}
    </div>
  );
}
