import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("defaults every field when nothing is set", () => {
    const env = parseEnv({});
    expect(env).toEqual({
      platformDir: ".data/platform",
      tenantDomain: undefined,
      trustProxy: false,
      originSecret: undefined,
      sqliteExclusive: false,
      platformOwnerEmail: undefined,
      platformOwnerPassword: undefined,
      seedDemo: false,
      seedAdminPin: undefined,
      backupIntervalMinutes: 15,
      webDist: "./apps/web/dist",
      demoPassword: undefined,
      analyticsToken: undefined,
      port: 8080,
    });
  });

  it("reads every variable when set", () => {
    const env = parseEnv({
      MEZAN_PLATFORM_DIR: "/data",
      MEZAN_TENANT_DOMAIN: "mezan.test",
      MEZAN_TRUST_PROXY: "1",
      MEZAN_ORIGIN_SECRET: "s3cr3t",
      MEZAN_SQLITE_EXCLUSIVE: "1",
      MEZAN_PLATFORM_OWNER_EMAIL: "owner@mezan.local",
      MEZAN_PLATFORM_OWNER_PASSWORD: "owner-password-123",
      MEZAN_SEED_DEMO: "1",
      MEZAN_SEED_ADMIN_PIN: "654321",
      MEZAN_BACKUP_INTERVAL_MINUTES: "30",
      MEZAN_WEB_DIST: "./dist",
      MEZAN_DEMO_PASSWORD: "demo-pass",
      MEZAN_ANALYTICS_TOKEN: "token-123",
      PORT: "9090",
    });
    expect(env).toEqual({
      platformDir: "/data",
      tenantDomain: "mezan.test",
      trustProxy: true,
      originSecret: "s3cr3t",
      sqliteExclusive: true,
      platformOwnerEmail: "owner@mezan.local",
      platformOwnerPassword: "owner-password-123",
      seedDemo: true,
      seedAdminPin: "654321",
      backupIntervalMinutes: 30,
      webDist: "./dist",
      demoPassword: "demo-pass",
      analyticsToken: "token-123",
      port: 9090,
    });
  });

  it("treats a flag value other than \"1\" as off", () => {
    expect(parseEnv({ MEZAN_TRUST_PROXY: "true" }).trustProxy).toBe(false);
    expect(parseEnv({ MEZAN_SEED_DEMO: "0" }).seedDemo).toBe(false);
  });

  it("treats a blank string as unset", () => {
    expect(parseEnv({ MEZAN_TENANT_DOMAIN: "   " }).tenantDomain).toBeUndefined();
  });

  it("throws on a non-integer MEZAN_BACKUP_INTERVAL_MINUTES", () => {
    expect(() => parseEnv({ MEZAN_BACKUP_INTERVAL_MINUTES: "soon" })).toThrow(/MEZAN_BACKUP_INTERVAL_MINUTES/);
  });

  it("throws on a negative MEZAN_BACKUP_INTERVAL_MINUTES", () => {
    expect(() => parseEnv({ MEZAN_BACKUP_INTERVAL_MINUTES: "-5" })).toThrow(/MEZAN_BACKUP_INTERVAL_MINUTES/);
  });

  it("accepts MEZAN_BACKUP_INTERVAL_MINUTES=0 (disables the scheduler)", () => {
    expect(parseEnv({ MEZAN_BACKUP_INTERVAL_MINUTES: "0" }).backupIntervalMinutes).toBe(0);
  });

  it("throws on a non-positive PORT", () => {
    expect(() => parseEnv({ PORT: "0" })).toThrow(/PORT/);
    expect(() => parseEnv({ PORT: "abc" })).toThrow(/PORT/);
  });
});
