import { useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import type { ThemePreference } from "../hooks/useTheme";
import { BrandMark } from "./BrandMark";
import { ScopeSwitchers } from "./ScopeSwitcher";
import type { TopbarScopeOption } from "./Topbar";
import type { NavGroup, NavItem, ShellUser } from "./types";

export interface SidebarProps {
  activeKey?: string;
  topItem: NavItem;
  groups: NavGroup[];
  user: ShellUser;
  brandName?: string;
  brandSub?: string;
  /** Company context pinned above the nav — display only; there is a single tenant per session, so there is nothing to switch. */
  tenantName?: string;
  scopeLabel?: string;
  theme?: ThemePreference;
  onToggleTheme?: () => void;
  className?: string;
  /**
   * Working-branch / warehouse selectors — real dropdowns that narrow which
   * data the app queries (see `apps/web/src/data/hub-hooks.ts`
   * `useScopeSelector` and `authHeaders` in `apps/web/src/data/session.ts`),
   * not a cosmetic relabel. Omit `branchOptions` to render neither — never
   * rendered with a fabricated option list.
   */
  branchOptions?: readonly TopbarScopeOption[];
  warehouseOptions?: readonly TopbarScopeOption[];
  selectedBranchId?: string | null;
  selectedWarehouseId?: string | null;
  onSelectBranch?: (branchId: string | null) => void;
  onSelectWarehouse?: (warehouseId: string | null) => void;
  allBranchesLabel?: string;
  allWarehousesLabel?: string;
}

const RAIL_STORAGE_KEY = "mezan.sidebarCollapsed";

function getRailStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Privacy mode / disabled storage can throw on access rather than just being absent.
    return null;
  }
}

