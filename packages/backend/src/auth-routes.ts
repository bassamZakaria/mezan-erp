import { Hono, type Context } from "hono";
import {
  saveUser,
  recordSuccessfulLogin,
  ALL_SCOPE,
  InvalidUserError,
  DuplicateUserEmailError,
  recordSecurityEvent,
  type AuditSink,
  type UnitOfWork,
  type SecretHasher,
  type SettingsRepository,
  type User,
} from "@mezan/domain";
import { loginRequestSchema, bootstrapAdminRequestSchema, type SessionDTO } from "@mezan/contracts";
import {
  createLoginThrottle,
  readSessionToken,
  requestOrigin,
  throttleKey,
  type LoginThrottle,
  type SessionRegistry,
} from "@mezan/api";
import { SEED_ADMIN_USER_ID, SEED_TENANT_NAME, currentCounts, seedIfEmpty, type SeedStores } from "./seed.js";

export interface AuthRoutesDeps {
  readonly uow: UnitOfWork;
  readonly hasher: SecretHasher;
  readonly settings: SettingsRepository;
  readonly seedStores: SeedStores;
  /** Where a successful login's grant is recorded; the token is the only thing the client gets back. */
  readonly sessions: SessionRegistry;
  /** Failed-attempt lockout. Defaults to a fresh in-memory throttle per app. */
  readonly loginThrottle?: LoginThrottle;
  /**
   * The forensic trail for the credential boundary.
   *
   * Without it the product could not answer "who tried to sign in as the owner
   * last night" at all: failures wrote nothing, lockouts — which this codebase's
   * own severity taxonomy names as the canonical CRITICAL event — wrote nothing,
   * and there was no success event either, so the audit trail could not even
   * establish that a session had existed, only what it went on to do.
   */
  readonly audit?: AuditSink;
}

async function tenantName(settings: SettingsRepository): Promise<string> {
  const s = await settings.get();
  return s?.companyName && s.companyName.trim() !== "" ? s.companyName : SEED_TENANT_NAME;
}

/**
 * @param origin where the socket says this login arrived from — null for the
 * desktop's in-process mount. The session is BOUND to it (see
 * @mezan/api's session-auth.ts), so it is read from `requestOrigin(c)` and
 * never from anything in the request body or headers.
 */
async function toSession(user: User, deps: AuthRoutesDeps, origin: string | null): Promise<SessionDTO> {
  let permissions: string[];
  let roleCode: string | null = null;
  if (user.isCompanyAdmin) {
    permissions = ["*"];
  } else if (user.roleId) {
    const role = await deps.uow.roles.findById(user.roleId);
    permissions = role ? [...role.permissions] : [];
    roleCode = role?.code ?? null;
  } else {
    permissions = [];
  }
  return {
    userId: user.id,
    nameAr: user.nameAr,
    nameEn: user.nameEn,
    email: user.email,
    isCompanyAdmin: user.isCompanyAdmin,
    permissions,
    roleCode,
    photoUrl: user.photoUrl,
    branchScope: user.branchScope === ALL_SCOPE ? "*" : [...user.branchScope],
    warehouseScope: user.warehouseScope === ALL_SCOPE ? "*" : [...user.warehouseScope],
    tenantName: await tenantName(deps.settings),
    // The client gets a token and nothing else it could forge with. The
    // permissions travel too, but only so the UI can hide what the user cannot
    // do — the server re-reads them from this session on every request and
    // never from what comes back.
    token: deps.sessions.issue(
      {
        userId: user.id,
        permissions,
        roleCode,
        branchScope: user.branchScope,
        warehouseScope: user.warehouseScope,
      },
      origin,
    ),
  };
}

/**
 * "900 ثانية" is not a wait a person can act on. Past two minutes the honest
 * unit is minutes; the exact second count still travels as `retryAfterSeconds`
 * so the client can run a countdown against it.
 */
function waitPhrase(seconds: number): string {
  if (seconds < 120) return `${seconds} ثانية`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes === 2) return "دقيقتين";
  if (minutes <= 10) return `${minutes} دقائق`;
  return `${minutes} دقيقة`;
}

