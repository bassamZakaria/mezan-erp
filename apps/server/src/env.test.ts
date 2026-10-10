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
      // No Paymob keys and no MEZAN_SMTP_HOST: card checkout is off and the
      // platform sends no mail, which is what the dev entrypoint expects.
      paymob: { mode: "off" },
      platformSmtp: undefined,
      supportEmail: undefined,
      reviewTenant: undefined,
    });
  });

  it("reads the reviewer tenant and the support mailbox", () => {
    const env = parseEnv({
      MEZAN_REVIEW_TENANT_CODE: "review",
      MEZAN_REVIEW_PIN: "482913",
      MEZAN_SUPPORT_EMAIL: "support@mezan.test",
    });
    expect(env.reviewTenant).toEqual({ code: "review", pin: "482913" });
    expect(env.supportEmail).toBe("support@mezan.test");
  });

  it("refuses a reviewer tenant that is half-configured, on the published PIN, named demo, or next to the basic-auth demo", () => {
    expect(() => parseEnv({ MEZAN_REVIEW_TENANT_CODE: "review" })).toThrow(/set together/);
    expect(() => parseEnv({ MEZAN_REVIEW_PIN: "482913" })).toThrow(/set together/);
    expect(() => parseEnv({ MEZAN_REVIEW_TENANT_CODE: "review", MEZAN_REVIEW_PIN: "123456" })).toThrow(/published/);
    expect(() => parseEnv({ MEZAN_REVIEW_TENANT_CODE: "review", MEZAN_REVIEW_PIN: "4829" })).toThrow(/six digits/);
    expect(() => parseEnv({ MEZAN_REVIEW_TENANT_CODE: "demo", MEZAN_REVIEW_PIN: "482913" })).toThrow(/not "demo"/);
    expect(() =>
      parseEnv({ MEZAN_REVIEW_TENANT_CODE: "review", MEZAN_REVIEW_PIN: "482913", MEZAN_SEED_DEMO: "1" }),
    ).toThrow(/MEZAN_SEED_DEMO/);
  });

  it("refuses a support mailbox that is not an address", () => {
    expect(() => parseEnv({ MEZAN_SUPPORT_EMAIL: "support" })).toThrow(/MEZAN_SUPPORT_EMAIL/);
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
      MEZAN_PAYMOB_SECRET_KEY: "sk-live",
      MEZAN_PAYMOB_PUBLIC_KEY: "pk-live",
      MEZAN_PAYMOB_HMAC_SECRET: "hmac-live",
      MEZAN_PAYMOB_INTEGRATION_ID: "101,102",
      MEZAN_PAYMOB_PUBLIC_URL: "https://pay.mezan.test",
      MEZAN_SMTP_HOST: "smtp.mezan.test",
      MEZAN_SMTP_PORT: "465",
      MEZAN_SMTP_SECURITY: "TLS",
      MEZAN_SMTP_USERNAME: "mailer",
      MEZAN_SMTP_PASSWORD: "mail-pass",
      MEZAN_SMTP_FROM_NAME: "ميزان",
      MEZAN_SMTP_FROM_EMAIL: "no-reply@mezan.test",
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
      paymob: {
        mode: "live",
        baseUrl: "https://accept.paymob.com",
        secretKey: "sk-live",
        publicKey: "pk-live",
        hmacSecret: "hmac-live",
        integrationIds: [101, 102],
        publicUrl: "https://pay.mezan.test",
      },
      platformSmtp: {
        smtpEnabled: true,
        smtpHost: "smtp.mezan.test",
        smtpPort: 465,
        smtpSecurity: "TLS",
        smtpUsername: "mailer",
        smtpPassword: "mail-pass",
        smtpFromName: "ميزان",
        smtpFromEmail: "no-reply@mezan.test",
      },
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

  const livePaymob = {
    MEZAN_PAYMOB_SECRET_KEY: "sk-live",
    MEZAN_PAYMOB_PUBLIC_KEY: "pk-live",
    MEZAN_PAYMOB_HMAC_SECRET: "hmac-live",
    MEZAN_PAYMOB_INTEGRATION_ID: "101",
    MEZAN_PAYMOB_PUBLIC_URL: "https://pay.mezan.test",
  };

  it("reads the optional Paymob inquiry API key alongside the live keys", () => {
    expect(parseEnv({ ...livePaymob, MEZAN_PAYMOB_API_KEY: " dashboard-key " }).paymob).toMatchObject({ mode: "live", apiKey: "dashboard-key" });
    expect(parseEnv(livePaymob).paymob).not.toHaveProperty("apiKey");
  });

  it("refuses a Paymob inquiry API key with no live keys to go with it", () => {
    expect(() => parseEnv({ MEZAN_PAYMOB_API_KEY: "dashboard-key" })).toThrow(/MEZAN_PAYMOB_API_KEY/);
  });
});
