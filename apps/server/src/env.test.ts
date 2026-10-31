import { describe, expect, it } from "vitest";
import { SEED_ADMIN_PASSWORD } from "@mezan/backend";
import { parseEnv, PaymobMode } from "./env.js";

describe("parseEnv audit anchoring", () => {
  it("reads the S3-compatible sink and refuses a bucket without a region or an endpoint", () => {
    expect(
      parseEnv({ MEZAN_AUDIT_ANCHOR_S3_BUCKET: "backups", MEZAN_AUDIT_ANCHOR_S3_REGION: "default", MEZAN_AUDIT_ANCHOR_S3_ENDPOINT: "https://eu2.contabostorage.com", MEZAN_AUDIT_ANCHOR_INTERVAL_MINUTES: "5", MEZAN_AUDIT_ANCHOR_SIGNING_KEY: "ab" }).auditAnchor,
    ).toEqual({ intervalMinutes: 5, signingKey: "ab", s3: { bucket: "backups", region: "default", endpoint: "https://eu2.contabostorage.com" } });
    expect(() => parseEnv({ MEZAN_AUDIT_ANCHOR_S3_BUCKET: "backups", MEZAN_AUDIT_ANCHOR_S3_ENDPOINT: "https://x.test" })).toThrow(/MEZAN_AUDIT_ANCHOR_S3_REGION/);
    expect(() => parseEnv({ MEZAN_AUDIT_ANCHOR_S3_BUCKET: "backups", MEZAN_AUDIT_ANCHOR_S3_REGION: "default" })).toThrow(/MEZAN_AUDIT_ANCHOR_S3_ENDPOINT/);
  });

  it("reads the retired public keys that still verify old anchors, and refuses one that is not 64 hex characters", () => {
    const retired = "a".repeat(64);
    const older = "B".repeat(64);

    expect(parseEnv({ MEZAN_AUDIT_ANCHOR_TRUSTED_PUBLIC_KEYS: ` ${retired}, ${older} ,${retired}` }).auditAnchor?.trustedPublicKeys).toEqual([retired, "b".repeat(64)]);
    expect(parseEnv({}).auditAnchor?.trustedPublicKeys).toBeUndefined();
    expect(() => parseEnv({ MEZAN_AUDIT_ANCHOR_TRUSTED_PUBLIC_KEYS: `${retired},nope` })).toThrow(/MEZAN_AUDIT_ANCHOR_TRUSTED_PUBLIC_KEYS/);
  });
});

