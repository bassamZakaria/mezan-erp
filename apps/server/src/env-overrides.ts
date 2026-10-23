import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ENV_SETTINGS, isEnvSettingKey, type EnvSettingKey } from "@mezan/contracts";
import type { SecretBox } from "@mezan/persistence";
import { loadSecretBox } from "./secrets-key.js";

export const ENV_OVERRIDES_FILE = "env-overrides.json";

export type EnvOverrides = Partial<Record<EnvSettingKey, string>>;

type StoredEntry = { readonly value: string } | { readonly sealed: string };

const fileOf = (platformDir: string) => path.join(platformDir, ENV_OVERRIDES_FILE);
const sealContext = (key: EnvSettingKey) => `env-override:${key}`;

/** Missing file = no overrides. Unknown or read-only keys in the file are ignored, never applied. */
export function readEnvOverrides(platformDir: string, box: SecretBox): EnvOverrides {
  const file = fileOf(platformDir);
  if (!existsSync(file)) return {};
  const stored = JSON.parse(readFileSync(file, "utf8")) as Record<string, StoredEntry>;
  const out: EnvOverrides = {};
  for (const [key, entry] of Object.entries(stored)) {
    if (!isEnvSettingKey(key)) continue;
    out[key] = "sealed" in entry ? box.open(entry.sealed, sealContext(key)) : entry.value;
  }
  return out;
}

export function writeEnvOverrides(platformDir: string, box: SecretBox, overrides: EnvOverrides): void {
  const stored: Record<string, StoredEntry> = {};
  for (const [key, value] of Object.entries(overrides) as [EnvSettingKey, string][]) {
    stored[key] = ENV_SETTINGS[key].secret ? { sealed: box.seal(value, sealContext(key)) } : { value };
  }
  const file = fileOf(platformDir);
  const temp = `${file}.tmp`;
  writeFileSync(temp, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

export interface BootEnv {
  readonly platformDir: string;
  readonly box: SecretBox;
  /** The process environment as the server found it, before any override. */
  readonly base: Record<string, string | undefined>;
  /** The overrides the running server started with. */
  readonly applied: EnvOverrides;
  readonly merged: Record<string, string | undefined>;
}

/** The platform directory and the secrets key come from the process environment only: the overrides file lives in one and is sealed with the other. */
export function bootEnv(processEnv: Record<string, string | undefined>, defaultPlatformDir: string): BootEnv {
  const platformDir = processEnv["MEZAN_PLATFORM_DIR"] ?? defaultPlatformDir;
  mkdirSync(platformDir, { recursive: true });
  const box = loadSecretBox(processEnv["MEZAN_SECRETS_KEY"]?.trim() || undefined, platformDir);
  const base = { ...processEnv, MEZAN_PLATFORM_DIR: platformDir };
  const applied = readEnvOverrides(platformDir, box);
  return { platformDir, box, base, applied, merged: { ...base, ...applied } };
}
