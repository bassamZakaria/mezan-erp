/**
 * Per-user shell preferences — the personalisation that used to live in the
 * browser's `localStorage` (pins, recents, rail state, dashboard layout,
 * shortcut tiles, chosen table columns, numeral system). Pure domain: no I/O,
 * mirroring `../barcode-config/barcode-config.ts`'s
 * default/validate/update shape.
 *
 * Scope is the USER. There is no tenant column anywhere in this codebase —
 * one database file is one tenant (see `packages/persistence/src/*-store.ts`,
 * where the only per-user table, `notification`, likewise keys on the user id
 * alone), so a per-user row is already per-tenant.
 *
 * Nothing here is a preference the user cannot see: a layout carries a
 * human-readable NAME so a support caller can read it aloud, and every section
 * can be reset back to the shipped default server-side.
 */

import { splitReasons, type ReasonInput } from "../bilingual-reasons.js";
import type { BilingualReason } from "../collections/errors.js";
import type { NumeralSystem } from "../settings/settings.js";

/** A screen the user pinned to the rail. `route` is the shell's hash route. */
export interface PinnedScreen {
  readonly id: string;
  readonly route: string;
  readonly labelAr: string;
  readonly labelEn: string;
  readonly icon: string | null;
  /** Nav group the screen came from, so the rail can keep pins grouped. */
  readonly group: string | null;
  readonly order: number;
  readonly pinnedAt: string;
}

/**
 * A record the user opened. `entityType` + `entityId` are the REAL domain ids
 * (`SALES_INVOICE` / `INV-DEMO-1`), never a label: a recents list that stores
 * only a caption cannot reopen the document it names.
 */
export interface RecentRecord {
  readonly id: string;
  readonly route: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly labelAr: string;
  readonly labelEn: string;
  readonly documentNumber: string | null;
  readonly icon: string | null;
  readonly branchId: string | null;
  readonly openedAt: string;
}

export type DashboardWidgetSize = "sm" | "md" | "lg" | "full";

export interface DashboardWidget {
  readonly id: string;
  /** Widget catalog code the dashboard resolves to a component. */
  readonly kind: string;
  readonly column: number;
  readonly order: number;
  readonly size: DashboardWidgetSize;
  readonly visible: boolean;
  /** Per-widget configuration (date range, account filter…), opaque here. */
  readonly settings: Readonly<Record<string, unknown>>;
}

export interface DashboardLayout {
  readonly columns: number;
  readonly widgets: readonly DashboardWidget[];
}

export interface ShortcutTile {
  readonly id: string;
  readonly route: string;
  readonly labelAr: string;
  readonly labelEn: string;
  readonly icon: string | null;
  /** Colour-token name, never a literal colour. */
  readonly tone: string | null;
  readonly order: number;
}

export type ColumnPin = "start" | "end" | null;

export interface TableColumnPreference {
  readonly key: string;
  readonly visible: boolean;
  readonly order: number;
  readonly widthPx: number | null;
  readonly pinned: ColumnPin;
}

export type TableDensity = "comfortable" | "compact";

/** One list surface's chosen columns, sort and density. `tableId` is the screen's stable table key. */
export interface TableViewPreference {
  readonly tableId: string;
  readonly columns: readonly TableColumnPreference[];
  readonly sortKey: string | null;
  readonly sortDirection: "asc" | "desc" | null;
  readonly pageSize: number | null;
  readonly density: TableDensity | null;
}

