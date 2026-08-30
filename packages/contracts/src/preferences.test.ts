import { describe, it, expect } from "vitest";
import {
  numeralSystemSchema,
  pinnedScreenSchema,
  recentRecordSchema,
  dashboardWidgetSchema,
  dashboardLayoutSchema,
  shortcutTileSchema,
  tableColumnPreferenceSchema,
  tableViewPreferenceSchema,
  preferenceSectionSchema,
  customizedSectionsSchema,
  userPreferencesSchema,
  putUserPreferencesSchema,
  patchUserPreferencesSchema,
  resetUserPreferencesSchema,
  recordRecentSchema,
  userPreferencesSummarySchema,
} from "./preferences.js";

describe("numeralSystemSchema", () => {
  it("accepts western and arabic", () => {
    expect(numeralSystemSchema.safeParse("western").success).toBe(true);
    expect(numeralSystemSchema.safeParse("arabic").success).toBe(true);
  });

  it("rejects a value outside the enum", () => {
    expect(numeralSystemSchema.safeParse("hindi").success).toBe(false);
  });
});

describe("preferenceSectionSchema", () => {
  it("accepts each known section", () => {
    for (const s of ["layoutName", "numerals", "rail", "pins", "recents", "dashboard", "shortcuts", "tables"]) {
      expect(preferenceSectionSchema.safeParse(s).success).toBe(true);
    }
  });

  it("rejects a section outside the enum", () => {
    expect(preferenceSectionSchema.safeParse("theme").success).toBe(false);
  });
});

describe("shortcutTileSchema", () => {
  const tile = { id: "tile-1", route: "/sales/invoices/new", labelAr: "فاتورة جديدة", order: 0 };

  it("accepts a minimal valid tile and defaults labelEn/icon/tone", () => {
    const result = shortcutTileSchema.safeParse(tile);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.labelEn).toBe("");
      expect(result.data.tone).toBeNull();
    }
  });

  it("REJECTS an unrecognised key", () => {
    const result = shortcutTileSchema.safeParse({ ...tile, branchId: "branch-1" });
    expect(result.success).toBe(false);
  });
});

describe("tableViewPreferenceSchema", () => {
  it("accepts a minimal valid view with every optional field defaulted to null", () => {
    const result = tableViewPreferenceSchema.safeParse({ tableId: "sales-invoice-list", columns: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sortKey).toBeNull();
      expect(result.data.density).toBeNull();
    }
  });

  it("rejects an out-of-enum density", () => {
    const result = tableViewPreferenceSchema.safeParse({ tableId: "sales-invoice-list", columns: [], density: "spacious" });
    expect(result.success).toBe(false);
  });
});

describe("pinnedScreenSchema — a .strict() schema, unlike most other contracts in this codebase", () => {
  const pin = { id: "pin-1", route: "/sales/invoices", labelAr: "فواتير البيع", order: 0, pinnedAt: "2026-08-30T10:00:00.000Z" };

  it("accepts a minimal valid pin and defaults labelEn/icon/group", () => {
    const result = pinnedScreenSchema.safeParse(pin);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.labelEn).toBe("");
      expect(result.data.icon).toBeNull();
      expect(result.data.group).toBeNull();
    }
  });

  it("REJECTS an unrecognised key with a loud failure — .strict() never silently drops a dimension", () => {
    const result = pinnedScreenSchema.safeParse({ ...pin, branchId: "branch-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a pin missing route", () => {
    const { route, ...rest } = pin;
    const result = pinnedScreenSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.flatten().fieldErrors).toHaveProperty("route");
  });

  it("rejects a negative order", () => {
    const result = pinnedScreenSchema.safeParse({ ...pin, order: -1 });
    expect(result.success).toBe(false);
  });
});

