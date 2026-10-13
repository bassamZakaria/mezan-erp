import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackend, createPlatform, type PlatformHandle } from "@mezan/backend";
import { activateTenant, createTenant, startSubscription } from "@mezan/domain";
import type { SmtpConfig } from "@mezan/api";
import { createTenantRouter, tenantUnlockLink, type TenantRouter } from "./tenant-router.js";
import { parseEnv } from "./env.js";
import type { CloudSource } from "./client-source.js";
import { reachable } from "./cloud-harness.js";

const T = new Date("2026-01-15T00:00:00.000Z").toISOString();
const SMTP: SmtpConfig = {
  smtpEnabled: true, smtpHost: "smtp.mezan.test", smtpPort: 587, smtpSecurity: "STARTTLS",
  smtpUsername: "", smtpPassword: "", smtpFromName: "Mezan", smtpFromEmail: "no-reply@mezan.test",
};
const TOKEN = "t".repeat(43);

const platforms: PlatformHandle[] = [];
const routers: TenantRouter[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const router of routers.splice(0)) await router.close();
  for (const platform of platforms.splice(0)) platform.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the address a mailed unlock link opens", () => {
  it("is the tenant's own subdomain under the configured origin's scheme when the deployment serves subdomains", () => {
    expect(tenantUnlockLink("acme", { publicOrigin: "https://app.mezan.test", tenantDomain: "mezan.test" })?.(TOKEN)).toBe(
      `https://acme.mezan.test/unlock?token=${TOKEN}`,
    );
  });

  it("keeps the configured origin's port on the tenant's subdomain, as a development deployment on a port needs", () => {
    expect(tenantUnlockLink("acme", { publicOrigin: "http://127.0.0.1:4103", tenantDomain: "localhost" })?.(TOKEN)).toBe(
      `http://acme.localhost:4103/unlock?token=${TOKEN}`,
    );
  });

  it("is the configured origin with the tenant's code beside the token when it does not", () => {
    expect(tenantUnlockLink("acme", { publicOrigin: "http://127.0.0.1:5080" })?.(TOKEN)).toBe(`http://127.0.0.1:5080/unlock?tenant=acme&token=${TOKEN}`);
  });

  it("does not exist where no origin was configured", () => {
    expect(tenantUnlockLink("acme", { tenantDomain: "mezan.test" })).toBeUndefined();
    expect(tenantUnlockLink("acme", {})).toBeUndefined();
  });

  it("is read from MEZAN_PUBLIC_URL as an origin, and a value that is not a URL stops the server starting", () => {
    expect(parseEnv({ MEZAN_PUBLIC_URL: "https://app.mezan.test/some/path?x=1" }).publicOrigin).toBe("https://app.mezan.test");
    expect(parseEnv({}).publicOrigin).toBeUndefined();
    expect(() => parseEnv({ MEZAN_PUBLIC_URL: "app.mezan.test" })).toThrow(/MEZAN_PUBLIC_URL/);
  });

  it("reaches the administrator's mailbox with the configured origin when the locking requests named an attacker's host", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const platform = await createPlatform({ dbPath: ":memory:" });
    platforms.push(platform);
    const tenant = await createTenant({ id: "t-acme", code: "acme", nameAr: "منشأة", ownerEmail: "owner@acme.example", now: T }, platform.stores.tenants);
    await activateTenant({ id: tenant.id, now: T }, platform.stores.tenants);
    await startSubscription({ id: "sub-acme", tenantId: tenant.id, planId: "PLAN-CORE", billingCycle: "monthly", now: T }, platform.stores.subscriptions, platform.stores.plans);
    const dataDir = mkdtempSync(path.join(tmpdir(), "mezan-unlock-link-"));
    dirs.push(dataDir);
    const mailed: string[] = [];
    const router = createTenantRouter({
      platform,
      dataDir,
      publicOrigin: "https://app.mezan.test",
      trustForwardedHost: true,
      allowTenantHeader: true,
      sweepEveryMs: 0,
      now: () => new Date(T),
      openBackend: async (_code, _dbPath, resolvers, mail) =>
        createBackend({
          dbPath: ":memory:",
          securityMail: SMTP,
          unlockLink: mail.unlockLink,
          resolveEntitlements: () => resolvers.resolveEntitlements(),
          resolveLicenseState: () => resolvers.resolveLicenseState(),
          sendMail: async (_smtp, _to, message) => {
            mailed.push(message.body);
            return { outcome: "sent", detail: "250" };
          },
        }),
    });
    routers.push(router);
    reachable(router.app, 0);
    const backend = await router.backendFor("acme");
    const claimed = await backend.app.fetch(
      new Request("http://tenant.internal/bootstrap/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nameAr: "المالك", email: "owner@acme.example", pin: "731946" }) }),
    );
    expect(claimed.status).toBe(201);

    const door = await router.callerDoor("acme");
    let last = 0;
    for (let i = 0; i < 20; i += 1) {
      const answer = await door.fetch(
        new Request("http://evil.example/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json", host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" },
          body: JSON.stringify({ username: "owner@acme.example", pin: String(100000 + i) }),
        }),
        `41.33.${i}.10` as CloudSource,
      );
      last = answer.status;
    }
    expect(last).toBe(423);
    await backend.drain();

    expect(mailed).toHaveLength(1);
    expect(mailed[0]).toMatch(/https:\/\/app\.mezan\.test\/unlock\?tenant=acme&token=[A-Za-z0-9_-]{43}/);
    expect(mailed[0]).not.toContain("evil.example");
  }, 120_000);
});
