import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSqliteConnection } from "@mezan/persistence";
import { EnvSettingKey, EnvSettingSource, type EnvSettingsDTO } from "@mezan/contracts";
import { bootRefusals, parseEnv } from "./env.js";
import { bootEnv, ENV_OVERRIDES_FILE } from "./env-overrides.js";
import { createEnvSettings } from "./env-settings.js";
import { createCloudApp, type CloudApp } from "./cloud-app.js";
import { platformBearer, reachable, rememberPlatformDevice } from "./cloud-harness.js";

const OWNER_EMAIL = "owner@mezan.local";
const OWNER_PASSWORD = "owner-password-123";
const T = "2026-01-15T00:00:00.000Z";

const dirs: string[] = [];
const apps: CloudApp[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mezan-env-settings-"));
  dirs.push(dir);
  return dir;
}

const productionCheck = (env: Record<string, string | undefined>) => {
  const refusals = bootRefusals(parseEnv(env));
  if (refusals.length > 0) throw new Error(refusals.join(" "));
};

describe("the site settings overrides file", () => {
  it("is empty when missing, applies over the process environment once committed, and an empty value unsets a variable", () => {
    const dir = dataDir();
    const env = { MEZAN_PLATFORM_DIR: dir, MEZAN_SUPPORT_EMAIL: "help@env.example", MEZAN_SUPPORT_PHONE: "0100" };
    const boot = bootEnv(env, ".unused");
    expect(boot.applied).toEqual({});

    const prepared = createEnvSettings(boot, productionCheck, () => undefined).update({ [EnvSettingKey.SupportEmail]: "help@console.example", [EnvSettingKey.SupportPhone]: "" });
    expect(prepared.changed).toEqual([EnvSettingKey.SupportEmail, EnvSettingKey.SupportPhone]);
    expect(parseEnv(bootEnv(env, ".unused").merged).supportEmail).toBe("help@env.example");

    prepared.commit();
    expect(parseEnv(bootEnv(env, ".unused").merged)).toMatchObject({ supportEmail: "help@console.example", supportPhone: undefined });
  });

  it("never applies a key the console may not set, whatever the file holds", () => {
    const dir = dataDir();
    writeFileSync(path.join(dir, ENV_OVERRIDES_FILE), JSON.stringify({ MEZAN_SMTP_HOST: "evil.example", MEZAN_SECRETS_KEY: "planted", MEZAN_WHATSAPP_NUMBER: "201001234567" }));

    const merged = bootEnv({ MEZAN_PLATFORM_DIR: dir }, ".unused").merged;

    expect(merged["MEZAN_SMTP_HOST"]).toBeUndefined();
    expect(merged["MEZAN_SECRETS_KEY"]).toBeUndefined();
    expect(merged["MEZAN_WHATSAPP_NUMBER"]).toBe("201001234567");
  });

  it("starts on the env file alone when the file is unreadable, and says so", () => {
    const dir = dataDir();
    writeFileSync(path.join(dir, ENV_OVERRIDES_FILE), "{ torn");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const boot = bootEnv({ MEZAN_PLATFORM_DIR: dir, MEZAN_SUPPORT_PHONE: "0100" }, ".unused");
      expect(boot.merged["MEZAN_SUPPORT_PHONE"]).toBe("0100");
      expect(createEnvSettings(boot, productionCheck, () => undefined).list().loadError).toMatch(/JSON/);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses a value the server would not start with, and marks a committed change as pending a restart", () => {
    const dir = dataDir();
    const settings = createEnvSettings(bootEnv({ MEZAN_PLATFORM_DIR: dir }, ".unused"), productionCheck, () => undefined);

    expect(() => settings.update({ [EnvSettingKey.WhatsappNumber]: "not a number" })).toThrow(/MEZAN_WHATSAPP_NUMBER/);
    expect(() => settings.update({ [EnvSettingKey.SupportEmail]: "not-an-email" })).toThrow(/MEZAN_SUPPORT_EMAIL/);
    expect(settings.list().restartPending).toBe(false);

    settings.update({ [EnvSettingKey.WhatsappNumber]: "+20 100 123 4567" }).commit();
    expect(settings.list().restartPending).toBe(true);
    expect(settings.list().settings.find((s) => s.key === EnvSettingKey.WhatsappNumber)).toEqual({
      key: EnvSettingKey.WhatsappNumber,
      value: "+20 100 123 4567",
      source: EnvSettingSource.Override,
    });
    expect(parseEnv(bootEnv({ MEZAN_PLATFORM_DIR: dir }, ".unused").merged).whatsappNumber).toBe("201001234567");
  });
});

