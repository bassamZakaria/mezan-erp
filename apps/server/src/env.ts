import type { SmtpConfig } from "@mezan/api";
import type { ClientSourceOptions } from "./client-source.js";
import type { SmtpSecurity } from "@mezan/domain";
import type { ReviewTenantConfig } from "./review-tenant.js";

export enum PaymobMode {
  Live = "live",
  Test = "test",
  Off = "off",
}

export type PaymobEnv =
  | {
      readonly mode: PaymobMode.Live;
      readonly baseUrl: string;
      readonly secretKey: string;
      readonly publicKey: string;
      readonly hmacSecret: string;
      readonly integrationIds: readonly number[];
      readonly publicUrl: string;
      readonly apiKey?: string;
      readonly notFoundShapeConfirmed: boolean;
    }
  | { readonly mode: PaymobMode.Test; readonly publicUrl?: string }
  | { readonly mode: PaymobMode.Off };

export interface CloudEnv {
  readonly platformDir: string;
  readonly publicOrigin?: string;
  readonly tenantDomain?: string;
  readonly trustProxy: boolean;
  readonly clientSource: ClientSourceOptions;
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
  /**
   * The signup flow's outbound mail — there is no tenant yet to read
   * `TenantSettings` from, so this is its own platform-level config, built
   * from env vars. `undefined` means dev mode: the verification link is shown
   * on screen instead of mailed (see `signup-routes.ts`).
   */
  readonly platformSmtp?: SmtpConfig;
  readonly supportEmail?: string;
  readonly reviewTenant?: ReviewTenantConfig;
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
  const apiKey = trimmedOrUndefined(env["MEZAN_PAYMOB_API_KEY"]);
  if (apiKey && present === 0) throw new Error("MEZAN_PAYMOB_API_KEY is set without the live Paymob keys it belongs to");
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
      mode: PaymobMode.Live,
      baseUrl: parseOrigin(trimmedOrUndefined(env["MEZAN_PAYMOB_BASE_URL"]) ?? "https://accept.paymob.com", "MEZAN_PAYMOB_BASE_URL"),
      secretKey: secretKey!,
      publicKey: publicKey!,
      hmacSecret: hmacSecret!,
      integrationIds,
      publicUrl,
      ...(apiKey ? { apiKey } : {}),
      notFoundShapeConfirmed: env["MEZAN_PAYMOB_NOT_FOUND_CONFIRMED"] === "1",
    };
  }
  const test = testFlag === "1" || (testByDefault && testFlag !== "0");
  return test ? { mode: PaymobMode.Test, ...(publicUrl ? { publicUrl } : {}) } : { mode: PaymobMode.Off };
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

const SMTP_SECURITIES: readonly SmtpSecurity[] = ["NONE", "STARTTLS", "TLS"];

/**
 * `MEZAN_SMTP_HOST` is the on/off switch: unset means dev mode (no outbound
 * mail anywhere on the platform, not just signup — the verification link is
 * shown on screen instead). Set, it needs a sender address at minimum; the
 * rest fall back the same way the tenant email settings screen defaults them.
 */
