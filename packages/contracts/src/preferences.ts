import { z } from "zod";

/**
 * Wire contract for per-user shell preferences (pins, recents, rail state,
 * dashboard layout, shortcut tiles, chosen table columns, numeral system).
 *
 * Every field the shell will need is declared HERE, up front. A zod object
 * strips keys it does not declare, so a dimension the client sends but the
 * contract omits vanishes behind a cheerful 200 — that is how a voucher's cost
 * centre and a payment's withholding disappeared. The write schemas below are
 * therefore `.strict()`: an unrecognised key is a loud 400, never a silent
 * drop.
 */

export const numeralSystemSchema = z.enum(["western", "arabic"]);

export const pinnedScreenSchema = z
  .object({
    id: z.string().min(1),
    route: z.string().min(1),
    labelAr: z.string().min(1),
    labelEn: z.string().default(""),
    icon: z.string().nullable().default(null),
    group: z.string().nullable().default(null),
    order: z.number().int().min(0),
    pinnedAt: z.string().min(1),
  })
  .strict();

export const recentRecordSchema = z
  .object({
    id: z.string().min(1),
    route: z.string().min(1),
    /** Domain entity type, e.g. "SALES_INVOICE". */
    entityType: z.string().min(1),
    /** The REAL domain id of the record, not a label. */
    entityId: z.string().min(1),
    labelAr: z.string().min(1),
    labelEn: z.string().default(""),
    documentNumber: z.string().nullable().default(null),
    icon: z.string().nullable().default(null),
    branchId: z.string().nullable().default(null),
    openedAt: z.string().min(1),
  })
  .strict();

export const dashboardWidgetSizeSchema = z.enum(["sm", "md", "lg", "full"]);

export const dashboardWidgetSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    column: z.number().int().min(0),
    order: z.number().int().min(0),
    size: dashboardWidgetSizeSchema,
    visible: z.boolean(),
    /** Per-widget configuration (date range, account filter…) — deliberately open. */
    settings: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const dashboardLayoutSchema = z
  .object({
    columns: z.number().int().min(1).max(4),
    widgets: z.array(dashboardWidgetSchema),
  })
  .strict();

export const shortcutTileSchema = z
  .object({
    id: z.string().min(1),
    route: z.string().min(1),
    labelAr: z.string().min(1),
    labelEn: z.string().default(""),
    icon: z.string().nullable().default(null),
    /** Colour-token name, never a literal colour. */
    tone: z.string().nullable().default(null),
    order: z.number().int().min(0),
  })
  .strict();

export const tableColumnPreferenceSchema = z
  .object({
    key: z.string().min(1),
    visible: z.boolean(),
    order: z.number().int().min(0),
    widthPx: z.number().int().positive().nullable().default(null),
    pinned: z.enum(["start", "end"]).nullable().default(null),
  })
  .strict();

export const tableViewPreferenceSchema = z
  .object({
    tableId: z.string().min(1),
    columns: z.array(tableColumnPreferenceSchema),
    sortKey: z.string().nullable().default(null),
    sortDirection: z.enum(["asc", "desc"]).nullable().default(null),
    pageSize: z.number().int().positive().nullable().default(null),
    density: z.enum(["comfortable", "compact"]).nullable().default(null),
  })
  .strict();

export const preferenceSectionSchema = z.enum([
  "layoutName",
  "numerals",
  "rail",
  "pins",
  "recents",
  "dashboard",
  "shortcuts",
  "tables",
]);

/** Which sections differ from the shipped default — drives the per-screen «استعادة الوضع الافتراضي» control. */
export const customizedSectionsSchema = z.object({
  layoutName: z.boolean(),
  numerals: z.boolean(),
  rail: z.boolean(),
  pins: z.boolean(),
  recents: z.boolean(),
  dashboard: z.boolean(),
  shortcuts: z.boolean(),
  tables: z.boolean(),
});