function loadPersistedRailCollapsed(): boolean {
  const storage = getRailStorage();
  if (!storage) return false;
  try {
    return storage.getItem(RAIL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistRailCollapsed(collapsed: boolean): void {
  const storage = getRailStorage();
  if (!storage) return;
  try {
    storage.setItem(RAIL_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignore write failures — the rail still keeps its state for this session.
  }
}

function firstGlyph(label: string): string {
  return [...label.trim()][0] ?? "•";
}

function RailIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px]">
      <rect x="3" y="4" width="14" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 4v12" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function NavGlyph({ item }: { item: NavItem }) {
  return (
    <span className="flex h-[21px] w-[21px] flex-none items-center justify-center rounded-[6px] border border-chrome-border bg-chrome-hover">
      {item.icon ?? (
        <span aria-hidden="true" className="mz-sig text-[11px] font-bold leading-none">
          {firstGlyph(item.label)}
        </span>
      )}
    </span>
  );
}

function NavRow({ item, active, showLabel }: { item: NavItem; active: boolean; showLabel: boolean }) {
  const className = cn(
    "relative flex w-full items-center gap-[11px] rounded-md py-[8px] text-start text-sm font-medium transition-colors duration-150",
    showLabel ? "px-[11px]" : "justify-center px-0",
    active ? "bg-chrome-active font-semibold text-chrome-ink" : "text-chrome-ink-muted hover:bg-chrome-hover hover:text-chrome-ink",
  );

  const content = (
    <>
      <NavGlyph item={item} />
      {showLabel ? (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {item.tag ? (
            <span
              className={cn(
                "flex-none rounded-pill px-[7px] py-[2px] text-[9px] font-bold tracking-[0.3px]",
                item.tag.tone === "pattern"
                  ? "bg-[color-mix(in_srgb,var(--chrome-accent)_22%,transparent)] text-chrome-accent"
                  : "bg-chrome-hover text-chrome-ink-muted",
              )}
            >
              {item.tag.label}
            </span>
          ) : null}
        </>
      ) : null}
    </>
  );

  return (
    <li className="relative">
      {active ? (
        <span aria-hidden="true" className="absolute inset-y-[6px] start-[-12px] w-[3px] rounded-e-[3px] bg-chrome-accent" />
      ) : null}
      {item.href ? (
        <a
          href={item.href}
          onClick={item.onClick}
          aria-current={active ? "page" : undefined}
          title={showLabel ? undefined : item.label}
          className={className}
        >
          {content}
        </a>
      ) : (
        <button
          type="button"
          onClick={item.onClick}
          aria-current={active ? "page" : undefined}
          title={showLabel ? undefined : item.label}
          className={className}
        >
          {content}
        </button>
      )}
    </li>
  );
}

/** Sidebar — the dark-teal module rail: company context and branch/warehouse switchers on top, grouped nav with a brass active bar, user + theme at the foot. Collapses to icon-only; mirrors with the document direction. */
export function Sidebar({
  activeKey,
  topItem,
  groups,
  user,
  brandName,
  brandSub = "Mezan ERP",
  tenantName,
  scopeLabel,
  theme,
  onToggleTheme,
  className,
  branchOptions,
  warehouseOptions,
  selectedBranchId,
  selectedWarehouseId,
  onSelectBranch,
  onSelectWarehouse,
  allBranchesLabel,
  allWarehousesLabel,
}: SidebarProps) {
  const { t } = useUiTranslation();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of groups) if (group.defaultCollapsed) initial[group.key] = true;
    return initial;
  });
  const [railCollapsed, setRailCollapsed] = useState(loadPersistedRailCollapsed);

  const activeGroupKey = useMemo(
    () => groups.find((group) => group.items.some((item) => item.key === activeKey))?.key ?? null,
    [groups, activeKey],
  );

  function toggleRail() {
    setRailCollapsed((prev) => {
      const next = !prev;
      persistRailCollapsed(next);
      return next;
    });
  }

  const expanded = !railCollapsed;
  const isDark = theme === "dark";
  const railToggleLabel = expanded ? t("shell.rail.collapse") : t("shell.rail.expand");

  return (
    <aside
      className={cn(
        "sticky top-0 z-30 flex h-screen flex-none flex-col overflow-hidden bg-[linear-gradient(190deg,var(--chrome),var(--chrome-2))] text-chrome-ink shadow-chrome transition-[width] duration-200",
        expanded ? "w-[264px]" : "w-[76px]",
        className,
      )}
    >
      <div className={cn("flex flex-none items-center gap-[11px] px-[14px] pb-[12px] pt-[16px]", !expanded && "flex-col gap-[10px] px-0")}>
        <span className="flex h-[40px] w-[40px] flex-none items-center justify-center rounded-[11px] border border-chrome-border bg-chrome-hover text-chrome-accent">
          <BrandMark className="h-[25px] w-[25px]" />
        </span>
        {expanded ? (
          <div className="min-w-0 flex-1">
            <div className="font-sig text-xl font-bold leading-none">{brandName ?? t("shell.brand.name")}</div>
            <div className="mz-lat font-sig mt-[3px] text-[9.5px] uppercase tracking-[0.2em] text-chrome-ink-muted">{brandSub}</div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={toggleRail}
          aria-expanded={expanded}
          aria-label={railToggleLabel}
          title={railToggleLabel}
          className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-md border border-chrome-border text-chrome-ink-muted transition-colors hover:bg-chrome-hover hover:text-chrome-ink"
        >
          <RailIcon />
        </button>
      </div>

      {tenantName ? (
        <div
          className={cn(
            "flex flex-none items-center gap-[9px] rounded-md border border-chrome-border bg-chrome-hover",
            expanded ? "mx-[12px] mb-[8px] px-[11px] py-[9px]" : "mx-auto mb-[8px] p-[7px]",
          )}
          title={expanded ? undefined : scopeLabel ? `${tenantName} · ${scopeLabel}` : tenantName}
        >
          <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-gradient-to-br from-accent to-accent-strong text-[13px] font-extrabold text-[color:var(--chrome-2)]">
            {firstGlyph(tenantName)}
          </span>
          {expanded ? (
            <span className="min-w-0">
              <span className="mz-lat block truncate text-sm font-semibold leading-tight">{tenantName}</span>
              {scopeLabel ? <span className="block truncate text-2xs text-chrome-ink-muted">{scopeLabel}</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}

      <ScopeSwitchers
        expanded={expanded}
        branchAriaLabel={t("shell.scope.branch")}
        warehouseAriaLabel={t("shell.scope.warehouse")}
        branchOptions={branchOptions}
        warehouseOptions={warehouseOptions}
        selectedBranchId={selectedBranchId}
        selectedWarehouseId={selectedWarehouseId}
        onSelectBranch={onSelectBranch}
        onSelectWarehouse={onSelectWarehouse}
        allBranchesLabel={allBranchesLabel ?? t("shell.scope.allBranches")}
        allWarehousesLabel={allWarehousesLabel ?? t("shell.scope.allWarehouses")}
      />

      <nav className="flex-1 overflow-y-auto px-[12px] pb-[16px] pt-[4px]">
        <ul>
          <NavRow item={topItem} active={activeKey === topItem.key} showLabel={expanded} />
        </ul>

        {groups.map((group) => {
          const groupCollapsed = collapsedGroups[group.key] ?? false;
          const groupIsActive = activeGroupKey === group.key;
          return (
            <div key={group.key} className="relative mt-[6px]">
              {!expanded && groupIsActive && groupCollapsed ? (
                <span aria-hidden="true" className="absolute inset-y-[6px] start-[-12px] w-[3px] rounded-e-[3px] bg-chrome-accent" />
              ) : null}
              <button
                type="button"
                onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.key]: !groupCollapsed }))}
                aria-expanded={!groupCollapsed}
                aria-label={expanded ? undefined : group.label}
                title={expanded ? undefined : group.label}
                className={cn(
                  "mz-eyebrow flex w-full items-center gap-[8px] rounded-sm text-chrome-ink-muted transition-colors hover:text-chrome-ink",
                  expanded ? "justify-between px-[10px] pb-[6px] pt-[14px]" : "justify-center py-[7px]",
                )}
              >
                {expanded ? (
                  <>
                    <span className="truncate">{group.label}</span>
                    <svg
                      aria-hidden
                      viewBox="0 0 12 12"
                      fill="none"
                      className={cn("h-[11px] w-[11px] flex-none opacity-80 transition-transform duration-150", groupCollapsed && "-rotate-90")}
                    >
                      <path d="M3 4.5 6 8l3-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </>
                ) : (
                  <span className="flex h-[21px] w-[21px] items-center justify-center">
                    {group.icon ?? <span className="text-[13px] leading-none">{firstGlyph(group.label)}</span>}
                  </span>
                )}
              </button>
              {groupCollapsed ? null : (
                <ul className="flex flex-col gap-[1px]">
                  {group.items.map((item) => (
                    <NavRow key={item.key} item={item} active={activeKey === item.key} showLabel={expanded} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div
        className={cn(
          "flex flex-none items-center gap-[10px] border-t border-chrome-border py-[12px]",
          expanded ? "px-[12px]" : "flex-col gap-[8px] px-0",
        )}
      >
        <span
          title={expanded ? undefined : `${user.name} · ${user.role}`}
          className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-strong font-display text-[13px] font-extrabold text-[color:var(--chrome-2)]"
        >
          {user.initials}
        </span>
        {expanded ? (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">{user.name}</div>
            <div className="truncate text-xs text-chrome-ink-muted">{user.role}</div>
          </div>
        ) : null}
        {onToggleTheme ? (
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={t("shell.theme.toggle")}
            title={t("shell.theme.toggle")}
            className={cn(
              "flex h-[34px] w-[34px] flex-none items-center justify-center rounded-md border border-chrome-border text-chrome-ink transition-colors hover:bg-chrome-hover",
              expanded && "ms-auto",
            )}
          >
            {isDark ? (
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[17px] w-[17px]">
                <path
                  d="M16.5 12.6A6.8 6.8 0 0 1 7.4 3.5 6.8 6.8 0 1 0 16.5 12.6Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[17px] w-[17px]">
                <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.5" />
                <path
                  d="M10 2v2M10 16v2M4 4l1.4 1.4M14.6 14.6 16 16M2 10h2M16 10h2M4 16l1.4-1.4M14.6 5.4 16 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
