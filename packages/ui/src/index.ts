// Tokens: import "@mezan/ui/styles.css" once near the app root.

export { cn, type ClassValue } from "./lib/cn";
export {
  formatDate,
  formatMoney,
  formatNumber,
  toArabicDigits,
  type DateFormatStyle,
  type NumeralSystem,
} from "./lib/format";

export { useFormat, type UseFormatOptions, type UseFormatResult } from "./hooks/useFormat";
export { useTheme, type ThemePreference, type UseThemeResult } from "./hooks/useTheme";

export {
  Button,
  IconButton,
  Card,
  StatusPill,
  Chip,
  Money,
  StatCard,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  type IconButtonProps,
  type PillTone,
  type StatusPillProps,
  type ChipProps,
  type MoneyProps,
  type StatCardProps,
} from "./primitives/atoms";

export {
  DocumentList,
  type DocumentListProps,
  type DocumentListColumn,
  type DocumentListStat,
  type DocumentListStatusChip,
  type DocumentListSort,
} from "./primitives/DocumentList";

export {
  DocumentDetail,
  type DocumentDetailProps,
  type DocumentDetailSummaryItem,
  type DocumentDetailTab,
} from "./primitives/DocumentDetail";

export { SidePanel, type SidePanelProps } from "./primitives/SidePanel";
export { MoneyInput, type MoneyInputProps } from "./primitives/MoneyInput";
export { QtyInput, type QtyInputProps } from "./primitives/QtyInput";
export { EntityPicker, type EntityPickerProps, type EntityPickerOption } from "./primitives/EntityPicker";
export {
  DateRangeFilter,
  type DateRangeFilterProps,
  type DateRangePreset,
  type DateRange,
} from "./primitives/DateRangeFilter";

export { AppShell, type AppShellProps } from "./shell/AppShell";
export { Sidebar, type SidebarProps } from "./shell/Sidebar";
export { Topbar, type TopbarProps } from "./shell/Topbar";
export { CommandPalette, type CommandPaletteProps } from "./shell/CommandPalette";
export { BrandMark } from "./shell/BrandMark";
export type { NavGroup, NavItem, NavTag, ShellUser, CommandItem } from "./shell/types";
