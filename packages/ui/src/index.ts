// Tokens: import "@mezan/ui/styles.css" once near the app root.

export { cn, type ClassValue } from "./lib/cn";
export {
  WorkspaceHub,
  type WorkspaceHubProps,
  type WorkspaceHubStat,
  type WorkspaceHubRow,
  type WorkspaceHubList,
} from "./primitives/WorkspaceHub";
export { FOCUSABLE_SELECTOR, useFocusTrap, type FocusTrapOptions } from "./hooks/useFocusTrap";
export {
  LIST_NAV_EVENT,
  emitListNav,
  isHelpKey,
  latinLetter,
  type ListNavAction,
  type ListNavDetail,
} from "./lib/keys";
export {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatQty,
  formatTime,
  toArabicDigits,
  type DateFormatStyle,
  type NumeralSystem,
} from "./lib/format";

export { useFormat, NumeralsProvider, type UseFormatOptions, type UseFormatResult } from "./hooks/useFormat";
export { useTheme, type ThemePreference, type UseThemeResult } from "./hooks/useTheme";

export {
  DEFAULT_LOCALE,
  I18nProvider,
  LOCALES,
  LOCALE_ENDONYM,
  LOCALE_SHORT_LABEL,
  directionOf,
  humanizeKey,
  interpolate,
  isLocale,
  loadPersistedLocale,
  mergeCatalogs,
  persistLocale,
  translate,
  uiCatalogs,
  useTranslation,
  useUiTranslation,
  type Direction,
  type I18nContextValue,
  type I18nProviderProps,
  type Locale,
  type LocaleCatalogs,
  type MissingKeyReporter,
  type Translate,
  type TranslationCatalog,
  type TranslationParams,
  type UiI18nContextValue,
  type UiTranslationKey,
} from "./i18n";

export {
  Button,
  IconButton,
  Card,
  StatusPill,
  Chip,
  Money,
  Qty,
  StatCard,
  EmptyState,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  type IconButtonProps,
  type PillTone,
  type StatusPillProps,
  type ChipProps,
  type MoneyProps,
  type QtyProps,
  type StatCardProps,
  type EmptyStateProps,
  type EmptyStateVariant,
  Segmented,
  type SegmentedProps,
  type SegmentedOption,
} from "./primitives/atoms";

export {
  ListViews,
  type ListView,
  type ListViewsProps,
  AppliedFilters,
  type AppliedFilter,
  type AppliedFiltersProps,
} from "./primitives/ListViews";

export {
  ToastProvider,
  useToast,
  useOptionalToast,
  type ToastTone,
  type ToastUndoAction,
  type ToastInput,
  type ToastContextValue,
  type ToastProviderProps,
  ConfirmDialog,
  type ConfirmDialogTone,
  type ConfirmDialogProps,
  Skeleton,
  type SkeletonProps,
  SkeletonTable,
  type SkeletonTableProps,
} from "./primitives/feedback";

export {
  MicroBeam,
  VarianceBeam,
  beamDirectionOf,
  type BeamDirection,
  type MicroBeamProps,
  type VarianceBeamProps,
} from "./primitives/beams";

export {
  DocumentList,
  type DocumentListProps,
  type DocumentListColumn,
  type DocumentListStat,
  type DocumentListAttentionBanner,
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

export { Kbd, modKeyLabel, type KbdProps, type KbdTone } from "./primitives/Kbd";
export { SidePanel, type SidePanelProps } from "./primitives/SidePanel";
export { MoneyInput, type MoneyInputProps } from "./primitives/MoneyInput";
export { QtyInput, type QtyInputProps } from "./primitives/QtyInput";
export { EntityPicker, type EntityPickerProps, type EntityPickerOption } from "./primitives/EntityPicker";
export { RowMenu } from "./primitives/RowMenu";
export type { RowMenuItem, RowMenuItemConfirm, RowMenuProps } from "./primitives/RowMenu";
export { Select, type SelectProps, type SelectOption, type SelectSize, type SelectVariant } from "./primitives/Select";
export {
  Field,
  TextInput,
  TextArea,
  Checkbox,
  SearchInput,
  Switch,
  controlClassName,
  type FieldProps,
  type TextInputProps,
  type TextAreaProps,
  type CheckboxProps,
  type SearchInputProps,
  type SwitchProps,
  type ControlSize,
} from "./primitives/form";
export {
  DateRangeFilter,
  type DateRangeFilterProps,
  type DateRangePreset,
  type DateRange,
} from "./primitives/DateRangeFilter";
export { AccountTree, type AccountTreeProps, type AccountTreeColumnLabels, type AccountTreeRow } from "./primitives/AccountTree";
export { DisclosureChevron, type DisclosureChevronProps } from "./primitives/DisclosureChevron";
export {
  PermissionMatrix,
  type PermissionMatrixProps,
  type PermissionMatrixModule,
  type PermissionMatrixSubgroup,
  type PermissionMatrixItem,
} from "./primitives/PermissionMatrix";

export { AppShell, type AppShellProps } from "./shell/AppShell";
export { type TopbarScopeOption } from "./shell/ScopeSwitcher";
export { type ShellNotification } from "./shell/NotificationsPanel";
export { CommandBar, type CommandBarProps } from "./shell/CommandBar";
export {
  NotificationsPanel,
  type NotificationsPanelProps,
  type NotificationPanelItem,
} from "./shell/NotificationsPanel";
export { BrandMark } from "./shell/BrandMark";
export { Copyright } from "./shell/Copyright";
export type { NavGroup, NavItem, NavSection, NavTag, NavVisibility, ShellUser, CommandItem, UserMenuItem } from "./shell/types";
export { navGroupItems, filterNavGroups, isNavItemVisible, WILDCARD_NAV_PERMISSION } from "./shell/types";

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
  type ReportRunnerKpi,
  type ReportRunnerSummary,
  type ReportRunnerColumnFormat,
  type ReportRunnerParamField,
  type ReportRunnerGroup,
  type ReportRunnerReconciliation,
  type ReportRunnerResult,
  type ReportRunnerEntityRef,
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
  buildDataMigrationTemplate,
  parseDataMigrationFile,
  type DataMigrationColumn,
  type DataMigrationStepSpec,
  type DataMigrationParseError,
  type DataMigrationParseResult,
} from "./lib/data-migration-file";

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
  type PrintLedgerColumn,
  type PrintLedgerRow,
  type PrintLedgerFooterRow,
  type PrintLedgerBody,
} from "./print/types";
export { PrintView, type PrintViewProps } from "./print/PrintView";
export { useElectronPrintToPdf, type PrintToPdfOptions, type UseElectronPrintToPdfResult } from "./print/useElectronPrintToPdf";
export { useElectronSavePdf, type SavePdfOptions, type SavePdfOutcome, type UseElectronSavePdfResult } from "./print/useElectronSavePdf";
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

export { ReportChart, type ReportChartProps, type ReportChartPoint, type ReportChartView } from "./primitives/ReportChart";
export {
  Balance,
  type BalanceProps,
  type BalanceEqualProps,
  type BalanceCeilingProps,
  type BalanceMode,
  type BalanceSide,
} from "./primitives/Balance";
