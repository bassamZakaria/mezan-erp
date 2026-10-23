import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import path from "node:path";
import { isEnvSettingKey, type EnvSettingKey } from "@mezan/contracts";

export const ENV_OVERRIDES_FILE = "env-overrides.json";

export type EnvOverrides = Partial<Record<EnvSettingKey, string>>;

const fileOf = (platformDir: string) => path.join(platformDir, ENV_OVERRIDES_FILE);

/** Missing file = no overrides. Keys the console may not set are ignored, never applied, whatever the file holds. */
export function readEnvOverrides(platformDir: string): EnvOverrides {
  const file = fileOf(platformDir);
  if (!existsSync(file)) return {};
  const stored = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const out: EnvOverrides = {};
  for (const [key, value] of Object.entries(stored)) {
    if (isEnvSettingKey(key) && typeof value === "string") out[key] = value;
  }
  return out;
}

export function writeEnvOverrides(platformDir: string, overrides: EnvOverrides): void {
  const file = fileOf(platformDir);
  const temp = `${file}.tmp`;
  // fsync before the rename: a power cut must leave either the old file or the whole new one, never a torn one.
  const fd = openSync(temp, "w", 0o600);
  try {
    writeSync(fd, `${JSON.stringify(overrides, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
}

export interface BootEnv {
  readonly platformDir: string;
  /** The process environment as the server found it, before any override. */
  readonly base: Record<string, string | undefined>;
  /** The overrides the running server started with. */
  readonly applied: EnvOverrides;
  readonly merged: Record<string, string | undefined>;
  readonly loadError: string | null;
}

/** The platform directory comes from the process environment only: the overrides file lives in it. */
export function bootEnv(processEnv: Record<string, string | undefined>, defaultPlatformDir: string): BootEnv {
  const platformDir = processEnv["MEZAN_PLATFORM_DIR"] ?? defaultPlatformDir;
  mkdirSync(platformDir, { recursive: true });
  const base = { ...processEnv, MEZAN_PLATFORM_DIR: platformDir };
  // A file that cannot be read must not keep the server down: it starts on the env file and the console reports the problem.
  let applied: EnvOverrides = {};
  let loadError: string | null = null;
  try {
    applied = readEnvOverrides(platformDir);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    console.error(`[server] ${ENV_OVERRIDES_FILE} could not be read; starting on the env file alone: ${loadError}`);
  }
  return { platformDir, base, applied, merged: { ...base, ...applied }, loadError };
}
