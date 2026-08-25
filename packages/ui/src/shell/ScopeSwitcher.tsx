import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Select } from "../primitives/Select";
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
 * Collapsed, the trigger is the icon alone and the chosen scope moves to the
 * title attribute, so the rail stays 30px wide without hiding the value.
 */
function RailScopeSelect({ ariaLabel, value, onChange, allLabel, options, icon, expanded }: RailScopeSelectProps) {
  const selectedLabel = (value ? options.find((opt) => opt.id === value)?.label : null) ?? allLabel;

  return (
    <div title={expanded ? undefined : `${ariaLabel}: ${selectedLabel}`} className={expanded ? "w-full" : "w-[30px]"}>
      <Select<string>
        variant="chrome"
        size="sm"
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(next) => onChange?.(next === "" ? null : next)}
        options={[{ value: "", label: allLabel }, ...options.map((opt) => ({ value: opt.id, label: opt.label }))]}
        leadingIcon={icon}
        chevron={expanded}
        renderValue={expanded ? undefined : () => null}
        className={cn(!expanded && "[&>button]:h-[30px] [&>button]:w-[30px] [&>button]:justify-center [&>button]:px-0")}
      />
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
