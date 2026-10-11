import { Navigate, NavLink, Route, Routes } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BrandMark, cn } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import { usePlatformApi } from "./api";
import { TenantsPage } from "./TenantsPage";
import { TenantDetailPage } from "./TenantDetailPage";
import { PlanEditor } from "./PlanEditor";
import { PlansPage } from "./PlansPage";
import { OperatorsPage } from "./OperatorsPage";

const RAIL_ITEMS = [
  { to: "/platform/tenants", labelKey: "platform.nav.tenants" as const },
  { to: "/platform/plans", labelKey: "platform.nav.plans" as const },
  { to: "/platform/users", labelKey: "platform.nav.operators" as const },
];

export function PlatformShell() {
  const { t } = useAppTranslation();
  const { session, setSession } = usePlatformApi();
  const queryClient = useQueryClient();

  return (
    <div className="flex min-h-screen flex-col bg-bg md:flex-row">
      <nav
        aria-label={t("platform.brand.name")}
        className={cn(
          "flex flex-none flex-row flex-wrap items-center gap-x-[10px] gap-y-[8px] border-b border-chrome-border px-[16px] py-[10px] text-chrome-ink",
          "md:w-[220px] md:flex-col md:flex-nowrap md:items-stretch md:gap-0 md:border-b-0 md:border-e md:p-[14px]",
          "bg-[linear-gradient(190deg,var(--chrome),var(--chrome-2))]",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-[9px] md:flex-none md:px-[4px] md:py-[6px]">
          <BrandMark className="h-[24px] w-[24px] flex-none text-brand" />
          <span className="mz-disp text-[14px] font-bold">{t("platform.brand.name")}</span>
        </div>

        <ul className="order-last flex w-full flex-row gap-[4px] overflow-x-auto md:order-none md:mt-[16px] md:w-auto md:flex-1 md:flex-col md:overflow-visible">
          {RAIL_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-[var(--h-btn)] items-center whitespace-nowrap rounded-md px-[10px] text-[13px] transition-colors md:w-full",
                    isActive ? "bg-chrome-active text-chrome-ink" : "text-chrome-ink-muted hover:bg-chrome-hover hover:text-chrome-ink",
                  )
                }
              >
                {t(item.labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="flex min-w-0 items-center gap-[6px] md:mt-auto md:flex-col md:items-stretch md:border-t md:border-chrome-border md:pt-[10px]">
          <span className="max-w-[34vw] truncate px-[4px] text-2xs text-chrome-ink-muted md:max-w-none">{session?.user.email}</span>
          <button
            type="button"
            onClick={() => {
              queryClient.clear();
              setSession(null);
            }}
            className="flex min-h-[var(--h-btn)] items-center whitespace-nowrap rounded-md px-[10px] text-start text-[13px] text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink md:w-full"
          >
            {t("platform.nav.signOut")}
          </button>
        </div>
      </nav>

      <main className="min-w-0 flex-1 p-[16px] md:p-[24px]">
        <Routes>
          <Route index element={<Navigate to="/platform/tenants" replace />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="tenants/:id" element={<TenantDetailPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="plans/:id" element={<PlanEditor />} />
          <Route path="users" element={<OperatorsPage />} />
        </Routes>
      </main>
    </div>
  );
}
