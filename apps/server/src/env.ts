export type PaymobEnv =
  | {
      readonly mode: "live";
      readonly baseUrl: string;
      readonly secretKey: string;
      readonly publicKey: string;
      readonly hmacSecret: string;
      readonly integrationIds: readonly number[];
      readonly publicUrl: string;
    }
  | { readonly mode: "test"; readonly publicUrl?: string }
  | { readonly mode: "off" };

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
  readonly paymob: PaymobEnv;
}

export interface ParseEnvOptions {
  /** The dev entrypoint runs card checkout against the local test double when no Paymob keys are set; the deployed entrypoint does not. */
  readonly paymobTestByDefault?: boolean;
}

const PAYMOB_LIVE_VARS = [
  "MEZAN_PAYMOB_SECRET_KEY",
  "MEZAN_PAYMOB_PUBLIC_KEY",
  "MEZAN_PAYMOB_HMAC_SECRET",
  "MEZAN_PAYMOB_INTEGRATION_ID",
] as const;

function parseOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL, got "${value}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must be http(s), got "${value}"`);
  return url.origin;
}

function parsePaymob(env: Record<string, string | undefined>, testByDefault: boolean): PaymobEnv {
  const values = PAYMOB_LIVE_VARS.map((name) => trimmedOrUndefined(env[name]));
  const present = values.filter((v) => v !== undefined).length;
  const testFlag = env["MEZAN_PAYMOB_TEST_MODE"];
  const publicUrlRaw = trimmedOrUndefined(env["MEZAN_PAYMOB_PUBLIC_URL"]);
  const publicUrl = publicUrlRaw ? parseOrigin(publicUrlRaw, "MEZAN_PAYMOB_PUBLIC_URL") : undefined;
  if (present > 0 && present < PAYMOB_LIVE_VARS.length) {
    const missing = PAYMOB_LIVE_VARS.filter((_, i) => values[i] === undefined);
    throw new Error(`Paymob is partly configured; also set ${missing.join(", ")}`);
  }
  if (present === PAYMOB_LIVE_VARS.length) {
    if (testFlag === "1") throw new Error("MEZAN_PAYMOB_TEST_MODE=1 cannot be combined with live Paymob keys");
    if (!publicUrl) throw new Error("MEZAN_PAYMOB_PUBLIC_URL is required with live Paymob keys (the callback and return URLs)");
    const [secretKey, publicKey, hmacSecret, integrationRaw] = values as string[];
    const integrationIds = integrationRaw!.split(",").map((part) => Number(part.trim()));
    if (integrationIds.length === 0 || integrationIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error(`MEZAN_PAYMOB_INTEGRATION_ID must be comma-separated positive integers, got "${integrationRaw}"`);
    }
    return {
      mode: "live",
      baseUrl: parseOrigin(trimmedOrUndefined(env["MEZAN_PAYMOB_BASE_URL"]) ?? "https://accept.paymob.com", "MEZAN_PAYMOB_BASE_URL"),
      secretKey: secretKey!,
      publicKey: publicKey!,
      hmacSecret: hmacSecret!,
      integrationIds,
      publicUrl,
    };
  }
  const test = testFlag === "1" || (testByDefault && testFlag !== "0");
  return test ? { mode: "test", ...(publicUrl ? { publicUrl } : {}) } : { mode: "off" };
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

export function parseEnv(env: Record<string, string | undefined> = process.env, options: ParseEnvOptions = {}): CloudEnv {
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
    paymob: parsePaymob(env, options.paymobTestByDefault ?? false),
  };
}