/** Response shape. `numerals: null` means "inherit the tenant's settings.dateNumerals". */
export const userPreferencesSchema = z.object({
  userId: z.string().min(1),
  layoutName: z.string().min(1),
  numerals: numeralSystemSchema.nullable(),
  railCollapsed: z.boolean(),
  pinnedScreens: z.array(pinnedScreenSchema),
  recentRecords: z.array(recentRecordSchema),
  dashboard: dashboardLayoutSchema,
  shortcutTiles: z.array(shortcutTileSchema),
  tableViews: z.array(tableViewPreferenceSchema),
  isDefault: z.boolean(),
  customized: customizedSectionsSchema,
  /** False when no row has ever been written — the response is the materialised default. */
  stored: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Read-only keys the server computes. A GET→edit→PUT round trip sends them
 * back, so they are ACCEPTED and ignored rather than rejected by `.strict()`.
 */
const serverOwnedKeys = {
  userId: z.string().optional(),
  isDefault: z.boolean().optional(),
  customized: customizedSectionsSchema.partial().optional(),
  stored: z.boolean().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
};

/** Full replace. Any section omitted falls back to the shipped default for that section. */
export const putUserPreferencesSchema = z
  .object({
    layoutName: z.string().min(1).max(60),
    numerals: numeralSystemSchema.nullable().default(null),
    railCollapsed: z.boolean().default(false),
    pinnedScreens: z.array(pinnedScreenSchema).max(20).default([]),
    recentRecords: z.array(recentRecordSchema).max(20).default([]),
    dashboard: dashboardLayoutSchema.default({ columns: 3, widgets: [] }),
    shortcutTiles: z.array(shortcutTileSchema).max(12).default([]),
    tableViews: z.array(tableViewPreferenceSchema).default([]),
    ...serverOwnedKeys,
  })
  .strict();

/** Partial update — the shape a single toggle (rail collapse, one table's columns) sends. */
export const patchUserPreferencesSchema = z
  .object({
    layoutName: z.string().min(1).max(60).optional(),
    numerals: numeralSystemSchema.nullable().optional(),
    railCollapsed: z.boolean().optional(),
    pinnedScreens: z.array(pinnedScreenSchema).max(20).optional(),
    recentRecords: z.array(recentRecordSchema).max(20).optional(),
    dashboard: dashboardLayoutSchema.optional(),
    shortcutTiles: z.array(shortcutTileSchema).max(12).optional(),
    tableViews: z.array(tableViewPreferenceSchema).optional(),
    ...serverOwnedKeys,
  })
  .strict();

/** `tableId` narrows a `tables` reset to ONE list surface, which is what a per-screen reset control does. */
export const resetUserPreferencesSchema = z
  .object({
    scope: z.union([z.literal("all"), preferenceSectionSchema]).default("all"),
    tableId: z.string().min(1).nullable().default(null),
  })
  .strict();

/** One opened record; `openedAt` is stamped by the server when omitted. */
export const recordRecentSchema = recentRecordSchema
  .omit({ openedAt: true })
  .extend({ openedAt: z.string().min(1).optional() })
  .strict();

/** Admin diagnosis row — who has customised what, without opening each layout. */
export const userPreferencesSummarySchema = z.object({
  userId: z.string(),
  fullName: z.string().nullable(),
  layoutName: z.string(),
  isDefault: z.boolean(),
  stored: z.boolean(),
  pinnedCount: z.number().int(),
  shortcutCount: z.number().int(),
  tableViewCount: z.number().int(),
  updatedAt: z.string(),
});

export type NumeralSystemDTO = z.infer<typeof numeralSystemSchema>;
export type PinnedScreenDTO = z.infer<typeof pinnedScreenSchema>;
export type RecentRecordDTO = z.infer<typeof recentRecordSchema>;
export type DashboardWidgetDTO = z.infer<typeof dashboardWidgetSchema>;
export type DashboardLayoutDTO = z.infer<typeof dashboardLayoutSchema>;
export type ShortcutTileDTO = z.infer<typeof shortcutTileSchema>;
export type TableColumnPreferenceDTO = z.infer<typeof tableColumnPreferenceSchema>;
export type TableViewPreferenceDTO = z.infer<typeof tableViewPreferenceSchema>;
export type PreferenceSectionDTO = z.infer<typeof preferenceSectionSchema>;
export type CustomizedSectionsDTO = z.infer<typeof customizedSectionsSchema>;
export type UserPreferencesDTO = z.infer<typeof userPreferencesSchema>;
export type PutUserPreferencesDTO = z.infer<typeof putUserPreferencesSchema>;
export type PatchUserPreferencesDTO = z.infer<typeof patchUserPreferencesSchema>;
export type ResetUserPreferencesDTO = z.infer<typeof resetUserPreferencesSchema>;
export type RecordRecentDTO = z.infer<typeof recordRecentSchema>;
export type UserPreferencesSummaryDTO = z.infer<typeof userPreferencesSummarySchema>;