export interface UserPreferences {
  readonly userId: string;
  /** Human-readable layout name — support reads this aloud on the phone. */
  readonly layoutName: string;
  /** `null` inherits the tenant's `settings.dateNumerals`; a value overrides it. */
  readonly numerals: NumeralSystem | null;
  readonly railCollapsed: boolean;
  readonly pinnedScreens: readonly PinnedScreen[];
  readonly recentRecords: readonly RecentRecord[];
  readonly dashboard: DashboardLayout;
  readonly shortcutTiles: readonly ShortcutTile[];
  readonly tableViews: readonly TableViewPreference[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The sections a «استعادة الوضع الافتراضي» control can reset independently. */
export const PREFERENCE_SECTIONS = [
  "layoutName",
  "numerals",
  "rail",
  "pins",
  "recents",
  "dashboard",
  "shortcuts",
  "tables",
] as const;

export type PreferenceSection = (typeof PREFERENCE_SECTIONS)[number];

export type ResetScope = "all" | PreferenceSection;

/** Which sections differ from the shipped default — drives whether a screen's reset control is live. */
export type CustomizedSections = Readonly<Record<PreferenceSection, boolean>>;

export const DEFAULT_LAYOUT_NAME = "التخطيط الافتراضي";

/**
 * Caps. A recents list is appended to on every navigation, so it must be
 * bounded server-side; an unbounded pin list would push the rail off screen.
 */
export const RECENT_RECORDS_LIMIT = 20;
export const PINNED_SCREENS_LIMIT = 20;
export const SHORTCUT_TILES_LIMIT = 12;
export const LAYOUT_NAME_MAX_LENGTH = 60;

export class InvalidUserPreferencesError extends Error {
  readonly code = "INVALID_USER_PREFERENCES";
  readonly messageEn: string;
  readonly reasons: string[];
  constructor(reasons: readonly ReasonInput[]) {
    const split = splitReasons(reasons, "the user preferences are invalid");
    super(split.ar.join("، "));
    this.reasons = [...split.ar];
    this.messageEn = split.en;
    this.name = "InvalidUserPreferencesError";
  }
}

/**
 * The shipped default: nothing pinned, nothing recent, the rail open, the
 * dashboard on the tenant's own default arrangement, numerals inherited.
 *
 * Deliberately EMPTY rather than plausible — an invented pin is
 * indistinguishable from one the user set and then lost.
 */
export function createDefaultUserPreferences(userId: string, now: () => Date = () => new Date()): UserPreferences {
  const timestamp = now().toISOString();
  return {
    userId,
    layoutName: DEFAULT_LAYOUT_NAME,
    numerals: null,
    railCollapsed: false,
    pinnedScreens: [],
    recentRecords: [],
    dashboard: { columns: 3, widgets: [] },
    shortcutTiles: [],
    tableViews: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Every mutable section of {@link UserPreferences}; `undefined` leaves a section untouched. */
export interface UserPreferencesPatch {
  readonly layoutName?: string;
  readonly numerals?: NumeralSystem | null;
  readonly railCollapsed?: boolean;
  readonly pinnedScreens?: readonly PinnedScreen[];
  readonly recentRecords?: readonly RecentRecord[];
  readonly dashboard?: DashboardLayout;
  readonly shortcutTiles?: readonly ShortcutTile[];
  readonly tableViews?: readonly TableViewPreference[];
}

function duplicates(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

export function validateUserPreferences(preferences: UserPreferences): readonly BilingualReason[] {
  const reasons: BilingualReason[] = [];
  const name = preferences.layoutName.trim();
  if (name.length === 0) reasons.push({ ar: "اسم التخطيط مطلوب", en: "The layout name is required" });
  if (name.length > LAYOUT_NAME_MAX_LENGTH) {
    reasons.push({ ar: `اسم التخطيط يجب ألا يتجاوز ${LAYOUT_NAME_MAX_LENGTH} حرفاً`, en: `The layout name must be at most ${LAYOUT_NAME_MAX_LENGTH} characters` });
  }
  if (preferences.pinnedScreens.length > PINNED_SCREENS_LIMIT) {
    reasons.push({ ar: `الشاشات المثبّتة يجب ألا تتجاوز ${PINNED_SCREENS_LIMIT} شاشة`, en: `You can pin at most ${PINNED_SCREENS_LIMIT} screens` });
  }
  if (preferences.shortcutTiles.length > SHORTCUT_TILES_LIMIT) {
    reasons.push({ ar: `بطاقات الاختصار يجب ألا تتجاوز ${SHORTCUT_TILES_LIMIT} بطاقة`, en: `You can add at most ${SHORTCUT_TILES_LIMIT} shortcut tiles` });
  }
  if (preferences.dashboard.columns < 1 || preferences.dashboard.columns > 4) {
    reasons.push({ ar: "عدد أعمدة لوحة المعلومات يجب أن يكون بين 1 و4", en: "The number of dashboard columns must be between 1 and 4" });
  }
  const pinDupes = duplicates(preferences.pinnedScreens.map((pin) => pin.id));
  if (pinDupes.length > 0) reasons.push({ ar: `معرّفات الشاشات المثبّتة مكررة: ${pinDupes.join("، ")}`, en: `Some pinned screens are repeated: ${pinDupes.join(", ")}` });
  const widgetDupes = duplicates(preferences.dashboard.widgets.map((widget) => widget.id));
  if (widgetDupes.length > 0) reasons.push({ ar: `معرّفات عناصر لوحة المعلومات مكررة: ${widgetDupes.join("، ")}`, en: `Some dashboard widgets are repeated: ${widgetDupes.join(", ")}` });
  const tileDupes = duplicates(preferences.shortcutTiles.map((tile) => tile.id));
  if (tileDupes.length > 0) reasons.push({ ar: `معرّفات بطاقات الاختصار مكررة: ${tileDupes.join("، ")}`, en: `Some shortcut tiles are repeated: ${tileDupes.join(", ")}` });
  const tableDupes = duplicates(preferences.tableViews.map((view) => view.tableId));
  if (tableDupes.length > 0) reasons.push({ ar: `معرّفات الجداول في العروض المحفوظة مكررة: ${tableDupes.join("، ")}`, en: `Some tables have more than one saved view entry: ${tableDupes.join(", ")}` });
  for (const view of preferences.tableViews) {
    const columnDupes = duplicates(view.columns.map((column) => column.key));
    if (columnDupes.length > 0) {
      reasons.push({ ar: `مفاتيح الأعمدة مكررة في الجدول '${view.tableId}': ${columnDupes.join("، ")}`, en: `Some columns are repeated in table '${view.tableId}': ${columnDupes.join(", ")}` });
    }
    if (view.columns.every((column) => !column.visible) && view.columns.length > 0) {
      reasons.push({ ar: `الجدول '${view.tableId}' يجب أن يُبقي عموداً ظاهراً واحداً على الأقل`, en: `Table '${view.tableId}' must keep at least one visible column` });
    }
  }
  return reasons;
}

/**
 * Newest first, deduplicated on (entityType, entityId), capped — the shape
 * the recents menu renders directly.
 *
 * The comparator returns 0 on a tie (same `openedAt` instant — a real case:
 * a client-stamped timestamp, or two opens within one clock tick) so
 * `Array.prototype.sort`'s stability keeps the pre-sort order, which already
 * has the newest call FIRST (`recordRecentlyOpened` prepends). A comparator
 * that never returns 0 is not antisymmetric on a tie and silently lets the
 * engine's sort put either side first — the dedupe below would then keep
 * whichever one that was, not necessarily the newer one.
 */
function trimRecents(records: readonly RecentRecord[]): readonly RecentRecord[] {
  const seen = new Set<string>();
  const kept: RecentRecord[] = [];
  for (const record of [...records].sort((a, b) => (a.openedAt === b.openedAt ? 0 : a.openedAt < b.openedAt ? 1 : -1))) {
    const key = `${record.entityType}::${record.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(record);
    if (kept.length >= RECENT_RECORDS_LIMIT) break;
  }
  return kept;
}

function normalize(preferences: UserPreferences): UserPreferences {
  return {
    ...preferences,
    layoutName: preferences.layoutName.trim(),
    pinnedScreens: [...preferences.pinnedScreens].sort((a, b) => a.order - b.order),
    recentRecords: trimRecents(preferences.recentRecords),
    shortcutTiles: [...preferences.shortcutTiles].sort((a, b) => a.order - b.order),
    dashboard: {
      ...preferences.dashboard,
      widgets: [...preferences.dashboard.widgets].sort(
        (a, b) => a.column - b.column || a.order - b.order,
      ),
    },
    tableViews: preferences.tableViews.map((view) => ({
      ...view,
      columns: [...view.columns].sort((a, b) => a.order - b.order),
    })),
  };
}

/** Applies a patch, validates the RESULT (never the patch alone), and stamps `updatedAt`. */
export function updateUserPreferences(
  current: UserPreferences,
  patch: UserPreferencesPatch,
  now: () => Date = () => new Date(),
): UserPreferences {
  const merged: UserPreferences = {
    ...current,
    layoutName: patch.layoutName ?? current.layoutName,
    numerals: patch.numerals === undefined ? current.numerals : patch.numerals,
    railCollapsed: patch.railCollapsed ?? current.railCollapsed,
    pinnedScreens: patch.pinnedScreens ?? current.pinnedScreens,
    recentRecords: patch.recentRecords ?? current.recentRecords,
    dashboard: patch.dashboard ?? current.dashboard,
    shortcutTiles: patch.shortcutTiles ?? current.shortcutTiles,
    tableViews: patch.tableViews ?? current.tableViews,
    updatedAt: now().toISOString(),
  };
  const reasons = validateUserPreferences(merged);
  if (reasons.length > 0) throw new InvalidUserPreferencesError(reasons);
  return normalize(merged);
}

/**
 * Pushes one opened record onto the recents list. Server-side so the cap and
 * the dedupe hold even when two tabs navigate at once — a client that rewrote
 * the whole array would lose the other tab's entry.
 */
export function recordRecentlyOpened(
  current: UserPreferences,
  record: RecentRecord,
  now: () => Date = () => new Date(),
): UserPreferences {
  return updateUserPreferences(current, { recentRecords: [record, ...current.recentRecords] }, now);
}

/**
 * Resets one section (or everything) to the shipped default. A real server
 * operation: a client-side clear leaves the stored row intact, so the next
 * device to sync puts the old layout straight back.
 */
export function resetUserPreferences(
  current: UserPreferences,
  scope: ResetScope,
  options: { readonly tableId?: string | null } = {},
  now: () => Date = () => new Date(),
): UserPreferences {
  const defaults = createDefaultUserPreferences(current.userId, now);
  const stamped = { createdAt: current.createdAt, updatedAt: now().toISOString() };
  switch (scope) {
    case "all":
      return { ...defaults, ...stamped };
    case "layoutName":
      return { ...current, layoutName: defaults.layoutName, ...stamped };
    case "numerals":
      return { ...current, numerals: defaults.numerals, ...stamped };
    case "rail":
      return { ...current, railCollapsed: defaults.railCollapsed, ...stamped };
    case "pins":
      return { ...current, pinnedScreens: defaults.pinnedScreens, ...stamped };
    case "recents":
      return { ...current, recentRecords: defaults.recentRecords, ...stamped };
    case "dashboard":
      return { ...current, dashboard: defaults.dashboard, ...stamped };
    case "shortcuts":
      return { ...current, shortcutTiles: defaults.shortcutTiles, ...stamped };
    case "tables":
      return {
        ...current,
        // A per-screen reset control resets ONLY its own table; omitting
        // tableId is the settings-screen "reset every table" action.
        tableViews: options.tableId
          ? current.tableViews.filter((view) => view.tableId !== options.tableId)
          : defaults.tableViews,
        ...stamped,
      };
  }
}

/** Section-by-section diff against the shipped default. */
export function customizedSections(preferences: UserPreferences): CustomizedSections {
  const defaults = createDefaultUserPreferences(preferences.userId);
  return {
    layoutName: preferences.layoutName !== defaults.layoutName,
    numerals: preferences.numerals !== defaults.numerals,
    rail: preferences.railCollapsed !== defaults.railCollapsed,
    pins: preferences.pinnedScreens.length > 0,
    recents: preferences.recentRecords.length > 0,
    dashboard:
      preferences.dashboard.widgets.length > 0 || preferences.dashboard.columns !== defaults.dashboard.columns,
    shortcuts: preferences.shortcutTiles.length > 0,
    tables: preferences.tableViews.length > 0,
  };
}

/** True when nothing has been customised — the reset control has nothing to undo. */
export function isDefaultUserPreferences(preferences: UserPreferences): boolean {
  return Object.values(customizedSections(preferences)).every((changed) => !changed);
}

/**
 * Recovers a stored row that does not (or no longer) shape up as a valid
 * {@link UserPreferences} — a row written before a section existed, one
 * hand-edited in the database, or one carrying a value a later validation
 * rule now rejects. Missing/wrong-typed sections fall back to the shipped
 * default for THAT section only; if the merged result still fails
 * `validateUserPreferences`, the whole row degrades to the plain default.
 *
 * Never throws. Without this a shape drift in stored data (a field added to
 * {@link UserPreferences} after rows already existed) turns the self-service
 * `GET /preferences` into a 500 for every user whose row predates the field,
 * rather than the empty-but-usable layout a first-time user gets.
 */
export function sanitizeStoredUserPreferences(
  userId: string,
  stored: unknown,
  now: () => Date = () => new Date(),
): UserPreferences {
  const defaults = createDefaultUserPreferences(userId, now);
  if (!stored || typeof stored !== "object") return defaults;
  const raw = stored as Partial<UserPreferences>;
  const dashboard =
    raw.dashboard &&
    typeof raw.dashboard === "object" &&
    typeof raw.dashboard.columns === "number" &&
    Array.isArray(raw.dashboard.widgets)
      ? raw.dashboard
      : defaults.dashboard;
  const candidate: UserPreferences = {
    userId,
    layoutName: typeof raw.layoutName === "string" && raw.layoutName.trim() !== "" ? raw.layoutName : defaults.layoutName,
    numerals: raw.numerals === "western" || raw.numerals === "arabic" ? raw.numerals : null,
    railCollapsed: typeof raw.railCollapsed === "boolean" ? raw.railCollapsed : defaults.railCollapsed,
    pinnedScreens: Array.isArray(raw.pinnedScreens) ? raw.pinnedScreens : defaults.pinnedScreens,
    recentRecords: Array.isArray(raw.recentRecords) ? raw.recentRecords : defaults.recentRecords,
    dashboard,
    shortcutTiles: Array.isArray(raw.shortcutTiles) ? raw.shortcutTiles : defaults.shortcutTiles,
    tableViews: Array.isArray(raw.tableViews) ? raw.tableViews : defaults.tableViews,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : defaults.createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : defaults.updatedAt,
  };
  return validateUserPreferences(candidate).length === 0 ? normalize(candidate) : defaults;
}

export function cloneUserPreferences(source: UserPreferences, targetUserId: string, now: () => Date = () => new Date()): UserPreferences {
  const timestamp = now().toISOString();
  return { ...source, userId: targetUserId, recentRecords: [], createdAt: timestamp, updatedAt: timestamp };
}
