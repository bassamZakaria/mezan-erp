import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSqliteConnection } from "@mezan/persistence";
import { EnvSettingKey, EnvSettingSource, type EnvSettingsDTO } from "@mezan/contracts";
import { bootRefusals, parseEnv } from "./env.js";
import { bootEnv, ENV_OVERRIDES_FILE, readEnvOverrides } from "./env-overrides.js";
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

describe("the server settings overrides file", () => {
  it("is empty when missing, applies over the process environment, and an empty value unsets a variable", () => {
    const dir = dataDir();
    const empty = bootEnv({ MEZAN_PLATFORM_DIR: dir, MEZAN_SUPPORT_EMAIL: "help@env.example" }, ".unused");
    expect(empty.applied).toEqual({});
    expect(empty.merged["MEZAN_SUPPORT_EMAIL"]).toBe("help@env.example");

    const settings = createEnvSettings(empty, productionCheck, () => undefined);
    settings.update({ [EnvSettingKey.SupportEmail]: "help@console.example", [EnvSettingKey.SupportPhone]: "" });

    const next = bootEnv({ MEZAN_PLATFORM_DIR: dir, MEZAN_SUPPORT_EMAIL: "help@env.example", MEZAN_SUPPORT_PHONE: "0100" }, ".unused");
    expect(parseEnv(next.merged)).toMatchObject({ supportEmail: "help@console.example", supportPhone: undefined });
  });

  it("seals secrets on disk, never lists their value, and ignores keys the console may not set", () => {
    const dir = dataDir();
    const boot = bootEnv({ MEZAN_PLATFORM_DIR: dir }, ".unused");
    const settings = createEnvSettings(boot, productionCheck, () => undefined);
    settings.update({ [EnvSettingKey.SmtpPassword]: "s3cret-mail-pass" });

    expect(readFileSync(path.join(dir, ENV_OVERRIDES_FILE), "utf8")).not.toContain("s3cret-mail-pass");
    expect(readEnvOverrides(dir, boot.box)[EnvSettingKey.SmtpPassword]).toBe("s3cret-mail-pass");
    expect(settings.list().settings.find((s) => s.key === EnvSettingKey.SmtpPassword)).toEqual({
      key: EnvSettingKey.SmtpPassword,
      value: null,
      hasValue: true,
      source: EnvSettingSource.Override,
    });

    const stored = JSON.parse(readFileSync(path.join(dir, ENV_OVERRIDES_FILE), "utf8")) as Record<string, unknown>;
    writeFileSync(path.join(dir, ENV_OVERRIDES_FILE), JSON.stringify({ ...stored, MEZAN_SECRETS_KEY: { value: "planted" } }));
    expect(bootEnv({ MEZAN_PLATFORM_DIR: dir }, ".unused").merged["MEZAN_SECRETS_KEY"]).toBeUndefined();
  });

  it("refuses, writing nothing, a value the server would not start with, and marks a saved change as pending a restart", () => {
    const dir = dataDir();
    const boot = bootEnv({ MEZAN_PLATFORM_DIR: dir }, ".unused");
    const settings = createEnvSettings(boot, productionCheck, () => undefined);

    expect(() => settings.update({ [EnvSettingKey.SmtpHost]: "smtp.example.com" })).toThrow(/MEZAN_SMTP_FROM_EMAIL/);
    expect(() => settings.update({ [EnvSettingKey.PaymobTestMode]: "1" })).toThrow(/MEZAN_SEED_DEMO/);
    expect(() => settings.update({ [EnvSettingKey.WhatsappNumber]: "not a number" })).toThrow(/MEZAN_WHATSAPP_NUMBER/);
    expect(settings.list().restartPending).toBe(false);

    expect(settings.update({ [EnvSettingKey.WhatsappNumber]: "+20 100 123 4567" })).toEqual([EnvSettingKey.WhatsappNumber]);
    expect(settings.list().restartPending).toBe(true);
    expect(parseEnv(bootEnv({ MEZAN_PLATFORM_DIR: dir }, ".unused").merged).whatsappNumber).toBe("201001234567");
  });
});

describe("server settings from the platform console", () => {
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
    return { app, call, dir, restart };
  }

  it("saves only with the owner's password, refuses a broken value, and audits a secret as set, never its value", async () => {
    const { app, call, dir } = await boot();
    const put = (body: unknown) => call("/settings/env", { method: "PUT", body: JSON.stringify(body) });

    expect((await put({ password: "wrong-password", changes: { [EnvSettingKey.SupportEmail]: "help@x.example" } })).status).toBe(403);
    const broken = await put({ password: OWNER_PASSWORD, changes: { [EnvSettingKey.SmtpHost]: "smtp.example.com" } });
    expect(broken.status).toBe(422);
    expect(((await broken.json()) as { error: string }).error).toBe("ENV_SETTINGS_INVALID");

    const saved = await put({ password: OWNER_PASSWORD, changes: { [EnvSettingKey.SupportEmail]: "help@x.example", [EnvSettingKey.SmtpPassword]: "mail-pass-1" } });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as EnvSettingsDTO;
    expect(body.restartPending).toBe(true);
    expect(body.settings.find((s) => s.key === EnvSettingKey.SupportEmail)).toMatchObject({ value: "help@x.example", source: EnvSettingSource.Override });
    expect(JSON.stringify(body)).not.toContain("mail-pass-1");
    expect(readFileSync(path.join(dir, ENV_OVERRIDES_FILE), "utf8")).not.toContain("mail-pass-1");

    const rows = openSqliteConnection(path.join(dir, "platform.db"))
      .sqlite.prepare("SELECT details, severity FROM audit_event WHERE action = 'ENV_SETTINGS_CHANGED'")
      .all() as { details: string; severity: string }[];
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.details)).toMatchObject({ changed: { [EnvSettingKey.SupportEmail]: "help@x.example", [EnvSettingKey.SmtpPassword]: "set" } });
    expect(rows[0]!.details).not.toContain("mail-pass-1");
    void app;
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