describe("recentRecordSchema", () => {
  const record = {
    id: "rec-1",
    route: "/sales/invoices/inv-1",
    entityType: "SALES_INVOICE",
    entityId: "inv-1",
    labelAr: "فاتورة SI-2026-001",
    openedAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid record and defaults optional fields", () => {
    const result = recentRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.documentNumber).toBeNull();
      expect(result.data.branchId).toBeNull();
    }
  });

  it("rejects an unrecognised key", () => {
    const result = recentRecordSchema.safeParse({ ...record, costCenterId: "cc-1" });
    expect(result.success).toBe(false);
  });
});

describe("dashboardWidgetSchema", () => {
  const widget = { id: "w-1", kind: "kpi", column: 0, order: 0, size: "md" as const, visible: true };

  it("accepts a minimal valid widget and defaults settings to {}", () => {
    const result = dashboardWidgetSchema.safeParse(widget);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.settings).toEqual({});
  });

  it("accepts an open settings record", () => {
    const result = dashboardWidgetSchema.safeParse({ ...widget, settings: { dateRange: "last_30_days" } });
    expect(result.success).toBe(true);
  });

  it("rejects an out-of-enum size", () => {
    const result = dashboardWidgetSchema.safeParse({ ...widget, size: "xl" });
    expect(result.success).toBe(false);
  });

  it("rejects an unrecognised key", () => {
    const result = dashboardWidgetSchema.safeParse({ ...widget, extra: true });
    expect(result.success).toBe(false);
  });
});

