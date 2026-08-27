import { useMemo, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import { BrandMark } from "./BrandMark";
import { ScopeSwitchers } from "./ScopeSwitcher";
import type { TopbarScopeOption } from "./Topbar";
import { navGroupItems, type NavGroup, type NavItem, type NavSection, type ShellUser } from "./types";
import { DisclosureChevron } from "../primitives/DisclosureChevron";

export interface SidebarProps {
  activeKey?: string;
  topItem: NavItem;
  /**
   * System rows shown directly under the top item, outside every group — the
   * approvals inbox. NOT user pinning: the rail's «مثبّت» block and its pin
   * toggles were removed, so nothing here is user-configurable.
   */
  pinnedItems?: readonly NavItem[];
  /** Screens this user opened most recently, newest first. Supplied by the app, which owns the history. */
  recentItems?: readonly NavItem[];
  groups: NavGroup[];
  brandName?: string;
  brandSub?: string;
  /** Company context pinned above the nav — display only; there is a single tenant per session, so there is nothing to switch. */
  tenantName?: string;
  scopeLabel?: string;
  className?: string;
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





function RailBlockLabel({ children }: { children: string }) {
  return <div className="font-sig px-[10px] pb-[5px] pt-[14px] text-xs font-semibold tracking-[0.04em] text-chrome-ink-muted">{children}</div>;
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

function NavRow({
  item,
  active,
  showLabel,
  trailing,
}: {
  item: NavItem;
  active: boolean;
  showLabel: boolean;
  trailing?: ReactNode;
}) {
  const className = cn(
    "relative flex min-h-[44px] w-full items-center gap-[11px] rounded-md py-[10px] text-start text-md font-medium transition-colors duration-150",
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
    <li className="relative flex items-center">
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
      {trailing}
    </li>
  );
}

function NavSectionBlock({
  section,
  collapsed,
  holdsActive,
  expanded,
  activeKey,
  onToggle,
}: {
  section: NavSection;
  collapsed: boolean;
  holdsActive: boolean;
  expanded: boolean;
  activeKey?: string;
  onToggle: () => void;
}) {
  if (!expanded) {
    // Collapsed rail has no room for a third level; its items sit flush with
    // the group's own, which is what the icon-only rail is for.
    return (
      <ul className="flex flex-col gap-[1px]">
        {section.items.map((item) => (
          <NavRow key={item.key} item={item} active={activeKey === item.key} showLabel={false} />
        ))}
      </ul>
    );
  }

  return (
    <div className="mt-[2px]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className={cn(
          "flex w-full items-center gap-[7px] rounded-sm px-[11px] py-[6px] text-start text-sm font-semibold transition-colors",
          holdsActive ? "text-chrome-ink" : "text-chrome-ink-muted hover:text-chrome-ink",
        )}
      >
        <DisclosureChevron collapsed={collapsed} className="h-[10px] w-[10px] opacity-70" />
        <span className="truncate">{section.label}</span>
        <span className="ms-auto flex-none text-[10px] font-normal opacity-60">{section.items.length}</span>
      </button>
      {collapsed ? null : (
        <ul className="flex flex-col gap-[1px] ps-[13px]">
          {section.items.map((item) => (
            <NavRow key={item.key} item={item} active={activeKey === item.key} showLabel />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Sidebar — the dark-teal module rail: company context and branch/warehouse switchers on top, grouped nav with a brass active bar, user + theme at the foot. Collapses to icon-only; mirrors with the document direction. */
export function Sidebar({
  activeKey,
  topItem,
  pinnedItems = [],
  recentItems = [],
  groups,
  brandName,
  brandSub = "Mezan ERP",
  tenantName,
  scopeLabel,
  className,
}: SidebarProps) {
  const { t } = useUiTranslation();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of groups) if (group.defaultCollapsed) initial[group.key] = true;
    return initial;
  });
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of groups) {
      for (const section of group.sections ?? []) {
        if (section.defaultCollapsed) initial[`${group.key}/${section.key}`] = true;
      }
    }
    return initial;
  });
  const [railCollapsed, setRailCollapsed] = useState(loadPersistedRailCollapsed);
  const [query, setQuery] = useState("");

  const itemByKey = useMemo(() => {
    const map = new Map<string, NavItem>();
    for (const group of groups) for (const item of navGroupItems(group)) map.set(item.key, item);
    map.set(topItem.key, topItem);
    for (const item of pinnedItems) map.set(item.key, item);
    return map;
  }, [groups, topItem, pinnedItems]);


  const recentUnpinned = useMemo(
    () => recentItems.filter((item) => item.key !== activeKey).slice(0, 4),
    [recentItems, activeKey],
  );

  const trimmedQuery = query.trim();
  const searchResults = useMemo(() => {
    if (trimmedQuery === "") return [];
    const needle = trimmedQuery.toLocaleLowerCase();
    const seen = new Set<string>();
    const found: NavItem[] = [];
    for (const item of itemByKey.values()) {
      if (seen.has(item.key)) continue;
      if (!item.label.toLocaleLowerCase().includes(needle)) continue;
      seen.add(item.key);
      found.push(item);
    }
    return found.slice(0, 12);
  }, [trimmedQuery, itemByKey]);



  const activeGroupKey = useMemo(
    () => groups.find((group) => navGroupItems(group).some((item) => item.key === activeKey))?.key ?? null,
    [groups, activeKey],
  );

  // A section holding the active screen opens regardless of its stored state,
  // otherwise deep-linking to a nested screen lands on a collapsed sub-group.
  const activeSectionKey = useMemo(() => {
    for (const group of groups) {
      for (const section of group.sections ?? []) {
        if (section.items.some((item) => item.key === activeKey)) return `${group.key}/${section.key}`;
      }
    }
    return null;
  }, [groups, activeKey]);

  function toggleRail() {
    setRailCollapsed((prev) => {
      const next = !prev;
      persistRailCollapsed(next);
      return next;
    });
  }

  const expanded = !railCollapsed;
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
          <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[7px] bg-gradient-to-br from-accent to-accent-strong text-[13px] font-extrabold text-accent-ink">
            {firstGlyph(tenantName)}
          </span>
          {expanded ? (
            <span className="min-w-0">
              <span className="mz-lat block truncate text-md font-semibold leading-tight">{tenantName}</span>
              {scopeLabel ? <span className="block truncate text-xs text-chrome-ink-muted">{scopeLabel}</span> : null}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Named landmark: the page now has three navs — this rail, the
          breadcrumb, and the in-page tabs — and "navigation" three times over
          is not a way to find the main one. */}
      <nav
        aria-label={t("shell.rail.landmark")}
        className="mz-scrollbar-none flex-1 overflow-y-auto px-[12px] pb-[16px] pt-[4px]"
      >
        {expanded ? (
          <div className="relative pb-[6px]">
            <input /* native-control-allow: SearchInput paints from surface/ink tokens, which are light in light mode; the rail is dark teal in BOTH themes and must use the independent chrome-* set (see tokens.css). */
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("shell.rail.searchLabel")}
              placeholder={t("shell.rail.search")}
              className="h-[44px] w-full rounded-md border border-chrome-border bg-chrome-hover px-[11px] text-md text-chrome-ink outline-none placeholder:text-chrome-ink-muted focus-visible:border-chrome-accent"
            />
          </div>
        ) : null}
        <ul>
          <NavRow item={topItem} active={activeKey === topItem.key} showLabel={expanded} />
          {pinnedItems.map((item) => (
            <NavRow key={item.key} item={item} active={activeKey === item.key} showLabel={expanded} />
          ))}
        </ul>

        {expanded && trimmedQuery !== "" ? (
          <div>
            {searchResults.length === 0 ? (
              <p className="px-[10px] py-[16px] text-md text-chrome-ink-muted">{t("shell.rail.noResults")}</p>
            ) : (
              <ul className="flex flex-col gap-[1px] pt-[8px]">
                {searchResults.map((item) => (
                  <NavRow key={item.key} item={item} active={activeKey === item.key} showLabel />
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {expanded && trimmedQuery === "" && recentUnpinned.length > 0 ? (
          <div>
            <RailBlockLabel>{t("shell.rail.recent")}</RailBlockLabel>
            <ul className="flex flex-col gap-[1px]">
              {recentUnpinned.map((item) => (
                <NavRow key={item.key} item={item} active={activeKey === item.key} showLabel />
              ))}
            </ul>
          </div>
        ) : null}

        {expanded && trimmedQuery === "" ? <RailBlockLabel>{t("shell.rail.all")}</RailBlockLabel> : null}

        {trimmedQuery !== "" && expanded
          ? null
          : groups.map((group) => {
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
                  "font-sig flex w-full items-center gap-[8px] rounded-sm text-xs font-semibold tracking-[0.04em] text-chrome-ink-muted transition-colors hover:text-chrome-ink",
                  expanded ? "justify-between px-[10px] pb-[6px] pt-[14px]" : "justify-center py-[7px]",
                )}
              >
                {expanded ? (
                  <>
                    <span className="truncate">{group.label}</span>
                    <DisclosureChevron collapsed={groupCollapsed} className="h-[11px] w-[11px] opacity-80" />
                  </>
                ) : (
                  <span className="flex h-[21px] w-[21px] items-center justify-center">
                    {group.icon ?? <span className="text-[13px] leading-none">{firstGlyph(group.label)}</span>}
                  </span>
                )}
              </button>
              {groupCollapsed ? null : (
                <>
                  {group.items.length ? (
                    <ul className="flex flex-col gap-[1px]">
                      {group.items.map((item) => (
                        <NavRow key={item.key} item={item} active={activeKey === item.key} showLabel={expanded} />
                      ))}
                    </ul>
                  ) : null}
                  {(group.sections ?? []).map((section) => {
                    const sectionId = `${group.key}/${section.key}`;
                    const sectionCollapsed = (collapsedSections[sectionId] ?? false) && activeSectionKey !== sectionId;
                    return (
                      <NavSectionBlock
                        key={section.key}
                        section={section}
                        collapsed={sectionCollapsed}
                        holdsActive={activeSectionKey === sectionId}
                        expanded={expanded}
                        activeKey={activeKey}
                        onToggle={() => setCollapsedSections((prev) => ({ ...prev, [sectionId]: !sectionCollapsed }))}
                      />
                    );
                  })}
                </>
              )}
            </div>
              );
            })}
      </nav>
    </aside>
  );
}
