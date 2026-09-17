import type { Context, MiddlewareHandler } from "hono";

/**
 * License write-gate (docs/archive/plan.md §2.5) — the server-side teeth behind the
 * "licensing lapse NEVER withholds data" ethic baked into
 * `@mezan/domain/licensing`. Past grace a license resolves to READ_ONLY: every
 * record stays readable, printable and exportable, only NEW postings are
 * blocked. This middleware is where "blocked" is actually enforced, at the one
 * choke point every mutating request passes through — never trusting the
 * renderer to disable its own buttons.
 *
 * The domain owns the state decision (`verifyLicense` → `canWrite`); this is
 * only the transport binding, resolved per request via the injected
 * `resolveLicenseState` so the API layer never assumes a source (desktop reads
 * the verified offline license; cloud reads the tenant).
 */

/** Non-usable states carry a machine reason; usable ones may still be READ_ONLY. */
export type LicenseStateName =
  | "ACTIVE"
  | "GRACE"
  | "READ_ONLY"
  | "INVALID"
  | "TAMPERED"
  | "NOT_YET_VALID"
  | "FINGERPRINT_MISMATCH"
  /** The licensing service says this licence was withdrawn. Read-only. */
  | "REVOKED"
  | "UNLICENSED";

/**
 * The license as the app operates under it, shaped for both the write gate and
 * the renderer's banner (`GET /license/state`). `canWrite` is the ONLY field
 * the gate consults; the rest drive the UI's escalating message.
 */
export interface LicenseStateView {
  readonly state: LicenseStateName;
  /** Whether new postings/writes are permitted (false in READ_ONLY / unusable). */
  readonly canWrite: boolean;
  /** Whether the license is authentic and time-usable (data is viewable). */
  readonly usable: boolean;
  readonly licensee?: string;
  readonly expiresAt?: string;
  /** End of the writable grace window, when in GRACE. */
  readonly graceEndsAt?: string;
  /** Machine-readable reason for a non-writable/unusable result. */
  readonly reason?: string;
  /**
   * Arabic, ready to render, when the generic banner copy would be WRONG for
   * this particular reason — «جدّد الترخيص» for a build that shipped without a
   * vendor key, or for a valid licence that has merely not been online, sends
   * the shop to buy something they already own. Absent means the banner's own
   * copy for `state` is correct.
   */
  readonly messageAr?: string;
  /**
   * Days since the last successful online check-in, when `reason` is
   * `CHECKIN_OVERDUE`. The blocking notice counts in days, not in states.
   */
  readonly daysSince?: number;
  /**
   * True when the shell must put a blocking notice over the window rather than
   * a banner beside it. The threshold lives in the main process, not in the
   * renderer, so there is one place that decides how long is too long.
   */
  readonly blocking?: boolean;
  /**
   * This machine's salted fingerprint hash. The one value support needs to bind
   * a replacement PC, and the product's only place to read it off a screen.
   */
  readonly fingerprint?: string | null;
}

/** Full read/write — the default whenever no license source is wired (cloud, tests). */
export const WRITABLE_LICENSE_STATE: LicenseStateView = {
  state: "ACTIVE",
  canWrite: true,
  usable: true,
};

export type LicenseStateResolver = (
  c: Context,
) => LicenseStateView | Promise<LicenseStateView>;

/** Methods that never mutate — always allowed, license state notwithstanding. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Path prefixes whose mutations must survive READ_ONLY, or the lockout becomes
 * a trap: you could neither sign in to SEE your (still-readable) data, nor
 * activate the new license that lifts the lockout. `/bootstrap` is here for
 * the same reason on a tenant that has never been licensed at all — a fresh
 * "provisioning" tenant resolves UNLICENSED, and both of its routes are
 * self-closing regardless: `/bootstrap/seed` is a no-op once the tenant is
 * non-empty, `/bootstrap/admin` refuses with 409 once it is claimed.
 */
const DEFAULT_WRITE_ALLOWLIST: readonly string[] = ["/auth", "/license", "/bootstrap"];

export interface WriteGateOptions {
  /** Path prefixes exempt from the read-only block for mutating methods. */
  readonly allowlist?: readonly string[];
}

function isAllowlisted(path: string, allowlist: readonly string[]): boolean {
  return allowlist.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Builds the middleware. Mount it once, first, at `app.use("*", ...)`: it lets
 * every safe method and every allowlisted path through untouched, and refuses
 * mutating methods with 403 `LICENSE_READ_ONLY` whenever the resolved license
 * cannot write. The Arabic message is the one the operator reads — it names the
 * lapse and what still works, not a raw enum.
 */
export function createWriteGate(
  resolveLicenseState: LicenseStateResolver,
  options: WriteGateOptions = {},
): MiddlewareHandler {
  const allowlist = options.allowlist ?? DEFAULT_WRITE_ALLOWLIST;
  return async function licenseWriteGate(c, next) {
    if (SAFE_METHODS.has(c.req.method)) return next();

    const path = new URL(c.req.url).pathname;
    if (isAllowlisted(path, allowlist)) return next();

    const license = await resolveLicenseState(c);
    if (license.canWrite) return next();

    return c.json(
      {
        error: "LICENSE_READ_ONLY",
        state: license.state,
        reason: license.reason ?? "EXPIRED_PAST_GRACE",
        // Arabic-first: domain refusals surface to the operator in Arabic
        // (working-agreement.md), never raw English enum text. A state that
        // carries its own sentence wins — telling a shop whose licence is
        // valid but merely offline to "renew" sends them to buy what they own.
        message:
          license.messageAr ??
          "الترخيص غير فعّال حاليًا، والبرنامج في وضع القراءة فقط. كل بياناتك " +
            "متاحة للعرض والطباعة والتصدير، لكن لا يمكن حفظ أي حركة جديدة حتى " +
            "تجديد الترخيص.",
      },
      403,
    );
  };
}