describe("parseEnv", () => {
  it("defaults every field when nothing is set", () => {
    const env = parseEnv({});
    expect(env).toEqual({
      platformDir: ".data/platform",
      auditAnchor: { intervalMinutes: 15 },
      tenantDomain: undefined,
      trustProxy: false,
      clientSource: { trustedProxyHops: 0 },
      originSecret: undefined,
      sqliteExclusive: false,
      platformOwnerEmail: undefined,
      platformOwnerPassword: undefined,
      seedDemo: false,
      seedAdminPassword: undefined,
      backupIntervalMinutes: 15,
      apiRequestsPerAddressPerMinute: 3000,
      apiRequestsPerSessionPerMinute: 600,
      tenantRetentionDays: 90,
      webDist: "./apps/web/dist",
      demoPassword: undefined,
      analyticsToken: undefined,
      publicLanding: false,
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
      MEZAN_REVIEW_PASSWORD: "pw-482913",
      MEZAN_SUPPORT_EMAIL: "support@mezan.test",
    });
    expect(env.reviewTenant).toEqual({ code: "review", password: "pw-482913" });
    expect(env.supportEmail).toBe("support@mezan.test");
  });

  it("refuses a reviewer tenant that is half-configured, on the published password, too short, named demo, or next to the basic-auth demo", () => {
    expect(() => parseEnv({ MEZAN_REVIEW_TENANT_CODE: "review" })).toThrow(/set together/);
    expect(() => parseEnv({ MEZAN_REVIEW_PASSWORD: "pw-482913" })).toThrow(/set together/);
    expect(() => parseEnv({ MEZAN_REVIEW_TENANT_CODE: "review", MEZAN_REVIEW_PASSWORD: SEED_ADMIN_PASSWORD })).toThrow(/published/);
    expect(() => parseEnv({ MEZAN_REVIEW_TENANT_CODE: "review", MEZAN_REVIEW_PASSWORD: "pw-4829" })).toThrow(/at least 8/);
    expect(() => parseEnv({ MEZAN_REVIEW_TENANT_CODE: "demo", MEZAN_REVIEW_PASSWORD: "pw-482913" })).toThrow(/not "demo"/);
    expect(() =>
      parseEnv({ MEZAN_REVIEW_TENANT_CODE: "review", MEZAN_REVIEW_PASSWORD: "pw-482913", MEZAN_SEED_DEMO: "1" }),
    ).toThrow(/MEZAN_SEED_DEMO/);
  });

  it("refuses to trust a proxy without being told how many hops it appends, and trusts none without one", () => {
    expect(() => parseEnv({ MEZAN_TRUST_PROXY: "1" })).toThrow(/MEZAN_TRUSTED_PROXY_HOPS/);
    expect(() => parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "0" })).toThrow(/MEZAN_TRUSTED_PROXY_HOPS/);
    expect(parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1" }).clientSource).toEqual({ trustedProxyHops: 1 });
    expect(parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "2", MEZAN_ORIGIN_SECRET: "s3cr3t" }).clientSource).toEqual({ trustedProxyHops: 2 });
    expect(parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "2" }).clientSource.trustedProxyHops).toBe(2);
    expect(parseEnv({}).clientSource.trustedProxyHops).toBe(0);
  });

  it("refuses to count forwarded hops without the proxy that makes them true", () => {
    expect(() => parseEnv({ MEZAN_TRUSTED_PROXY_HOPS: "2" })).toThrow(/MEZAN_TRUST_PROXY/);
    expect(() => parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "-1" })).toThrow(/MEZAN_TRUSTED_PROXY_HOPS/);
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
      MEZAN_ORIGIN_SECRET: "s3cr3t",
      MEZAN_SQLITE_EXCLUSIVE: "1",
      MEZAN_PLATFORM_OWNER_EMAIL: "owner@mezan.local",
      MEZAN_PLATFORM_OWNER_PASSWORD: "owner-password-123",
      MEZAN_SEED_DEMO: "1",
      MEZAN_SEED_ADMIN_PASSWORD: "pw-654321",
      MEZAN_BACKUP_INTERVAL_MINUTES: "30",
      MEZAN_API_REQUESTS_PER_ADDRESS_PER_MINUTE: "5000",
      MEZAN_API_REQUESTS_PER_SESSION_PER_MINUTE: "900",
      MEZAN_TENANT_RETENTION_DAYS: "120",
      MEZAN_WEB_DIST: "./dist",
      MEZAN_DEMO_PASSWORD: "demo-pass",
      MEZAN_ANALYTICS_TOKEN: "0123456789abcdef0123456789abcdef",
      MEZAN_PUBLIC_LANDING: "1",
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
      auditAnchor: { intervalMinutes: 15 },
      tenantDomain: "mezan.test",
      trustProxy: true,
      clientSource: { trustedProxyHops: 2 },
      originSecret: "s3cr3t",
      sqliteExclusive: true,
      platformOwnerEmail: "owner@mezan.local",
      platformOwnerPassword: "owner-password-123",
      seedDemo: true,
      seedAdminPassword: "pw-654321",
      backupIntervalMinutes: 30,
      apiRequestsPerAddressPerMinute: 5000,
      apiRequestsPerSessionPerMinute: 900,
      tenantRetentionDays: 120,
      webDist: "./dist",
      demoPassword: "demo-pass",
      analyticsToken: "0123456789abcdef0123456789abcdef",
      publicLanding: true,
      port: 9090,
      paymob: {
        mode: PaymobMode.Live,
        baseUrl: "https://accept.paymob.com",
        secretKey: "sk-live",
        publicKey: "pk-live",
        hmacSecret: "hmac-live",
        integrationIds: [101, 102],
        publicUrl: "https://pay.mezan.test",
        notFoundShapeConfirmed: false,
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

  it("refuses a request cap that is not a positive whole number, so a typo can never switch the cap off", () => {
    expect(() => parseEnv({ MEZAN_API_REQUESTS_PER_ADDRESS_PER_MINUTE: "0" })).toThrow(/MEZAN_API_REQUESTS_PER_ADDRESS_PER_MINUTE/);
    expect(() => parseEnv({ MEZAN_API_REQUESTS_PER_SESSION_PER_MINUTE: "lots" })).toThrow(/MEZAN_API_REQUESTS_PER_SESSION_PER_MINUTE/);
  });

  it("refuses a backup or anchor interval longer than the 30 minutes after which an idle tenant is closed", () => {
    expect(parseEnv({ MEZAN_BACKUP_INTERVAL_MINUTES: "30" }).backupIntervalMinutes).toBe(30);
    expect(() => parseEnv({ MEZAN_BACKUP_INTERVAL_MINUTES: "31" })).toThrow(/MEZAN_BACKUP_INTERVAL_MINUTES/);
    expect(() => parseEnv({ MEZAN_AUDIT_ANCHOR_INTERVAL_MINUTES: "60" })).toThrow(/MEZAN_AUDIT_ANCHOR_INTERVAL_MINUTES/);
  });

  it("accepts MEZAN_BACKUP_INTERVAL_MINUTES=0 (disables the scheduler)", () => {
    expect(parseEnv({ MEZAN_BACKUP_INTERVAL_MINUTES: "0" }).backupIntervalMinutes).toBe(0);
  });

  it("refuses a MEZAN_TENANT_RETENTION_DAYS that is not a positive whole number of days", () => {
    expect(() => parseEnv({ MEZAN_TENANT_RETENTION_DAYS: "0" })).toThrow(/MEZAN_TENANT_RETENTION_DAYS/);
    expect(() => parseEnv({ MEZAN_TENANT_RETENTION_DAYS: "ninety" })).toThrow(/MEZAN_TENANT_RETENTION_DAYS/);
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

describe("MEZAN_PAYMOB_NOT_FOUND_CONFIRMED", () => {
  const live = {
    MEZAN_PAYMOB_SECRET_KEY: "sk", MEZAN_PAYMOB_PUBLIC_KEY: "pk", MEZAN_PAYMOB_HMAC_SECRET: "hm", MEZAN_PAYMOB_INTEGRATION_ID: "4242",
    MEZAN_PAYMOB_PUBLIC_URL: "https://app.mezan.test",
  };

  it("is off unless set to 1, so an unconfirmed not-found answer cannot expire a checkout", () => {
    expect(parseEnv(live).paymob).toMatchObject({ mode: "live", notFoundShapeConfirmed: false });
    expect(parseEnv({ ...live, MEZAN_PAYMOB_NOT_FOUND_CONFIRMED: "true" }).paymob).toMatchObject({ notFoundShapeConfirmed: false });
    expect(parseEnv({ ...live, MEZAN_PAYMOB_NOT_FOUND_CONFIRMED: "1" }).paymob).toMatchObject({ notFoundShapeConfirmed: true });
  });
});

describe("MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER", () => {
  it("names the one header the caller's address is read from, lower-cased, and only with a trusted proxy", () => {
    expect(parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1", MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER: " CF-Connecting-IP " }).clientSource)
      .toEqual({ trustedProxyHops: 1, trustedAddressHeader: "cf-connecting-ip" });
    expect(parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1" }).clientSource).not.toHaveProperty("trustedAddressHeader");
    expect(() => parseEnv({ MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER: "cf-connecting-ip" })).toThrow(/MEZAN_TRUST_PROXY=1/);
  });

  it("refuses a value that is not a header name, and the forwarded chain itself", () => {
    for (const bad of ["cf connecting ip", "x-real-ip: 1.2.3.4", "x-forwarded-for", "forwarded"]) {
      expect(() => parseEnv({ MEZAN_TRUST_PROXY: "1", MEZAN_TRUSTED_PROXY_HOPS: "1", MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER: bad }), bad).toThrow(/MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER/);
    }
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
    ["a tenant domain, which names no address the platform itself is served on", { MEZAN_TENANT_DOMAIN: "mezan.test" }],
    ["the card test double, which has no public address of its own", { MEZAN_PAYMOB_TEST_MODE: "1" }],
  ])("refuses to start with mail configured and %s, and names the variable to set", (_label, vars) => {
    expect(() => parseEnv({ ...MAIL, ...vars })).toThrow(
      "MEZAN_PUBLIC_URL is required once MEZAN_SMTP_HOST is set: every mailed link (owner hand-over, unlock) is built on it",
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

describe("the analytics token", () => {
  it("refuses anything but the beacon's hex token, since it is written into every page", () => {
    expect(() => parseEnv({ MEZAN_ANALYTICS_TOKEN: "x'><img src=x onerror=alert(1)>" })).toThrow(/MEZAN_ANALYTICS_TOKEN/);
    expect(parseEnv({ MEZAN_ANALYTICS_TOKEN: "0123456789ABCDEF0123456789abcdef" }).analyticsToken).toBe("0123456789ABCDEF0123456789abcdef");
  });
});
