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

export {
  DocumentStatusStepper,
  type DocumentStatusStepperProps,
  type DocumentStatusStep,
} from "./primitives/DocumentStatusStepper";

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
export { AccountTree, type AccountTreeProps, type AccountTreeRow } from "./primitives/AccountTree";
export {
  PermissionMatrix,
  type PermissionMatrixProps,
  type PermissionMatrixModule,
  type PermissionMatrixSubgroup,
  type PermissionMatrixItem,
} from "./primitives/PermissionMatrix";

export { AppShell, type AppShellProps } from "./shell/AppShell";
export { Sidebar, type SidebarProps } from "./shell/Sidebar";
export { Topbar, type TopbarProps, type ShellNotification } from "./shell/Topbar";
export { CommandPalette, type CommandPaletteProps } from "./shell/CommandPalette";
export { BrandMark } from "./shell/BrandMark";
export type { NavGroup, NavItem, NavTag, ShellUser, CommandItem } from "./shell/types";

export {
  TrendChart,
  DonutChart,
  type TrendChartProps,
  type TrendChartSeries,
  type DonutChartProps,
  type DonutSegment,
  type ChartRangeOption,
} from "./primitives/charts";

export {
  ReportRunner,
  type ReportRunnerProps,
  type ReportRunnerColumn,
  type ReportRunnerColumnFormat,
  type ReportRunnerParamField,
  type ReportRunnerGroup,
  type ReportRunnerReconciliation,
  type ReportRunnerResult,
} from "./primitives/ReportRunner";

export {
  buildReportExport,
  downloadReportExport,
  type ReportExportColumn,
  type ReportExportFormat,
  type ReportExportFile,
  type BuildReportExportOptions,
} from "./lib/report-export";

export {
  buildHistoricalImportTemplate,
  parseHistoricalImportFile,
  type HistoricalImportFileDocType,
  type ParsedHistoricalImportRow,
  type HistoricalImportParseError,
  type HistoricalImportParseResult,
} from "./lib/historical-import-file";

export {
  DEFAULT_PRINT_TEMPLATE_CONFIG,
  resolvePrintTemplateConfig,
  type PrintTemplateConfig,
  type PrintTemplateOverride,
  type PrintPageSize,
  type LogoPosition,
  type LogoSize,
  type PrintIdentityConfig,
  type PrintHeaderConfig,
  type PrintContentConfig,
  type PrintColumnsConfig,
  type PrintTotalsConfig,
  type PrintFooterConfig,
  type PrintWatermarkConfig,
  type PrintPosReceiptConfig,
  type PrintCompanyInfo,
  type PrintPartyInfo,
  type PrintDocumentLine,
  type PrintTaxBreakdownRow,
  type PrintDocumentTotals,
  type PrintDocumentModel,
} from "./print/types";
export { PrintView, type PrintViewProps } from "./print/PrintView";
export { useElectronPrintToPdf, type PrintToPdfOptions, type UseElectronPrintToPdfResult } from "./print/useElectronPrintToPdf";
export { PrintToolbar } from "./print/PrintToolbar";
export { Barcode128, encodeCode128B, type Barcode128Props } from "./print/Barcode128";
export {
  LabelSheetView,
  trimMoneyString,
  type LabelSheetLayout,
  type LabelSheetEntry,
  type LabelSheetViewProps,
} from "./print/LabelSheetView";
export { createSampleInvoiceDocument } from "./print/sample-invoice";
