import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import type { TopbarScopeOption } from "./Topbar";

interface RailScopeSelectProps {
  ariaLabel: string;
  value: string | null;
  onChange?: (id: string | null) => void;
  allLabel: string;
  options: readonly TopbarScopeOption[];
  icon: ReactNode;
  expanded: boolean;
}

/**
 * One working-scope dropdown (branch or warehouse), pinned to the rail top.
 * Still a native `<select>` — real listbox semantics, full keyboard support,
 * and the option list stays screen-reader legible even when the rail is
 * collapsed and the trigger itself is rendered icon-only.
 */
function RailScopeSelect({ ariaLabel, value, onChange, allLabel, options, icon, expanded }: RailScopeSelectProps) {
  const selectedLabel = (value ? options.find((opt) => opt.id === value)?.label : null) ?? allLabel;

  return (
    <div
      className={cn(
        "relative flex items-center gap-[8px] rounded-md border border-chrome-border bg-chrome-hover text-sm font-medium text-chrome-ink transition-colors hover:border-chrome-accent",
        expanded ? "w-full px-[11px] py-[8px]" : "h-[30px] w-[30px] justify-center p-0",
      )}
      title={expanded ? undefined : `${ariaLabel}: ${selectedLabel}`}
    >
      {icon}
      <select
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value === "" ? null : event.target.value)}
        className={cn(
          "cursor-pointer appearance-none bg-transparent text-sm font-medium",
          expanded ? "min-w-0 flex-1 truncate pe-[14px] text-chrome-ink" : "absolute inset-0 text-transparent",
        )}
      >
        <option value="" className="bg-surface text-ink">
          {allLabel}
        </option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id} className="bg-surface text-ink">
            {opt.label}
          </option>
        ))}
      </select>
      {expanded ? (
        <svg aria-hidden viewBox="0 0 12 12" fill="none" className="pointer-events-none absolute end-[8px] h-[9px] w-[9px] opacity-70">
          <path d="M3 4.5 6 8l3-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </div>
  );
}

const BRANCH_ICON = (
  <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[13px] w-[13px] flex-none text-chrome-ink-muted">
    <path
      d="M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1V8.5Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

const WAREHOUSE_ICON = (
  <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-[13px] w-[13px] flex-none text-chrome-ink-muted">
    <rect x="3" y="7" width="14" height="9" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2.5 7 10 3l7.5 4" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);

export interface ScopeSwitchersProps {
  expanded: boolean;
  branchAriaLabel: string;
  warehouseAriaLabel: string;
  branchOptions?: readonly TopbarScopeOption[];
  warehouseOptions?: readonly TopbarScopeOption[];
  selectedBranchId?: string | null;
  selectedWarehouseId?: string | null;
  onSelectBranch?: (branchId: string | null) => void;
  onSelectWarehouse?: (warehouseId: string | null) => void;
  allBranchesLabel: string;
  allWarehousesLabel: string;
}

/** Branch + warehouse narrowing controls, pinned above the nav (spec §5). Renders nothing when the caller has no branch options — never with a fabricated list. */
export function ScopeSwitchers({
  expanded,
  branchAriaLabel,
  warehouseAriaLabel,
  branchOptions,
  warehouseOptions = [],
  selectedBranchId = null,
  selectedWarehouseId = null,
  onSelectBranch,
  onSelectWarehouse,
  allBranchesLabel,
  allWarehousesLabel,
}: ScopeSwitchersProps) {
  if (!branchOptions || branchOptions.length === 0) return null;

  return (
    <div
      className={cn(
        "flex flex-none flex-col gap-[6px]",
        expanded ? "mx-[12px] mb-[10px]" : "mx-auto mb-[10px] items-center",
      )}
    >
      <RailScopeSelect
        ariaLabel={branchAriaLabel}
        value={selectedBranchId}
        onChange={onSelectBranch}
        allLabel={allBranchesLabel}
        options={branchOptions}
        icon={BRANCH_ICON}
        expanded={expanded}
      />
      <RailScopeSelect
        ariaLabel={warehouseAriaLabel}
        value={selectedWarehouseId}
        onChange={onSelectWarehouse}
        allLabel={allWarehousesLabel}
        options={warehouseOptions}
        icon={WAREHOUSE_ICON}
        expanded={expanded}
      />
    </div>
  );
}
