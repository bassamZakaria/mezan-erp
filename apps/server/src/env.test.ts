import { describe, expect, it } from "vitest";
import { parseEnv, PaymobMode } from "./env.js";

describe("parseEnv", () => {
  it("defaults every field when nothing is set", () => {
    const env = parseEnv({});
    expect(env).toEqual({
      platformDir: ".data/platform",
      tenantDomain: undefined,
      trustProxy: false,
      clientSource: { trustedProxyHops: 0, trustViewerAddress: false, compareViewerAddress: false },
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
      paymob: { mode: PaymobMode.Off },
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

  it("refuses to trust a proxy without being told how many hops it appends, and trusts none without one", () => {
    expect(() => parseEnv({ MEZAN_TRUST_PROXY: "1" })).toThrow(/MEZAN_TRUSTED_PROXY_HOPS/);
    expect(() => parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "0" })).toThrow(/MEZAN_TRUSTED_PROXY_HOPS/);
    expect(parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1" }).clientSource).toEqual({ trustedProxyHops: 1, trustViewerAddress: false, compareViewerAddress: false });
    expect(parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "2", MEZAN_ORIGIN_SECRET: "s3cr3t" }).clientSource).toEqual({ trustedProxyHops: 2, trustViewerAddress: false, compareViewerAddress: true });
    expect(parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "2" }).clientSource.trustedProxyHops).toBe(2);
    expect(parseEnv({}).clientSource.trustedProxyHops).toBe(0);
  });

  it("refuses to count forwarded hops or read the viewer address without the proxy that makes them true", () => {
    expect(() => parseEnv({ MEZAN_TRUSTED_PROXY_HOPS: "2" })).toThrow(/MEZAN_TRUST_PROXY/);
    expect(() => parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "-1" })).toThrow(/MEZAN_TRUSTED_PROXY_HOPS/);
    expect(() => parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "2", MEZAN_TRUST_VIEWER_ADDRESS: "1" })).toThrow(/MEZAN_ORIGIN_SECRET/);
    expect(() => parseEnv({ MEZAN_ORIGIN_SECRET: "s3cr3t", MEZAN_TRUST_VIEWER_ADDRESS: "1" })).toThrow(/MEZAN_TRUST_PROXY/);
  });

  it("refuses a support mailbox that is not an address", () => {
    expect(() => parseEnv({ MEZAN_SUPPORT_EMAIL: "support" })).toThrow(/MEZAN_SUPPORT_EMAIL/);
  });

  it("reads every variable when set", () => {
    const env = parseEnv({
      MEZAN_PLATFORM_DIR: "/data",
      MEZAN_TENANT_DOMAIN: "mezan.test",
      MEZAN_TRUST_PROXY: "1",
      MEZAN_TRUSTED_PROXY_HOPS: "2",
      MEZAN_TRUST_VIEWER_ADDRESS: "1",
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
      clientSource: { trustedProxyHops: 2, trustViewerAddress: true, compareViewerAddress: true },
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
        mode: PaymobMode.Live,
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
});

describe("platform mail and the origin its links are built on", () => {
  const MAIL = { MEZAN_SMTP_HOST: "smtp.mezan.test", MEZAN_SMTP_FROM_EMAIL: "no-reply@mezan.test" };
  const LIVE_PAYMOB = {
    MEZAN_PAYMOB_SECRET_KEY: "sk-live", MEZAN_PAYMOB_PUBLIC_KEY: "pk-live", MEZAN_PAYMOB_HMAC_SECRET: "hmac-live",
    MEZAN_PAYMOB_INTEGRATION_ID: "101", MEZAN_PAYMOB_PUBLIC_URL: "https://pay.mezan.test",
  };

  it.each([
    ["nothing else", {}],
    ["a tenant domain, which names no address the signup page itself is served on", { MEZAN_TENANT_DOMAIN: "mezan.test" }],
    ["the card test double, which has no public address of its own", { MEZAN_PAYMOB_TEST_MODE: "1" }],
  ])("refuses to start with mail configured and %s, and names the variable to set", (_label, vars) => {
    expect(() => parseEnv({ ...MAIL, ...vars })).toThrow(
      "MEZAN_PUBLIC_URL is required once MEZAN_SMTP_HOST is set: every mailed link (signup verification, owner hand-over) is built on it, and without it no signup can be completed",
    );
  });

  it.each([
    ["MEZAN_PUBLIC_URL", { MEZAN_PUBLIC_URL: "https://mezan.test" }],
    ["live card checkout's public address", LIVE_PAYMOB],
    ["the card test double's public address", { MEZAN_PAYMOB_TEST_MODE: "1", MEZAN_PAYMOB_PUBLIC_URL: "https://pay.mezan.test" }],
  ])("starts with mail configured and %s", (_label, vars) => {
    expect(parseEnv({ ...MAIL, ...vars }).platformSmtp?.smtpHost).toBe("smtp.mezan.test");
  });

  it("starts with no mail and no public origin: the link is shown on screen instead of mailed", () => {
    expect(parseEnv({ MEZAN_TENANT_DOMAIN: "mezan.test" }).platformSmtp).toBeUndefined();
  });
});

describe("MEZAN_TENANT_DOMAIN", () => {
  it.each([
    ["a trailing dot", "mezan.app."],
    ["a leading dot", ".mezan.app"],
    ["a wildcard", "*.mezan.app"],
    ["a port", "mezan.app:8443"],
    ["a scheme", "https://mezan.app"],
    ["a path", "mezan.app/x"],
    ["a space", "mezan .app"],
    ["an empty label", "mezan..app"],
    ["a label that starts with a hyphen", "-mezan.app"],
    ["userinfo", "user@mezan.app"],
    ["a character outside a hostname", "mezan_app.example"],
  ])("refuses to start with %s, and says what a tenant domain is", (_label, value) => {
    expect(() => parseEnv({ MEZAN_TENANT_DOMAIN: value })).toThrow(`MEZAN_TENANT_DOMAIN must be a bare hostname such as "mezan.app" (no scheme, port, path, wildcard or trailing dot), got "${value}"`);
  });

  it.each([
    ["mezan.app", "mezan.app"],
    ["Mezan.App", "mezan.app"],
    ["  tenants.mezan-erp.example  ", "tenants.mezan-erp.example"],
    ["localhost", "localhost"],
  ])("accepts %s and keeps it in lower case", (value, kept) => {
    expect(parseEnv({ MEZAN_TENANT_DOMAIN: value }).tenantDomain).toBe(kept);
  });
});
