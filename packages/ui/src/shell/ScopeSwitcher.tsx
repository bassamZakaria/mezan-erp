import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Select } from "../primitives/Select";

/** One option in a scope dropdown — a branch or a warehouse the session may see. */
export interface TopbarScopeOption {
  id: string;
  label: string;
}


interface RailScopeSelectProps {
  ariaLabel: string;
  value: string | null;
  onChange?: (id: string | null) => void;
  allLabel: string;
  options: readonly TopbarScopeOption[];
  icon: ReactNode;
  expanded: boolean;
  widthClassName?: string;
  /** Header only: no resting fill, so the scope reads under the search rather than against it. */
  quiet?: boolean;
}

/**
 * The header pair carries no box until it is pointed at. Two filled 172px
 * pills were the heaviest thing on the bar — heavier than the command bar
 * they sit beside — which is backwards: the scope is what you SET once a day,
 * the search is what you USE all day. The fill returns on hover and focus, and
 * `aria-expanded` keeps the gold edge while the menu is open.
 *
 * Each `[&>button]` selector outranks the plain classes `Select` writes on the
 * same element (class + type beats class alone), so this wins regardless of
 * the order Tailwind emits them in.
 */
/* The pair shrinks before the command bar does. Below ~1280 the header runs out
   of room, and a search field squeezed to a stub is worse than a branch name
   that truncates — the value stays readable at 132px for every seeded branch,
   and the full label is in the menu. */
const HEADER_SCOPE_WIDTH = "w-[172px] max-[1280px]:w-[132px]";

const QUIET_TRIGGER =
  "[&>button]:border-transparent [&>button]:bg-transparent " +
  "[&>button:hover]:border-chrome-border [&>button:hover]:bg-chrome-hover " +
  // The global focus ring is `--action` (teal) and `Select` clears the native
  // one, so on the teal chrome a keyboard user saw nothing at all here. Gold is
  // the chrome's own accent, and the pseudo-class has to sit INSIDE the
  // arbitrary selector: `[&>button]:focus-visible:` puts `:focus-visible` on
  // the wrapper, which never receives focus, and the ring stayed transparent.
  "[&>button:focus-visible]:outline-chrome-accent " +
  // Open beats hover: the two selectors are otherwise equally specific, and
  // which one won would be decided by the order Tailwind happened to emit them
  // in — the gold edge lost that race while the pointer rested on the trigger.
  "[&>button[aria-expanded='true']]:border-chrome-accent [&>button[aria-expanded='true']:hover]:border-chrome-accent " +
  "[&>button[aria-expanded='true']]:bg-chrome-hover";

/**
 * One working-scope dropdown (branch or warehouse), pinned to the rail top.
 * Collapsed, the trigger is the icon alone and the chosen scope moves to the
 * title attribute, so the rail stays 30px wide without hiding the value.
 */
function RailScopeSelect({ ariaLabel, value, onChange, allLabel, options, icon, expanded, widthClassName, quiet }: RailScopeSelectProps) {
  const selectedLabel = (value ? options.find((opt) => opt.id === value)?.label : null) ?? allLabel;

  return (
    <div
      title={expanded ? undefined : `${ariaLabel}: ${selectedLabel}`}
      className={widthClassName ?? (expanded ? "w-full" : "w-[30px]")}
    >
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
        className={cn(
          // The top bar's minimum target is `--h-btn` (44px); `Select`'s own
          // size scale tops out at 38, so the trigger is raised here rather
          // than in the primitive every screen shares.
          "[&>button]:min-h-[var(--h-btn)]",
          quiet && QUIET_TRIGGER,
          !expanded && "[&>button]:h-[30px] [&>button]:w-[30px] [&>button]:justify-center [&>button]:px-0",
        )}
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
  /** Rail-only: the collapsed rail shows icon-only triggers. The header always renders full triggers. */
  expanded?: boolean;
  /** "header" lays the two selects out side by side on the topbar chrome. */
  orientation?: "rail" | "header";
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

/** Branch + warehouse narrowing controls, on the topbar chrome. Renders nothing when the caller has no branch options — never with a fabricated list. */
export function ScopeSwitchers({
  expanded = true,
  orientation = "rail",
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

  const header = orientation === "header";

  return (
    <div
      className={cn(
        "flex flex-none",
        header
          ? "items-center gap-[8px]"
          : expanded
            ? "mx-[12px] mb-[10px] flex-col gap-[6px]"
            : "mx-auto mb-[10px] flex-col items-center gap-[6px]",
      )}
    >
      <RailScopeSelect
        ariaLabel={branchAriaLabel}
        value={selectedBranchId}
        onChange={onSelectBranch}
        allLabel={allBranchesLabel}
        options={branchOptions}
        icon={BRANCH_ICON}
        expanded={header || expanded}
        quiet={header}
        widthClassName={header ? HEADER_SCOPE_WIDTH : undefined}
      />
      <RailScopeSelect
        ariaLabel={warehouseAriaLabel}
        value={selectedWarehouseId}
        onChange={onSelectWarehouse}
        allLabel={allWarehousesLabel}
        options={warehouseOptions}
        icon={WAREHOUSE_ICON}
        expanded={header || expanded}
        quiet={header}
        widthClassName={header ? HEADER_SCOPE_WIDTH : undefined}
      />
    </div>
  );
}
