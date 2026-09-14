/**
 * The environment contract every cloud entrypoint parses once at start
 * (docs/superpowers/plans/2026-09-14-saas-slice-c-deploy.md). Reading
 * `process.env` more than once per field would let two callers in the same
 * process disagree about what the deployment was configured with.
 */
export interface CloudEnv {
  readonly platformDir: string;
  readonly tenantDomain?: string;
  readonly trustProxy: boolean;
  readonly originSecret?: string;
  readonly sqliteExclusive: boolean;
  readonly platformOwnerEmail?: string;
  readonly platformOwnerPassword?: string;
  readonly seedDemo: boolean;
  readonly seedAdminPin?: string;
  readonly backupIntervalMinutes: number;
  readonly webDist: string;
  readonly demoPassword?: string;
  readonly analyticsToken?: string;
  readonly port: number;
}

function flag(value: string | undefined): boolean {
  return value === "1";
}

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseNonNegativeInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

export function parseEnv(env: Record<string, string | undefined> = process.env): CloudEnv {
  return {
    platformDir: env["MEZAN_PLATFORM_DIR"] ?? ".data/platform",
    tenantDomain: trimmedOrUndefined(env["MEZAN_TENANT_DOMAIN"]),
    trustProxy: flag(env["MEZAN_TRUST_PROXY"]),
    originSecret: trimmedOrUndefined(env["MEZAN_ORIGIN_SECRET"]),
    sqliteExclusive: flag(env["MEZAN_SQLITE_EXCLUSIVE"]),
    platformOwnerEmail: trimmedOrUndefined(env["MEZAN_PLATFORM_OWNER_EMAIL"]),
    platformOwnerPassword: trimmedOrUndefined(env["MEZAN_PLATFORM_OWNER_PASSWORD"]),
    seedDemo: flag(env["MEZAN_SEED_DEMO"]),
    seedAdminPin: trimmedOrUndefined(env["MEZAN_SEED_ADMIN_PIN"]),
    backupIntervalMinutes: parseNonNegativeInt(env["MEZAN_BACKUP_INTERVAL_MINUTES"], "MEZAN_BACKUP_INTERVAL_MINUTES", 15),
    webDist: env["MEZAN_WEB_DIST"] ?? "./apps/web/dist",
    demoPassword: trimmedOrUndefined(env["MEZAN_DEMO_PASSWORD"]),
    analyticsToken: trimmedOrUndefined(env["MEZAN_ANALYTICS_TOKEN"]),
    port: parsePositiveInt(env["PORT"], "PORT", 8080),
  };
}
