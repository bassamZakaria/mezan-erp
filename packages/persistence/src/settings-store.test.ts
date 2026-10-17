import { describe, it, expect } from "vitest";
import { createDefaultSettings, updateSettings } from "@mezan/domain";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { createSqliteSettingsStore } from "./settings-store.js";
import { createAesGcmSecretBox, isSealedSecret } from "./secret-box.js";

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

  describe("the SMTP password at rest, under a platform key", () => {
    const box = createAesGcmSecretBox(randomBytes(32));
    const rawPassword = (sqlite: Database.Database): string =>
      (JSON.parse((sqlite.prepare(`SELECT data FROM tenant_settings`).get() as { data: string }).data) as { smtpPassword: string }).smtpPassword;

    it("is sealed on disk and read back as the password", async () => {
      const sqlite = new Database(":memory:");
      const store = createSqliteSettingsStore(sqlite, box);
      await store.save(createDefaultSettings({ smtpPassword: "relay-pass" }));
      expect(rawPassword(sqlite)).not.toContain("relay-pass");
      expect(isSealedSecret(rawPassword(sqlite))).toBe(true);
      expect((await store.get())?.smtpPassword).toBe("relay-pass");
      sqlite.close();
    });

    it("seals a password stored before sealing existed when the books are opened", async () => {
      const sqlite = new Database(":memory:");
      await createSqliteSettingsStore(sqlite).save(createDefaultSettings({ smtpPassword: "legacy-pass" }));
      expect(rawPassword(sqlite)).toBe("legacy-pass");
      const store = createSqliteSettingsStore(sqlite, box);
      expect(isSealedSecret(rawPassword(sqlite))).toBe(true);
      expect((await store.get())?.smtpPassword).toBe("legacy-pass");
      sqlite.close();
    });

    it("reads a password it cannot open as unset, never as ciphertext", async () => {
      const sqlite = new Database(":memory:");
      await createSqliteSettingsStore(sqlite, box).save(createDefaultSettings({ smtpPassword: "relay-pass" }));
      expect((await createSqliteSettingsStore(sqlite).get())?.smtpPassword).toBe("");
      expect((await createSqliteSettingsStore(sqlite, createAesGcmSecretBox(randomBytes(32))).get())?.smtpPassword).toBe("");
      sqlite.close();
    });
  });
});