describe("site settings from the platform console", () => {
  async function boot(restart = vi.fn()) {
    const dir = dataDir();
    const settingsBoot = bootEnv({ MEZAN_PLATFORM_DIR: dir }, ".unused");
    const app = await createCloudApp(
      { ...parseEnv(settingsBoot.merged), platformDir: dir, webDist: path.join(dir, "no-web"), backupIntervalMinutes: 0, platformOwnerEmail: OWNER_EMAIL, platformOwnerPassword: OWNER_PASSWORD },
      { now: () => new Date(T), envSettings: createEnvSettings(settingsBoot, productionCheck, restart) },
    );
    reachable(app.root);
    apps.push(app);
    const login = await app.root.fetch(
      new Request("http://cloud.internal/api/platform/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }) }),
    );
    const signedIn = (await login.json()) as { token: string };
    rememberPlatformDevice(signedIn);
    const call = (route: string, init: RequestInit = {}) =>
      Promise.resolve(
        app.root.fetch(new Request(`http://cloud.internal/api/platform${route}`, { ...init, headers: { ...platformBearer(signedIn.token), "content-type": "application/json" } })),
      );
    return { call, dir, restart };
  }

  it("saves only with the owner's password, refuses a broken value or a server setting, and audits the change", async () => {
    const { call, dir } = await boot();
    const put = (body: unknown) => call("/settings/env", { method: "PUT", body: JSON.stringify(body) });

    expect((await put({ password: "wrong-password", changes: { [EnvSettingKey.SupportEmail]: "help@x.example" } })).status).toBe(403);
    expect((await put({ password: OWNER_PASSWORD, changes: { MEZAN_SMTP_HOST: "evil.example" } })).status).toBe(400);
    const broken = await put({ password: OWNER_PASSWORD, changes: { [EnvSettingKey.SupportEmail]: "nope" } });
    expect(broken.status).toBe(422);
    expect(((await broken.json()) as { error: string }).error).toBe("ENV_SETTINGS_INVALID");

    const saved = await put({ password: OWNER_PASSWORD, changes: { [EnvSettingKey.SupportEmail]: "help@x.example", [EnvSettingKey.PublicLanding]: "1" } });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as EnvSettingsDTO;
    expect(body.restartPending).toBe(true);
    expect(body.settings.find((s) => s.key === EnvSettingKey.SupportEmail)).toMatchObject({ value: "help@x.example", source: EnvSettingSource.Override });
    expect(JSON.parse(readFileSync(path.join(dir, ENV_OVERRIDES_FILE), "utf8"))).toEqual({ MEZAN_SUPPORT_EMAIL: "help@x.example", MEZAN_PUBLIC_LANDING: "1" });

    const rows = openSqliteConnection(path.join(dir, "platform.db"))
      .sqlite.prepare("SELECT details, severity FROM audit_event WHERE action = 'ENV_SETTINGS_CHANGED'")
      .all() as { details: string; severity: string }[];
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.details)).toMatchObject({ changed: { [EnvSettingKey.SupportEmail]: "help@x.example", [EnvSettingKey.PublicLanding]: "1" } });
  });

  it("restarts only after the password is confirmed, answering before the process goes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const { call, restart } = await boot();
      expect((await call("/settings/restart", { method: "POST", body: JSON.stringify({ password: "nope" }) })).status).toBe(403);
      const accepted = await call("/settings/restart", { method: "POST", body: JSON.stringify({ password: OWNER_PASSWORD }) });
      expect(accepted.status).toBe(202);
      expect(restart).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(restart).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