describe("dashboardLayoutSchema", () => {
  it("accepts a minimal valid layout", () => {
    const result = dashboardLayoutSchema.safeParse({ columns: 3, widgets: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a columns count outside 1-4", () => {
    expect(dashboardLayoutSchema.safeParse({ columns: 0, widgets: [] }).success).toBe(false);
    expect(dashboardLayoutSchema.safeParse({ columns: 5, widgets: [] }).success).toBe(false);
  });
});

describe("tableColumnPreferenceSchema", () => {
  it("accepts a minimal valid column and defaults widthPx/pinned to null", () => {
    const result = tableColumnPreferenceSchema.safeParse({ key: "amount", visible: true, order: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.widthPx).toBeNull();
      expect(result.data.pinned).toBeNull();
    }
  });

  it("rejects a zero or negative widthPx when supplied", () => {
    const result = tableColumnPreferenceSchema.safeParse({ key: "amount", visible: true, order: 0, widthPx: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum pinned value", () => {
    const result = tableColumnPreferenceSchema.safeParse({ key: "amount", visible: true, order: 0, pinned: "middle" });
    expect(result.success).toBe(false);
  });
});

describe("customizedSectionsSchema", () => {
  it("accepts a minimal valid payload with every section flagged", () => {
    const sections = { layoutName: false, numerals: false, rail: true, pins: false, recents: false, dashboard: false, shortcuts: false, tables: false };
    const result = customizedSectionsSchema.safeParse(sections);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(sections);
  });

  it("rejects a payload missing tables", () => {
    const result = customizedSectionsSchema.safeParse({ layoutName: false, numerals: false, rail: false, pins: false, recents: false, dashboard: false, shortcuts: false });
    expect(result.success).toBe(false);
  });
});

describe("userPreferencesSchema", () => {
  const prefs = {
    userId: "user-1",
    layoutName: "default",
    numerals: null,
    railCollapsed: false,
    pinnedScreens: [],
    recentRecords: [],
    dashboard: { columns: 3, widgets: [] },
    shortcutTiles: [],
    tableViews: [],
    isDefault: true,
    customized: { layoutName: false, numerals: false, rail: false, pins: false, recents: false, dashboard: false, shortcuts: false, tables: false },
    stored: false,
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid payload and preserves every field verbatim", () => {
    const result = userPreferencesSchema.safeParse(prefs);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(prefs);
  });

  it("silently strips an unrecognised key — this response schema is a plain object, not .strict() like the write schemas", () => {
    const result = userPreferencesSchema.safeParse({ ...prefs, unknownField: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty("unknownField");
  });
});

describe("putUserPreferencesSchema", () => {
  it("accepts a minimal valid payload and defaults every omitted section", () => {
    const result = putUserPreferencesSchema.safeParse({ layoutName: "default" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.railCollapsed).toBe(false);
      expect(result.data.pinnedScreens).toEqual([]);
      expect(result.data.dashboard).toEqual({ columns: 3, widgets: [] });
    }
  });

  it("ACCEPTS server-owned keys on a round trip (GET-edit-PUT) rather than rejecting them", () => {
    const result = putUserPreferencesSchema.safeParse({
      layoutName: "default",
      userId: "user-1",
      isDefault: true,
      stored: true,
      createdAt: "2026-08-30T10:00:00.000Z",
      updatedAt: "2026-08-30T10:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("REJECTS a genuinely unrecognised key — .strict() plus explicit server-owned keys, not a silent strip", () => {
    const result = putUserPreferencesSchema.safeParse({ layoutName: "default", costCenterId: "cc-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a layoutName longer than 60 characters", () => {
    const result = putUserPreferencesSchema.safeParse({ layoutName: "x".repeat(61) });
    expect(result.success).toBe(false);
  });

  it("rejects more than 20 pinned screens", () => {
    const pins = Array.from({ length: 21 }, (_, i) => ({
      id: `pin-${i}`,
      route: `/route-${i}`,
      labelAr: "شاشة",
      order: i,
      pinnedAt: "2026-08-30T10:00:00.000Z",
    }));
    const result = putUserPreferencesSchema.safeParse({ layoutName: "default", pinnedScreens: pins });
    expect(result.success).toBe(false);
  });
});

describe("patchUserPreferencesSchema", () => {
  it("accepts a single-field patch, e.g. just collapsing the rail", () => {
    const result = patchUserPreferencesSchema.safeParse({ railCollapsed: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ railCollapsed: true });
  });

  it("accepts an empty payload", () => {
    const result = patchUserPreferencesSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("REJECTS a genuinely unrecognised key", () => {
    const result = patchUserPreferencesSchema.safeParse({ branchId: "branch-1" });
    expect(result.success).toBe(false);
  });
});

describe("resetUserPreferencesSchema", () => {
  it("defaults scope to 'all' and tableId to null", () => {
    const result = resetUserPreferencesSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scope).toBe("all");
      expect(result.data.tableId).toBeNull();
    }
  });

  it("accepts a single-section scope", () => {
    const result = resetUserPreferencesSchema.safeParse({ scope: "pins" });
    expect(result.success).toBe(true);
  });

  it("accepts a tables scope narrowed to one tableId", () => {
    const result = resetUserPreferencesSchema.safeParse({ scope: "tables", tableId: "sales-invoice-list" });
    expect(result.success).toBe(true);
  });

  it("rejects a scope outside 'all' or the known sections", () => {
    const result = resetUserPreferencesSchema.safeParse({ scope: "everything" });
    expect(result.success).toBe(false);
  });
});

describe("recordRecentSchema", () => {
  it("accepts a payload with openedAt omitted — the server stamps it", () => {
    const record = { id: "rec-1", route: "/sales/invoices/inv-1", entityType: "SALES_INVOICE", entityId: "inv-1", labelAr: "فاتورة" };
    const result = recordRecentSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it("REJECTS an unrecognised key", () => {
    const record = { id: "rec-1", route: "/x", entityType: "SALES_INVOICE", entityId: "inv-1", labelAr: "فاتورة", costCenterId: "cc-1" };
    const result = recordRecentSchema.safeParse(record);
    expect(result.success).toBe(false);
  });
});

describe("userPreferencesSummarySchema", () => {
  const summary = {
    userId: "user-1",
    fullName: "محمد الشهابي",
    layoutName: "default",
    isDefault: false,
    stored: true,
    pinnedCount: 3,
    shortcutCount: 5,
    tableViewCount: 2,
    updatedAt: "2026-08-30T10:00:00.000Z",
  };

  it("accepts a minimal valid summary and preserves every field verbatim", () => {
    const result = userPreferencesSummarySchema.safeParse(summary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(summary);
  });

  it("rejects a summary missing pinnedCount", () => {
    const { pinnedCount, ...rest } = summary;
    const result = userPreferencesSummarySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
