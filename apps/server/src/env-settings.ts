import {
  ENV_SETTINGS,
  EnvReadOnlyKey,
  EnvSettingKey,
  EnvSettingSource,
  type EnvSettingsDTO,
} from "@mezan/contracts";
import { EnvSettingsInvalidError, type PlatformEnvSettingsPort } from "@mezan/backend";
import { readEnvOverrides, writeEnvOverrides, type BootEnv, type EnvOverrides } from "./env-overrides.js";

const hasText = (value: string | undefined): boolean => value !== undefined && value.trim() !== "";

function sameOverrides(a: EnvOverrides, b: EnvOverrides): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<EnvSettingKey>;
  return [...keys].every((key) => a[key] === b[key]);
}

/**
 * `check` must throw for any environment the server would refuse to start with: it is the same
 * parse (and, in production, the same start-up refusals) the entry point runs.
 */
export function createEnvSettings(boot: BootEnv, check: (env: Record<string, string | undefined>) => void, restart: () => void): PlatformEnvSettingsPort {
  const current = () => readEnvOverrides(boot.platformDir, boot.box);

  function list(): EnvSettingsDTO {
    const overrides = current();
    return {
      settings: Object.values(EnvSettingKey).map((key) => {
        const overridden = key in overrides;
        const value = overridden ? overrides[key] : boot.base[key];
        return {
          key,
          value: ENV_SETTINGS[key].secret ? null : (value ?? null),
          hasValue: hasText(value),
          source: overridden ? EnvSettingSource.Override : hasText(boot.base[key]) ? EnvSettingSource.EnvFile : EnvSettingSource.Unset,
        };
      }),
      readOnly: Object.values(EnvReadOnlyKey).map((key) => ({ key, hasValue: hasText(boot.base[key]) })),
      restartPending: !sameOverrides(overrides, boot.applied),
    };
  }

  function update(changes: Partial<Record<EnvSettingKey, string | null>>): EnvSettingKey[] {
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
    writeEnvOverrides(boot.platformDir, boot.box, next);
    return (Object.keys(changes) as EnvSettingKey[]).filter((key) => before[key] !== next[key]);
  }

  return { list, update, restart };
}