/**
 * Real auth + first-run bootstrap routes (docs/archive/plan.md — desktop username+PIN):
 *   POST /auth/login          verify user + PIN, return the resolved session
 *   POST /bootstrap/seed      idempotently seed an empty DB (wizard seed step)
 *   POST /bootstrap/admin     create the first-run admin, return their session
 *
 * These are intentionally UNGATED: login has no session yet, and the bootstrap
 * routes run before any user could authenticate (local desktop first-run).
 * "Ungated" is not "unguarded": login throttles, and `/bootstrap/admin` refuses
 * once this tenant has RECORDED that somebody claimed it.
 *
 * On the desktop edition the LAN host does not expose `/bootstrap/*` at all
 * (apps/desktop/src/main/lan-host.ts's allow-list) — this guard is the second
 * of two, not the only one.
 */
export function createAuthRoutes(deps: AuthRoutesDeps) {
  const app = new Hono();
  const throttle = deps.loginThrottle ?? createLoginThrottle();

  /**
   * A hash to verify against when the account does not exist, so a miss costs
   * the same scrypt a hit does. Built once, lazily — hashing on every mount
   * would slow every app construction, including the tests'.
   */
  let decoy: Promise<string> | null = null;
  const decoyHash = () => (decoy ??= deps.hasher.hash("mezan-login-timing-decoy"));

  function security(c: Context, action: string, severity: "CRITICAL" | "WARNING" | "INFO", details: Record<string, unknown>) {
    if (!deps.audit) return Promise.resolve();
    return recordSecurityEvent(deps.audit, {
      module: "auth",
      entityType: "AUTH_USER",
      entityId: typeof details["userId"] === "string" ? (details["userId"] as string) : null,
      action,
      actor: typeof details["userId"] === "string" ? (details["userId"] as string) : "anonymous",
      severity,
      details: { ...details, origin: requestOrigin(c) ?? "host" },
    }).catch(() => undefined);
  }

  function lockedOut(c: Context, seconds: number) {
    c.header("retry-after", String(seconds));
    return c.json(
      {
        error: "TOO_MANY_ATTEMPTS",
        retryAfterSeconds: seconds,
        message: `محاولات دخول كثيرة. حاول بعد ${waitPhrase(seconds)}.`,
      },
      429,
    );
  }

  /**
   * True once somebody has claimed this tenant.
   *
   * Read from a RECORDED FACT (`settings.tenantClaimedAt`), with one fallback:
   * an install provisioned before that field existed has no timestamp, so the
   * presence of any user other than the seeded fallback admin — matched by its
   * FIXED ID, never by an editable email or an editable status — still counts.
   * Both halves of the old predicate were master data an admin could edit, so a
   * fully provisioned shop could be walked back to "unclaimed" and re-taken
   * with one anonymous POST.
   */
  async function tenantIsClaimed(): Promise<boolean> {
    const settings = await deps.settings.get();
    if (settings?.tenantClaimedAt) return true;
    const users = await deps.uow.users.list();
    return users.some((u) => u.id !== SEED_ADMIN_USER_ID);
  }

  /** Writes the claim once. Never cleared, and unreachable from `PUT /settings`. */
  async function recordTenantClaim(at: string): Promise<void> {
    const settings = await deps.settings.get();
    if (!settings || settings.tenantClaimedAt) return;
    await deps.settings.save({ ...settings, tenantClaimedAt: at });
  }

  /**
   * Retires the seeded fallback admin the moment a real one exists.
   *
   * `USER-ADMIN` is created so a fresh tenant is never account-less, and on a
   * packaged build its PIN is generated. It was then left ACTIVE forever, with
   * `isCompanyAdmin: true` — a permanent, unattributable `["*"]` account on
   * every install, which is the classic "generic admin account" audit finding
   * arrived at through the front door. Three things followed from it: the
   * tenant admin could quietly claim it by setting a PIN of their own choosing
   * and share it; an auditor asking "whose account is this" got no answer; and
   * whoever installed the software — typically the vendor's technician, not the
   * owner — could set `MEZAN_SEED_ADMIN_PIN` before first run and leave with a
   * permanent key.
   *
   * Claiming the tenant is exactly the moment it stops being needed, so that is
   * when it is deactivated. It is not deleted: `--reset-admin` reactivates it
   * from the machine's own filesystem, which is the recovery door for an owner
   * who has lost their PIN, and deleting the row would take the audit history
   * that points at it with it.
   */
  async function retireSeedAdmin(): Promise<void> {
    const seed = await deps.uow.users.findById(SEED_ADMIN_USER_ID);
    if (!seed || seed.status !== "active") return;
    await deps.uow.users.save({ ...seed, status: "inactive" });
  }

  app.post("/auth/login", async (c) => {
    const parsed = loginRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const { username, pin } = parsed.data;
    const needle = username.trim().toLowerCase();
    // Remote callers are counted per (account, source); the host's own console
    // is counted per account. See login-throttle.ts — this is what stops one
    // phone on the shop wifi from taking the counter out of service.
    const key = throttleKey(needle, requestOrigin(c));

    const waitSeconds = throttle.retryAfter(key);
    if (waitSeconds > 0) {
      await security(c, "LOGIN_BLOCKED", "WARNING", { username: needle, retryAfterSeconds: waitSeconds });
      return lockedOut(c, waitSeconds);
    }

    // The email, and only the email. Matching the FULL NAME, as this did, made
    // "who can log in" a property of a field any admin may edit, and two people
    // who share a display name shared an account door.
    const user = await deps.uow.users.findByEmail(needle);
    // An unknown email used to return before any hashing happened, so the
    // response time answered "does this account exist" for free. Verify against
    // a throwaway hash instead, and spend the same scrypt either way.
    const ok =
      user && user.status === "active" && user.pinHash
        ? await deps.hasher.verify(pin, user.pinHash)
        : (await deps.hasher.verify(pin, await decoyHash()), false);
    if (!user || !ok) {
      const lockedFor = throttle.fail(key);
      if (lockedFor > 0) {
        // The taxonomy in audit/audit-event.ts names account lockout as the
        // canonical CRITICAL event. It wrote nothing until now.
        await security(c, "ACCOUNT_LOCKED", "CRITICAL", { username: needle, lockedForSeconds: lockedFor });
        return lockedOut(c, lockedFor);
      }
      await security(c, "LOGIN_FAILED", "WARNING", { username: needle });
      return c.json({ error: "INVALID_CREDENTIALS", message: "اسم المستخدم أو رمز PIN غير صحيح." }, 401);
    }
    throttle.succeed(key);
    const at = new Date().toISOString();
    await recordSuccessfulLogin(user.id, at, deps.uow);
    await security(c, "LOGIN_SUCCEEDED", "INFO", { userId: user.id, username: needle });
    // The session is bound to the origin the CREDENTIAL was verified from, so
    // the till that logged in is the only place the token it got back works.
    return c.json(await toSession(user, deps, requestOrigin(c)));
  });

  /**
   * Ends the session server-side. Without this a token stayed valid until it
   * idled out.
   *
   * THE ORIGIN IS CHECKED, exactly as every other lookup in the product checks
   * it. This route is on the LAN socket's public list — it has to be, a till
   * signs out over the same socket it signed in on — and it was the ONE place a
   * token was acted on without asking `find()` whether the caller was where the
   * token was minted. A captured token is worth an admin session for twelve
   * hours, but a token that only ever appears in a `POST /auth/logout` is worth
   * something quieter and just as useful to an attacker: signing the owner out
   * of the counter, repeatedly, from anywhere on the wifi. `find()` with the
   * origin is what makes revoking a session require being the machine that
   * holds it.
   *
   * It still answers `{ ok: true }` either way. A logout that reports whether
   * the token it was handed was real would be a token oracle, and the caller
   * has nothing to do differently: the session it wanted ended is, from its
   * side, ended.
   */
  app.post("/auth/logout", (c) => {
    const token = readSessionToken(c);
    if (token && deps.sessions.find(token, requestOrigin(c))) deps.sessions.revoke(token);
    return c.json({ ok: true });
  });

  /**
   * Pre-login tenant identity for the first-run wizard header — an
   * UNAUTHENTICATED lookup on a code anyone can guess, exactly the shape
   * `/platform/resolve` was fixed to stop leaking a tenant's real name
   * pre-auth (`tenant-router.ts`). The login screen itself never reads the
   * name back (see `login.tenantResolved`); the one real caller is the
   * first-run wizard's greeting, and a wizard only ever runs on a tenant
   * nobody has claimed yet.
   *
   * So this answers the real configured name only while the tenant is
   * UNCLAIMED — where it is still whatever the seed left it at, not
   * something a real owner has set. The moment someone claims the tenant
   * (`POST /bootstrap/admin`) and later types their real trading name into
   * Settings, this route stops echoing it: a caller who merely guessed a
   * live tenant's code on the cloud edition, where many tenants share one
   * host, gets the same generic placeholder a brand-new install would.
   */
  app.get("/tenant", async (c) => {
    if (await tenantIsClaimed()) return c.json({ name: SEED_TENANT_NAME });
    return c.json({ name: await tenantName(deps.settings) });
  });

  /**
   * What base data already exists, and — the part the login screen needs —
   * whether anybody has claimed this install yet.
   *
   * A fresh packaged install landed on a login screen with an empty account
   * list, a blank email box and nothing saying the machine had never been set
   * up; the only account that existed had a PIN nobody knows. The owner typed
   * their own name, failed five times, and was locked out of a brand-new
   * install inside ninety seconds. The client can now open the wizard instead.
   */
  app.get("/bootstrap/status", async (c) => {
    return c.json({ ...(await currentCounts(deps.seedStores)), claimed: await tenantIsClaimed() });
  });

  /**
   * Seeds an EMPTY tenant, and reports the counts either way.
   *
   * NOT guarded on `tenantIsClaimed()`, and that is deliberate — guarding it
   * there was a regression, caught by walking the wizard's own steps: the
   * first-run wizard runs `activate → admin → seed → import`, so its seed step
   * executes AFTER `/bootstrap/admin` has claimed the tenant. A claim-based
   * guard 409s the wizard on its own next click, on a brand-new install, which
   * is the one flow this route exists for.
   *
   * The real invariant is emptiness, and `seedIfEmpty` already enforces it: on
   * a tenant that has any accounts this is a no-op that returns the current
   * counts. So the worst an anonymous caller achieves is seeding a tenant that
   * has nothing in it yet, or reading the same counts `/bootstrap/status`
   * reports — and on the desktop edition neither is reachable from the LAN
   * socket at all, because `/bootstrap/*` is off its path allow-list.
   */
  app.post("/bootstrap/seed", async (c) => {
    const result = await seedIfEmpty(deps.seedStores);
    return c.json(result);
  });

  /**
   * Claims a FRESH install. Ungated by necessity — there is nobody to
   * authenticate as yet — so the guard has to be that there is nothing to take:
   * the moment this tenant records a claim, this route is closed forever.
   *
   * It used to have no such guard, and the consequence was measured on a fully
   * provisioned tenant: an anonymous POST returned a live company-admin session
   * (`permissions: ["*"]`), which then read customers, users and the trial
   * balance. On the LAN mount that was the whole business, from the shop wifi,
   * with no credential.
   */
  app.post("/bootstrap/admin", async (c) => {
    const parsed = bootstrapAdminRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    if (await tenantIsClaimed()) {
      await security(c, "BOOTSTRAP_REFUSED", "CRITICAL", { email: parsed.data.email });
      return c.json(
        {
          error: "TENANT_ALREADY_PROVISIONED",
          message: "تم إعداد هذه المنشأة بالفعل. سجّل الدخول بحسابك.",
        },
        409,
      );
    }
    await seedIfEmpty(deps.seedStores);
    try {
      const user = await saveUser(
        {
          id: crypto.randomUUID(),
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn,
          email: parsed.data.email,
          phone: null,
          password: `pw-${crypto.randomUUID()}`,
          pin: parsed.data.pin,
          roleId: null,
          isCompanyAdmin: true,
          employeeId: null,
          branchScope: ALL_SCOPE,
          warehouseScope: ALL_SCOPE,
          status: "active",
          createdAt: new Date().toISOString(),
        },
        deps.uow,
        deps.hasher,
      );
      await recordTenantClaim(new Date().toISOString());
      await retireSeedAdmin();
      // The single highest-authority write in the product, and it recorded
      // nothing at all — so a company admin appearing from nowhere was
      // indistinguishable, afterwards, from one that had always been there.
      await security(c, "TENANT_CLAIMED", "CRITICAL", {
        userId: user.id,
        email: user.email,
        seedAdminRetired: true,
      });
      return c.json(await toSession(user, deps, requestOrigin(c)), 201);
    } catch (err) {
      // This used to hand back the EXISTING admin's session for wizard
      // idempotency — an anonymous caller who guessed a known admin address got
      // that admin's token. A duplicate is now just a duplicate; a retrying
      // wizard sends the person to the login screen, which is where they belong
      // once the account exists.
      if (err instanceof DuplicateUserEmailError) {
        return c.json({ error: err.code, message: err.message }, 409);
      }
      if (err instanceof InvalidUserError) {
        return c.json({ error: err.code, message: err.message }, 400);
      }
      throw err;
    }
  });

  return app;
}