function parsePlatformSmtp(env: Record<string, string | undefined>): SmtpConfig | undefined {
  const host = trimmedOrUndefined(env["MEZAN_SMTP_HOST"]);
  if (!host) return undefined;
  const fromEmail = trimmedOrUndefined(env["MEZAN_SMTP_FROM_EMAIL"]);
  if (!fromEmail) throw new Error("MEZAN_SMTP_FROM_EMAIL is required once MEZAN_SMTP_HOST is set");
  const security = trimmedOrUndefined(env["MEZAN_SMTP_SECURITY"]) ?? "STARTTLS";
  if (!SMTP_SECURITIES.includes(security as SmtpSecurity)) {
    throw new Error(`MEZAN_SMTP_SECURITY must be one of ${SMTP_SECURITIES.join(", ")}, got "${security}"`);
  }
  return {
    smtpEnabled: true,
    smtpHost: host,
    smtpPort: parsePositiveInt(env["MEZAN_SMTP_PORT"], "MEZAN_SMTP_PORT", 587),
    smtpSecurity: security as SmtpSecurity,
    smtpUsername: trimmedOrUndefined(env["MEZAN_SMTP_USERNAME"]) ?? "",
    smtpPassword: env["MEZAN_SMTP_PASSWORD"] ?? "",
    smtpFromName: trimmedOrUndefined(env["MEZAN_SMTP_FROM_NAME"]) ?? "Mezan",
    smtpFromEmail: fromEmail,
  };
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TENANT_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
const PUBLISHED_DEMO_PIN = "123456";
const DEMO_TENANT_CODE = "demo";

function parseSupportEmail(value: string | undefined): string | undefined {
  const email = trimmedOrUndefined(value);
  if (email === undefined) return undefined;
  if (!EMAIL_PATTERN.test(email)) throw new Error(`MEZAN_SUPPORT_EMAIL must be an e-mail address, got "${email}"`);
  return email;
}

function parseReviewTenant(env: Record<string, string | undefined>): ReviewTenantConfig | undefined {
  const code = trimmedOrUndefined(env["MEZAN_REVIEW_TENANT_CODE"]);
  const pin = trimmedOrUndefined(env["MEZAN_REVIEW_PIN"]);
  if (code === undefined && pin === undefined) return undefined;
  if (code === undefined || pin === undefined) {
    throw new Error("MEZAN_REVIEW_TENANT_CODE and MEZAN_REVIEW_PIN are set together or not at all");
  }
  if (!TENANT_CODE_PATTERN.test(code) || code === DEMO_TENANT_CODE) {
    throw new Error(`MEZAN_REVIEW_TENANT_CODE must be 2-40 lower-case letters, digits or hyphens and not "${DEMO_TENANT_CODE}", got "${code}"`);
  }
  if (!/^\d{6}$/.test(pin)) throw new Error("MEZAN_REVIEW_PIN must be exactly six digits");
  if (pin === PUBLISHED_DEMO_PIN) throw new Error("MEZAN_REVIEW_PIN must not be the PIN published in this repository");
  if (flag(env["MEZAN_SEED_DEMO"])) {
    throw new Error("MEZAN_REVIEW_TENANT_CODE cannot be combined with MEZAN_SEED_DEMO=1: the demo's basic auth would block the reviewer's app");
  }
  return { code, pin };
}

const TRUSTED_ADDRESS_HEADER_VAR = "MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER";
const HEADER_NAME = /^[a-z0-9][a-z0-9-]*$/;
const CALLER_WRITTEN_HEADERS: ReadonlySet<string> = new Set(["x-forwarded-for", "forwarded"]);

function parseClientSource(env: Record<string, string | undefined>): ClientSourceOptions {
  const trustProxy = flag(env["MEZAN_TRUST_PROXY"]);
  const hops = parseNonNegativeInt(env["MEZAN_TRUSTED_PROXY_HOPS"], "MEZAN_TRUSTED_PROXY_HOPS", 0);
  if (hops > 0 && !trustProxy) {
    throw new Error("MEZAN_TRUSTED_PROXY_HOPS needs MEZAN_TRUST_PROXY=1: without a trusted proxy the forwarded chain is whatever the caller wrote");
  }
  if (trustProxy && hops === 0) {
    throw new Error(
      "MEZAN_TRUST_PROXY=1 needs MEZAN_TRUSTED_PROXY_HOPS set to the number of proxies that append to x-forwarded-for (1 or more): a guessed count reads another machine's address as the caller's",
    );
  }
  const originSecret = trimmedOrUndefined(env["MEZAN_ORIGIN_SECRET"]) !== undefined;
  const viewer = flag(env["MEZAN_TRUST_VIEWER_ADDRESS"]);
  if (viewer && (!trustProxy || !originSecret)) {
    throw new Error(
      "MEZAN_TRUST_VIEWER_ADDRESS needs MEZAN_TRUST_PROXY=1 and MEZAN_ORIGIN_SECRET: CloudFront-Viewer-Address is only CloudFront's word when nothing reaches the origin except through it",
    );
  }
  const header = trimmedOrUndefined(env[TRUSTED_ADDRESS_HEADER_VAR])?.toLowerCase();
  if (header !== undefined) {
    if (!trustProxy) {
      throw new Error(`${TRUSTED_ADDRESS_HEADER_VAR} needs MEZAN_TRUST_PROXY=1: with no trusted proxy every header is the caller's own word`);
    }
    if (!HEADER_NAME.test(header) || CALLER_WRITTEN_HEADERS.has(header)) {
      throw new Error(
        `${TRUSTED_ADDRESS_HEADER_VAR} must name one header the edge overwrites on every request (for example cf-connecting-ip), got "${header}"`,
      );
    }
  }
  return {
    trustedProxyHops: hops,
    trustViewerAddress: viewer,
    compareViewerAddress: trustProxy && originSecret,
    ...(header === undefined ? {} : { trustedAddressHeader: header }),
  };
}

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOSTNAME_MAX_LENGTH = 253;

function parseTenantDomain(value: string | undefined): string | undefined {
  const raw = trimmedOrUndefined(value);
  if (raw === undefined) return undefined;
  const domain = raw.toLowerCase();
  if (domain.length > HOSTNAME_MAX_LENGTH || !domain.split(".").every((label) => HOSTNAME_LABEL.test(label))) {
    throw new Error(`MEZAN_TENANT_DOMAIN must be a bare hostname such as "mezan.app" (no scheme, port, path, wildcard or trailing dot), got "${raw}"`);
  }
  return domain;
}

function publicOriginOf(env: Record<string, string | undefined>): { readonly publicOrigin?: string } {
  const value = trimmedOrUndefined(env["MEZAN_PUBLIC_URL"]);
  return value ? { publicOrigin: parseOrigin(value, "MEZAN_PUBLIC_URL") } : {};
}

export function parseEnv(env: Record<string, string | undefined> = process.env, options: ParseEnvOptions = {}): CloudEnv {
  return {
    platformDir: env["MEZAN_PLATFORM_DIR"] ?? ".data/platform",
    ...publicOriginOf(env),
    tenantDomain: parseTenantDomain(env["MEZAN_TENANT_DOMAIN"]),
    trustProxy: flag(env["MEZAN_TRUST_PROXY"]),
    clientSource: parseClientSource(env),
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
    platformSmtp: parsePlatformSmtp(env),
    supportEmail: parseSupportEmail(env["MEZAN_SUPPORT_EMAIL"]),
    reviewTenant: parseReviewTenant(env),
  };
}
