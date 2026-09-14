import { NavLink, Route, Routes } from "react-router";
import { BrandMark, cn } from "@mezan/ui";
import { useAppTranslation } from "../i18n";
import { usePlatformApi } from "./api";
import { PlanEditor } from "./PlanEditor";
import { PlansPage } from "./PlansPage";
import { OperatorsPage } from "./OperatorsPage";

/**
 * Tenants gets its real screen in a later task (B8) — for now the shell's
 * job there is only to prove the door works: sign in, see a rail that goes
 * somewhere, sign out. A title-only placeholder is honest about that instead
 * of a blank pane.
 */
function TenantsPlaceholder() {
  const { t } = useAppTranslation();
  return <h1 className="font-display text-[19px] font-bold text-ink">{t("platform.nav.tenants")}</h1>;
}

const RAIL_ITEMS = [
  { to: "tenants", labelKey: "platform.nav.tenants" as const },
  { to: "plans", labelKey: "platform.nav.plans" as const },
  { to: "users", labelKey: "platform.nav.operators" as const },
];

export function PlatformShell() {
  const { t } = useAppTranslation();
  const { session, setSession } = usePlatformApi();

  return (
    <div dir="rtl" className="flex min-h-screen bg-bg">
      <nav
        aria-label={t("platform.brand.name")}
        className={cn(
          "flex w-[220px] flex-none flex-col border-e border-chrome-border p-[14px] text-chrome-ink",
          "bg-[linear-gradient(190deg,var(--chrome),var(--chrome-2))]",
        )}
      >
        <div className="flex items-center gap-[9px] px-[4px] py-[6px]">
          <BrandMark className="h-[24px] w-[24px] flex-none text-brand" />
          <span className="mz-disp text-[14px] font-bold">{t("platform.brand.name")}</span>
        </div>

        <ul className="mt-[16px] flex flex-1 flex-col gap-[4px]">
          {RAIL_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-[var(--h-btn)] w-full items-center rounded-md px-[10px] text-[13px] transition-colors",
                    isActive ? "bg-chrome-active text-chrome-ink" : "text-chrome-ink-muted hover:bg-chrome-hover hover:text-chrome-ink",
                  )
                }
              >
                {t(item.labelKey)}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="mt-auto flex flex-col gap-[6px] border-t border-chrome-border pt-[10px]">
          <span className="truncate px-[4px] text-2xs text-chrome-ink-muted">{session?.user.email}</span>
          <button
            type="button"
            onClick={() => setSession(null)}
            className="flex min-h-[var(--h-btn)] w-full items-center rounded-md px-[10px] text-start text-[13px] text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink"
          >
            {t("platform.nav.signOut")}
          </button>
        </div>
      </nav>

      <main className="flex-1 p-[24px]">
        <Routes>
          <Route index element={<TenantsPlaceholder />} />
          <Route path="tenants" element={<TenantsPlaceholder />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="plans/:id" element={<PlanEditor />} />
          <Route path="users" element={<OperatorsPage />} />
        </Routes>
      </main>
    </div>
  );
}
