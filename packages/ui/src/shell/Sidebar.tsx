import { useState } from "react";
import { cn } from "../lib/cn";
import { useUiTranslation } from "../i18n";
import { BrandMark } from "./BrandMark";
import type { NavGroup, NavItem, ShellUser } from "./types";

export interface SidebarProps {
  activeKey?: string;
  topItem: NavItem;
  groups: NavGroup[];
  user: ShellUser;
  brandName?: string;
  brandSub?: string;
  className?: string;
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const content = (
    <>
      <span
        aria-hidden
        className={cn("h-[5px] w-[5px] flex-none rounded-full transition-colors", active ? "bg-brand" : "bg-border-strong")}
      />
      <span className="flex-1">{item.label}</span>
      {item.tag ? (
        <span
          className={cn(
            "ms-auto rounded-pill px-[7px] py-[2px] text-[9px] font-bold tracking-[0.3px]",
            item.tag.tone === "pattern" ? "bg-accent-soft text-accent-strong" : "bg-surface-3 text-ink-faint",
          )}
        >
          {item.tag.label}
        </span>
      ) : null}
    </>
  );

  const sharedClassName = cn(
    "relative flex items-center gap-[10px] rounded-md px-[11px] py-[8px] text-[13.5px] font-medium transition-colors",
    active ? "bg-brand-soft font-bold text-brand" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
  );

  const inner = item.href ? (
    <a href={item.href} onClick={item.onClick} aria-current={active ? "page" : undefined} className={sharedClassName}>
      {content}
    </a>
  ) : (
    <button type="button" onClick={item.onClick} aria-current={active ? "page" : undefined} className={cn(sharedClassName, "w-full text-start")}>
      {content}
    </button>
  );

  return (
    <li>
      {active ? <span aria-hidden className="absolute inset-y-[20%] start-0 w-[3px] rounded-[3px] bg-brand" /> : null}
      {inner}
    </li>
  );
}

/** Sidebar — module navigation (brand mark, top link, collapsible groups, user footer); mirrors with the document direction. */
export function Sidebar({ activeKey, topItem, groups, user, brandName, brandSub = "Mezan ERP", className }: SidebarProps) {
  const { t } = useUiTranslation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of groups) if (group.defaultCollapsed) initial[group.key] = true;
    return initial;
  });

  return (
    <aside className={cn("flex h-screen w-[270px] flex-none flex-col overflow-y-auto border-s border-border bg-surface", className)}>
      <div className="flex items-center gap-[11px] border-b border-border px-[18px] py-[17px]">
        <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-brand-strong text-accent shadow-1">
          <BrandMark className="h-6 w-6" />
        </span>
        <div>
          <div className="font-display text-[19px] font-extrabold leading-[1.1] text-ink">{brandName ?? t("shell.brand.name")}</div>
          <div className="mz-lat mt-[1px] text-[10px] font-semibold uppercase tracking-[1.4px] text-ink-faint">{brandSub}</div>
        </div>
      </div>

      <nav className="flex-1 px-[12px] pb-[16px] pt-[10px]">
        <ul>
          <NavLink item={topItem} active={activeKey === topItem.key} />
        </ul>

        {groups.map((group) => {
          const isCollapsed = collapsed[group.key] ?? false;
          return (
            <div key={group.key} className="mt-[8px]">
              <button
                type="button"
                onClick={() => setCollapsed((prev) => ({ ...prev, [group.key]: !isCollapsed }))}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center justify-between gap-[8px] rounded-sm px-[11px] py-[6px] pt-[7px] text-[10.5px] font-bold uppercase tracking-[1px] text-ink-faint transition-colors hover:text-ink-muted"
              >
                <span>{group.label}</span>
                <svg
                  aria-hidden
                  viewBox="0 0 12 12"
                  fill="none"
                  className={cn("h-[11px] w-[11px] opacity-80 transition-transform", isCollapsed && "-rotate-90")}
                >
                  <path d="M3 4.5 6 8l3-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {isCollapsed ? null : (
                <ul className="flex flex-col gap-[1px] pt-[2px]">
                  {group.items.map((item) => (
                    <NavLink key={item.key} item={item} active={activeKey === item.key} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-[10px] border-t border-border px-[14px] py-[12px]">
        <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-brand-strong font-display text-[12px] font-bold text-brand-ink">
          {user.initials}
        </span>
        <div>
          <div className="text-[12.5px] font-bold text-ink">{user.name}</div>
          <div className="mz-lat text-[10.5px] text-ink-faint">{user.role}</div>
        </div>
      </div>
    </aside>
  );
}
