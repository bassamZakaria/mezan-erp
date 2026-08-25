import { useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { useTranslation } from "../i18n";
import { Card } from "./atoms";

/**
 * PermissionMatrix — the grouped checkbox matrix behind the role editor
 * (docs/catalog/09 §"تعديل الدور — THE PERMISSION MATRIX"): a search box,
 * one collapsible section per module with a "selected/total" badge and a
 * module-level select-all checkbox, sub-grouped permission cards showing the
 * dot-notation code, a ⚠ sensitive treatment, and a "depends on" line.
 *
 * Purely presentational — dependency auto-select, licensed-module filtering,
 * and the actual permission catalog all live in `@mezan/domain`
 * (`permissions/role-editor.ts`, `permissions/module-licensing.ts`); this
 * component only renders whatever grouped/selected shape it is handed and
 * reports toggles back up.
 */

export interface PermissionMatrixItem {
  code: string;
  label: string;
  sensitive?: boolean;
  platformAdminOnly?: boolean;
  /** Direct prerequisite codes, shown as "depends on". */
  dependsOn?: string[];
  selected: boolean;
  /** e.g. a platform-admin-only permission a tenant admin cannot self-grant. */
  disabled?: boolean;
  disabledReason?: string;
}

export interface PermissionMatrixSubgroup {
  key: string;
  label: string;
  items: PermissionMatrixItem[];
}

export interface PermissionMatrixModule {
  key: string;
  label: string;
  subgroups: PermissionMatrixSubgroup[];
}

export interface PermissionMatrixProps {
  modules: PermissionMatrixModule[];
  onToggle: (code: string) => void;
  /** Module header's select-all checkbox. Omit to hide the control. */
  onToggleModule?: (moduleKey: string, codes: string[], select: boolean) => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  defaultCollapsedModuleKeys?: string[];
  className?: string;
}

function moduleCodes(mod: PermissionMatrixModule): string[] {
  return mod.subgroups.flatMap((g) => g.items.map((i) => i.code));
}

function moduleSelectedCount(mod: PermissionMatrixModule): number {
  return mod.subgroups.reduce((n, g) => n + g.items.filter((i) => i.selected).length, 0);
}

function matchesSearch(item: PermissionMatrixItem, query: string): boolean {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  return item.label.toLowerCase().includes(q) || item.code.toLowerCase().includes(q);
}

export function PermissionMatrix({
  modules,
  onToggle,
  onToggleModule,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  defaultCollapsedModuleKeys = [],
  className,
}: PermissionMatrixProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const key of defaultCollapsedModuleKeys) initial[key] = true;
    return initial;
  });

  const query = searchValue ?? "";

  const filteredModules = useMemo(() => {
    if (!query.trim()) return modules;
    return modules
      .map((mod) => ({
        ...mod,
        subgroups: mod.subgroups
          .map((g) => ({ ...g, items: g.items.filter((i) => matchesSearch(i, query)) }))
          .filter((g) => g.items.length > 0),
      }))
      .filter((mod) => mod.subgroups.length > 0);
  }, [modules, query]);

  return (
    <div className={cn("w-full", className)}>
      {onSearchChange ? (
        <div className="mb-[14px] flex min-w-[240px] items-center gap-[9px] rounded-md border border-border bg-surface px-[13px] py-[9px] focus-within:border-brand">
          <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[15px] w-[15px] flex-none text-ink-faint">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
            <path d="m17 17-4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder ?? t("permissions.searchPlaceholder")}
            aria-label={searchPlaceholder ?? t("permissions.searchPlaceholder")}
            className="w-full border-none bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-[12px]">
        {filteredModules.map((mod) => {
          const total = moduleCodes(mod).length;
          const selectedCount = moduleSelectedCount(mod);
          const isCollapsed = collapsed[mod.key] ?? false;
          const allSelected = total > 0 && selectedCount === total;
          const someSelected = selectedCount > 0 && !allSelected;

          return (
            <Card key={mod.key} className="overflow-hidden">
              <div className="flex items-center gap-[10px] border-b border-border bg-surface-2 px-[15px] py-[11px]">
                {onToggleModule ? (
                  <input
                    type="checkbox"
                    aria-label={t("permissions.selectAllIn", { module: mod.label })}
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={() => onToggleModule(mod.key, moduleCodes(mod), !allSelected)}
                    className="h-[15px] w-[15px] flex-none accent-brand"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => setCollapsed((prev) => ({ ...prev, [mod.key]: !isCollapsed }))}
                  aria-expanded={!isCollapsed}
                  className="flex flex-1 items-center justify-between gap-[8px] text-start"
                >
                  <span className="text-[13.5px] font-bold text-ink">{mod.label}</span>
                  <span className="flex items-center gap-[8px]">
                    <span
                      className={cn(
                        "mz-num rounded-pill px-[9px] py-[2px] text-[11px] font-semibold",
                        selectedCount > 0 ? "bg-brand-soft text-brand" : "bg-surface-3 text-ink-faint",
                      )}
                    >
                      {selectedCount} / {total}
                    </span>
                    <svg
                      aria-hidden
                      viewBox="0 0 12 12"
                      fill="none"
                      className={cn("h-[11px] w-[11px] text-ink-faint transition-transform", isCollapsed && "-rotate-90")}
                    >
                      <path d="M3 4.5 6 8l3-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>
              </div>

              {isCollapsed ? null : (
                <div className="flex flex-col gap-[14px] p-[15px]">
                  {mod.subgroups.map((group) => (
                    <div key={group.key}>
                      <div className="mb-[8px] text-[11px] font-bold uppercase tracking-[0.4px] text-ink-faint">
                        {group.label}
                      </div>
                      <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-2">
                        {group.items.map((item) => (
                          <PermissionCard key={item.code} item={item} onToggle={onToggle} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}

        {filteredModules.length === 0 ? (
          <div className="p-8 text-center text-sm text-ink-muted">{t("permissions.empty")}</div>
        ) : null}
      </div>
    </div>
  );
}

function PermissionCard({ item, onToggle }: { item: PermissionMatrixItem; onToggle: (code: string) => void }) {
  const { t } = useTranslation();
  return (
    <label
      data-permission-code={item.code}
      className={cn(
        "flex items-start gap-[9px] rounded-md border px-[11px] py-[9px] transition-colors",
        item.selected ? "border-brand bg-brand-soft" : "border-border bg-surface hover:border-border-strong",
        item.sensitive && "ring-1 ring-inset ring-warning",
        item.disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
      )}
      title={item.disabled ? item.disabledReason : undefined}
    >
      <input
        type="checkbox"
        checked={item.selected}
        disabled={item.disabled}
        onChange={() => onToggle(item.code)}
        className="mt-[2px] h-[15px] w-[15px] flex-none accent-brand"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="flex flex-wrap items-center gap-[6px]">
          <span className="text-[12.5px] font-semibold text-ink">{item.label}</span>
          {item.sensitive ? (
            <span aria-label={t("permissions.sensitive")} title={t("permissions.sensitive")} className="text-[11px] text-warning-ink">
              ⚠
            </span>
          ) : null}
          {item.platformAdminOnly ? (
            <span className="rounded-pill bg-surface-3 px-[6px] py-[1px] text-[9.5px] font-bold text-ink-faint">
              {t("permissions.platformAdminOnly")}
            </span>
          ) : null}
        </span>
        <span className="mz-lat font-mono text-[10.5px] text-ink-faint">{item.code}</span>
        {item.dependsOn && item.dependsOn.length > 0 ? (
          <span className="text-[10.5px] text-ink-faint">
            {t("permissions.dependsOn")} <span className="mz-lat font-mono">{item.dependsOn.join(t("permissions.dependsOnSeparator"))}</span>
          </span>
        ) : null}
      </span>
    </label>
  );
}
