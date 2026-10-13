import { describe, it, expect } from "vitest";
import { createDefaultSettings, updateSettings } from "@mezan/domain";
import { createSqliteSettingsStore } from "./settings-store.js";

describe("SqliteSettingsStore", () => {
  it("returns null before any settings are saved", async () => {
    const store = createSqliteSettingsStore();
    try {
      expect(await store.get()).toBeNull();
    } finally {
      store.close();
    }
  });

  it("round-trips a full settings object", async () => {
    const store = createSqliteSettingsStore();
    try {
      const settings = createDefaultSettings({ companyName: "Cyag", defaultTaxRate: 14 });
      await store.save(settings);
      expect(await store.get()).toEqual(settings);
    } finally {
      store.close();
    }
  });

  it("overwrites the single settings row on repeated saves", async () => {
    const store = createSqliteSettingsStore();
    try {
      const first = createDefaultSettings({ companyName: "Cyag" });
      await store.save(first);
      const second = updateSettings(first, { defaultTaxRate: 15, creditControlEnabled: true });
      await store.save(second);
      const loaded = await store.get();
      expect(loaded?.defaultTaxRate).toBe(15);
      expect(loaded?.creditControlEnabled).toBe(true);
      expect(loaded?.companyName).toBe("Cyag");
    } finally {
      store.close();
    }
  });

  it("a row saved before the period-close setting existed takes its value from the contracting single-operator switch it used to share", async () => {
    const store = createSqliteSettingsStore();
    try {
      const { periodCloseSingleOperatorMode: _dropped, ...legacy } = createDefaultSettings({ contractingSingleOperatorMode: true });
      await store.save(legacy as ReturnType<typeof createDefaultSettings>);
      expect(await store.get()).toMatchObject({ contractingSingleOperatorMode: true, periodCloseSingleOperatorMode: true });

      await store.save(createDefaultSettings({ contractingSingleOperatorMode: true, periodCloseSingleOperatorMode: false }));
      expect(await store.get()).toMatchObject({ contractingSingleOperatorMode: true, periodCloseSingleOperatorMode: false });
    } finally {
      store.close();
    }
  });
});
