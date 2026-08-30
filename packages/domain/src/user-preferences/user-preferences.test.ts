import { describe, expect, it } from "vitest";
import {
  createDefaultUserPreferences,
  customizedSections,
  isDefaultUserPreferences,
  recordRecentlyOpened,
  resetUserPreferences,
  updateUserPreferences,
  validateUserPreferences,
  InvalidUserPreferencesError,
  DEFAULT_LAYOUT_NAME,
  RECENT_RECORDS_LIMIT,
  type UserPreferences,
  type RecentRecord,
  type PinnedScreen,
  type DashboardWidget,
} from "./user-preferences.js";

function fixedNow(iso: string) {
  return () => new Date(iso);
}

function preferencesFor(userId: string): UserPreferences {
  return createDefaultUserPreferences(userId, fixedNow("2026-01-01T00:00:00.000Z"));
}

function pin(overrides: Partial<PinnedScreen> = {}): PinnedScreen {
  return {
    id: "pin-1",
    route: "#/sales-invoices",
    labelAr: "فواتير المبيعات",
    labelEn: "Sales Invoices",
    icon: null,
    group: "sales",
    order: 0,
    pinnedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function recent(overrides: Partial<RecentRecord> = {}): RecentRecord {
  return {
    id: "r-1",
    route: "#/sales-invoices/INV-1",
    entityType: "SALES_INVOICE",
    entityId: "INV-1",
    labelAr: "فاتورة INV-1",
    labelEn: "Invoice INV-1",
    documentNumber: "INV-000001",
    icon: null,
    branchId: "BR1",
    openedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function widget(overrides: Partial<DashboardWidget> = {}): DashboardWidget {
  return {
    id: "w-1",
    kind: "cash-summary",
    column: 0,
    order: 0,
    size: "md",
    visible: true,
    settings: {},
    ...overrides,
  };
}

describe("createDefaultUserPreferences", () => {
  it("invents nothing — every list is empty, the rail is open, numerals inherit", () => {
    const prefs = preferencesFor("user-1");
    expect(prefs).toEqual({
      userId: "user-1",
      layoutName: DEFAULT_LAYOUT_NAME,
      numerals: null,
      railCollapsed: false,
      pinnedScreens: [],
      recentRecords: [],
      dashboard: { columns: 3, widgets: [] },
      shortcutTiles: [],
      tableViews: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(validateUserPreferences(prefs)).toEqual([]);
  });

  it("scopes strictly to the given userId — two users never share the same default object", () => {
    const a = preferencesFor("user-a");
    const b = preferencesFor("user-b");
    expect(a.userId).toBe("user-a");
    expect(b.userId).toBe("user-b");
    // Mutating one user's arrays must never reach the other's.
    (a.pinnedScreens as PinnedScreen[]).push(pin());
    expect(b.pinnedScreens).toEqual([]);
  });
});

describe("validateUserPreferences", () => {
  it("rejects an empty or overlong layout name", () => {
    const prefs = { ...preferencesFor("u1"), layoutName: "   " };
    expect(validateUserPreferences(prefs)).toContain("layoutName must not be empty");

    const tooLong = { ...preferencesFor("u1"), layoutName: "x".repeat(61) };
    expect(validateUserPreferences(tooLong)[0]).toMatch(/at most 60/);
  });

  it("rejects a dashboard column count outside 1..4", () => {
    const prefs = { ...preferencesFor("u1"), dashboard: { columns: 0, widgets: [] } };
    expect(validateUserPreferences(prefs)).toContain("dashboard.columns must be between 1 and 4");
    const prefs2 = { ...preferencesFor("u1"), dashboard: { columns: 5, widgets: [] } };
    expect(validateUserPreferences(prefs2)).toContain("dashboard.columns must be between 1 and 4");
    const ok = { ...preferencesFor("u1"), dashboard: { columns: 4, widgets: [] } };
    expect(validateUserPreferences(ok)).toEqual([]);
  });

  it("rejects duplicate pinnedScreens ids", () => {
    const prefs = { ...preferencesFor("u1"), pinnedScreens: [pin({ id: "p1" }), pin({ id: "p1", order: 1 })] };
    expect(validateUserPreferences(prefs).some((r) => r.includes("duplicate pinnedScreens"))).toBe(true);
  });

  it("rejects duplicate dashboard widget ids", () => {
    const prefs = {
      ...preferencesFor("u1"),
      dashboard: { columns: 3, widgets: [widget({ id: "w1" }), widget({ id: "w1", order: 1 })] },
    };
    expect(validateUserPreferences(prefs).some((r) => r.includes("duplicate dashboard widget"))).toBe(true);
  });

  it("rejects a table view with every column hidden", () => {
    const prefs = {
      ...preferencesFor("u1"),
      tableViews: [
        {
          tableId: "sales-invoices",
          columns: [
            { key: "docNo", visible: false, order: 0, widthPx: null, pinned: null as const },
            { key: "total", visible: false, order: 1, widthPx: null, pinned: null as const },
          ],
          sortKey: null,
          sortDirection: null,
          pageSize: null,
          density: null,
        },
      ],
    };
    expect(
      validateUserPreferences(prefs).some((r) => r.includes("must keep at least one visible column")),
    ).toBe(true);
  });

  it("accepts a table view with at least one visible column", () => {
    const prefs = {
      ...preferencesFor("u1"),
      tableViews: [
        {
          tableId: "sales-invoices",
          columns: [
            { key: "docNo", visible: true, order: 0, widthPx: null, pinned: null as const },
            { key: "total", visible: false, order: 1, widthPx: null, pinned: null as const },
          ],
          sortKey: "docNo",
          sortDirection: "asc" as const,
          pageSize: 25,
          density: "compact" as const,
        },
      ],
    };
    expect(validateUserPreferences(prefs)).toEqual([]);
  });
});

describe("updateUserPreferences — partial patch semantics", () => {
  it("an empty patch changes nothing except updatedAt", () => {
    const created = preferencesFor("u1");
    const withPins = updateUserPreferences(
      created,
      { pinnedScreens: [pin()], shortcutTiles: [], railCollapsed: true },
      fixedNow("2026-01-02T00:00:00.000Z"),
    );
    const untouched = updateUserPreferences(withPins, {}, fixedNow("2026-01-03T00:00:00.000Z"));
    expect(untouched.pinnedScreens).toEqual(withPins.pinnedScreens);
    expect(untouched.railCollapsed).toBe(true);
    expect(untouched.layoutName).toBe(withPins.layoutName);
    expect(untouched.updatedAt).toBe("2026-01-03T00:00:00.000Z");
  });

  it("patching ONE section leaves every other section exactly as it was — the class bug this code must not have", () => {
    const created = preferencesFor("u1");
    const withEverything = updateUserPreferences(
      created,
      {
        pinnedScreens: [pin({ id: "p1" })],
        recentRecords: [recent({ id: "r1" })],
        shortcutTiles: [
          { id: "s1", route: "#/pos", labelAr: "نقطة بيع", labelEn: "POS", icon: null, tone: "teal", order: 0 },
        ],
        dashboard: { columns: 2, widgets: [widget({ id: "w1" })] },
        tableViews: [
          {
            tableId: "items",
            columns: [{ key: "code", visible: true, order: 0, widthPx: 80, pinned: "start" }],
            sortKey: null,
            sortDirection: null,
            pageSize: 50,
            density: "comfortable",
          },
        ],
        railCollapsed: true,
        numerals: "arabic",
        layoutName: "تخطيطي",
      },
      fixedNow("2026-01-02T00:00:00.000Z"),
    );

    // Now patch ONLY railCollapsed. Every other section must survive untouched.
    const afterRailFlip = updateUserPreferences(
      withEverything,
      { railCollapsed: false },
      fixedNow("2026-01-03T00:00:00.000Z"),
    );

    expect(afterRailFlip.railCollapsed).toBe(false);
    expect(afterRailFlip.layoutName).toBe("تخطيطي");
    expect(afterRailFlip.numerals).toBe("arabic");
    expect(afterRailFlip.pinnedScreens).toEqual(withEverything.pinnedScreens);
    expect(afterRailFlip.recentRecords).toEqual(withEverything.recentRecords);
    expect(afterRailFlip.shortcutTiles).toEqual(withEverything.shortcutTiles);
    expect(afterRailFlip.dashboard).toEqual(withEverything.dashboard);
    expect(afterRailFlip.tableViews).toEqual(withEverything.tableViews);
  });

  it("a NULL patch value is applied (clearing numerals), unlike an undefined one", () => {
    const created = updateUserPreferences(preferencesFor("u1"), { numerals: "arabic" });
    const cleared = updateUserPreferences(created, { numerals: null });
    expect(cleared.numerals).toBeNull();
  });

  it("rejects the merged RESULT, not the patch alone — a patch that is individually fine but produces an invalid whole is refused", () => {
    const withOnePin = updateUserPreferences(preferencesFor("u1"), { pinnedScreens: [pin({ id: "p1" })] });
    expect(() =>
      updateUserPreferences(withOnePin, { pinnedScreens: [...withOnePin.pinnedScreens, pin({ id: "p1", order: 1 })] }),
    ).toThrow(InvalidUserPreferencesError);
  });

  it("throwing leaves the caller's object untouched", () => {
    const created = preferencesFor("u1");
    const snapshot = JSON.parse(JSON.stringify(created));
    expect(() => updateUserPreferences(created, { layoutName: "   " })).toThrow(InvalidUserPreferencesError);
    expect(JSON.parse(JSON.stringify(created))).toEqual(snapshot);
  });

  it("carries the exact reasons on the thrown error", () => {
    const created = preferencesFor("u1");
    try {
      updateUserPreferences(created, { layoutName: "" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidUserPreferencesError);
      expect((err as InvalidUserPreferencesError).reasons).toContain("layoutName must not be empty");
    }
  });
});

describe("recordRecentlyOpened", () => {
  it("prepends the new record ahead of older ones", () => {
    const withOne = updateUserPreferences(preferencesFor("u1"), {
      recentRecords: [recent({ id: "r1", entityId: "INV-1", openedAt: "2026-01-01T00:00:00.000Z" })],
    });
    const withTwo = recordRecentlyOpened(
      withOne,
      recent({ id: "r2", entityId: "INV-2", openedAt: "2026-01-02T00:00:00.000Z" }),
      fixedNow("2026-01-02T00:00:00.000Z"),
    );
    expect(withTwo.recentRecords.map((r) => r.entityId)).toEqual(["INV-2", "INV-1"]);
  });

  it("deduplicates on (entityType, entityId), keeping only the newest occurrence", () => {
    const withOne = updateUserPreferences(preferencesFor("u1"), {
      recentRecords: [recent({ id: "r1", entityId: "INV-1", openedAt: "2026-01-01T00:00:00.000Z" })],
    });
    const reopened = recordRecentlyOpened(
      withOne,
      recent({ id: "r2", entityId: "INV-1", documentNumber: "INV-000001-updated", openedAt: "2026-01-03T00:00:00.000Z" }),
      fixedNow("2026-01-03T00:00:00.000Z"),
    );
    expect(reopened.recentRecords).toHaveLength(1);
    expect(reopened.recentRecords[0]!.id).toBe("r2");
    expect(reopened.recentRecords[0]!.documentNumber).toBe("INV-000001-updated");
  });

  it("caps at RECENT_RECORDS_LIMIT, dropping the oldest", () => {
    let prefs = preferencesFor("u1");
    for (let i = 0; i < RECENT_RECORDS_LIMIT + 5; i += 1) {
      prefs = recordRecentlyOpened(
        prefs,
        recent({
          id: `r${i}`,
          entityId: `INV-${i}`,
          openedAt: `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
        }),
        fixedNow("2026-01-01T00:00:00.000Z"),
      );
    }
    expect(prefs.recentRecords).toHaveLength(RECENT_RECORDS_LIMIT);
    // Newest (highest index) survive; the oldest were dropped.
    expect(prefs.recentRecords[0]!.entityId).toBe(`INV-${RECENT_RECORDS_LIMIT + 4}`);
    expect(prefs.recentRecords.map((r) => r.entityId)).not.toContain("INV-0");
  });
});

describe("resetUserPreferences", () => {
  function customized(): UserPreferences {
    return updateUserPreferences(
      preferencesFor("u1"),
      {
        layoutName: "تخطيطي المخصص",
        numerals: "arabic",
        railCollapsed: true,
        pinnedScreens: [pin({ id: "p1" })],
        recentRecords: [recent({ id: "r1" })],
        dashboard: { columns: 4, widgets: [widget({ id: "w1" })] },
        shortcutTiles: [
          { id: "s1", route: "#/pos", labelAr: "نقطة بيع", labelEn: "POS", icon: null, tone: "teal", order: 0 },
        ],
        tableViews: [
          {
            tableId: "items",
            columns: [{ key: "code", visible: true, order: 0, widthPx: null, pinned: null }],
            sortKey: null,
            sortDirection: null,
            pageSize: null,
            density: null,
          },
          {
            tableId: "sales-invoices",
            columns: [{ key: "docNo", visible: true, order: 0, widthPx: null, pinned: null }],
            sortKey: null,
            sortDirection: null,
            pageSize: null,
            density: null,
          },
        ],
      },
      fixedNow("2026-01-02T00:00:00.000Z"),
    );
  }

  it("scope 'all' resets every section but keeps createdAt and the userId", () => {
    const before = customized();
    const reset = resetUserPreferences(before, "all", {}, fixedNow("2026-01-05T00:00:00.000Z"));
    expect(reset.userId).toBe("u1");
    expect(reset.createdAt).toBe(before.createdAt);
    expect(reset.layoutName).toBe(DEFAULT_LAYOUT_NAME);
    expect(reset.pinnedScreens).toEqual([]);
    expect(reset.dashboard).toEqual({ columns: 3, widgets: [] });
    expect(isDefaultUserPreferences(reset)).toBe(true);
  });

  it("scope 'pins' resets ONLY the pins, leaving every other customized section intact", () => {
    const before = customized();
    const reset = resetUserPreferences(before, "pins", {}, fixedNow("2026-01-05T00:00:00.000Z"));
    expect(reset.pinnedScreens).toEqual([]);
    expect(reset.layoutName).toBe(before.layoutName);
    expect(reset.dashboard).toEqual(before.dashboard);
    expect(reset.tableViews).toEqual(before.tableViews);
  });

  it("scope 'tables' with a tableId removes only that one table's view", () => {
    const before = customized();
    const reset = resetUserPreferences(before, "tables", { tableId: "items" }, fixedNow("2026-01-05T00:00:00.000Z"));
    expect(reset.tableViews.map((v) => v.tableId)).toEqual(["sales-invoices"]);
  });

  it("scope 'tables' with no tableId clears every table view", () => {
    const before = customized();
    const reset = resetUserPreferences(before, "tables", {}, fixedNow("2026-01-05T00:00:00.000Z"));
    expect(reset.tableViews).toEqual([]);
  });
});

describe("customizedSections / isDefaultUserPreferences", () => {
  it("reports nothing customized on a fresh default", () => {
    const prefs = preferencesFor("u1");
    expect(isDefaultUserPreferences(prefs)).toBe(true);
    expect(customizedSections(prefs)).toEqual({
      layoutName: false,
      numerals: false,
      rail: false,
      pins: false,
      recents: false,
      dashboard: false,
      shortcuts: false,
      tables: false,
    });
  });

  it("flags exactly the section that changed", () => {
    const withPins = updateUserPreferences(preferencesFor("u1"), { pinnedScreens: [pin()] });
    const sections = customizedSections(withPins);
    expect(sections.pins).toBe(true);
    expect(sections.recents).toBe(false);
    expect(sections.dashboard).toBe(false);
    expect(isDefaultUserPreferences(withPins)).toBe(false);
  });

  it("flags the dashboard as customized when only the column count changed, even with no widgets", () => {
    const withColumns = updateUserPreferences(preferencesFor("u1"), { dashboard: { columns: 2, widgets: [] } });
    expect(customizedSections(withColumns).dashboard).toBe(true);
  });
});
