import { EnvSettingKey, EnvSettingSource, type EnvSettingsDTO } from "@mezan/contracts";
import { EnvSettingsInvalidError, type PlatformEnvSettingsPort, type PreparedEnvChange } from "@mezan/backend";
import { readEnvOverrides, writeEnvOverrides, type BootEnv, type EnvOverrides } from "./env-overrides.js";

const hasText = (value: string | undefined): boolean => value !== undefined && value.trim() !== "";

const effective = (base: BootEnv["base"], overrides: EnvOverrides, key: EnvSettingKey) => (key in overrides ? overrides[key] : base[key]);

/**
 * `check` must throw for any environment the server would refuse to start with: it is the same
 * parse (and, in production, the same start-up refusals) the entry point runs.
 */
export function createEnvSettings(boot: BootEnv, check: (env: Record<string, string | undefined>) => void, restart: () => void): PlatformEnvSettingsPort {
  const current = (): EnvOverrides => {
    try {
      return readEnvOverrides(boot.platformDir);
    } catch {
      return {};
    }
  };

  function list(): EnvSettingsDTO {
    const overrides = current();
    const keys = Object.values(EnvSettingKey);
    return {
      settings: keys.map((key) => ({
        key,
        value: effective(boot.base, overrides, key) ?? null,
        source: key in overrides ? EnvSettingSource.Override : hasText(boot.base[key]) ? EnvSettingSource.EnvFile : EnvSettingSource.Unset,
      })),
      restartPending: keys.some((key) => effective(boot.base, overrides, key) !== effective(boot.base, boot.applied, key)),
      loadError: boot.loadError,
    };
  }

  function update(changes: Partial<Record<EnvSettingKey, string | null>>): PreparedEnvChange {
    const before = current();
    const next: EnvOverrides = { ...before };
    for (const [key, value] of Object.entries(changes) as [EnvSettingKey, string | null][]) {
      if (value === null) delete next[key];
      else next[key] = value.trim();
    }
    try {
      check({ ...boot.base, ...next });
    } catch (err) {
      throw new EnvSettingsInvalidError(err instanceof Error ? err.message : String(err));
    }
    return {
      changed: (Object.keys(changes) as EnvSettingKey[]).filter((key) => effective(boot.base, before, key) !== effective(boot.base, next, key)),
      commit: () => writeEnvOverrides(boot.platformDir, next),
    };
  }

  return { list, update, restart };
}
