import { Hono, type Context } from "hono";
import {
  saveUser,
  ALL_SCOPE,
  InvalidUserError,
  DuplicateUserEmailError,
  type UnitOfWork,
  type SecretHasher,
  type SettingsRepository,
  type User,
} from "@mezan/domain";
import { loginRequestSchema, bootstrapAdminRequestSchema, type SessionDTO } from "@mezan/contracts";
import { createLoginThrottle, readSessionToken, type LoginThrottle, type SessionRegistry } from "@mezan/api";
import { SEED_ADMIN_EMAIL, SEED_TENANT_NAME, currentCounts, seedIfEmpty, type SeedStores } from "./seed.js";

export interface AuthRoutesDeps {
  readonly uow: UnitOfWork;
  readonly hasher: SecretHasher;
  readonly settings: SettingsRepository;
  readonly seedStores: SeedStores;
  /** Where a successful login's grant is recorded; the token is the only thing the client gets back. */
  readonly sessions: SessionRegistry;
  /** Failed-attempt lockout. Defaults to a fresh in-memory throttle per app. */
  readonly loginThrottle?: LoginThrottle;
}

async function tenantName(settings: SettingsRepository): Promise<string> {
  const s = await settings.get();
  return s?.companyName && s.companyName.trim() !== "" ? s.companyName : SEED_TENANT_NAME;
}

async function toSession(user: User, deps: AuthRoutesDeps): Promise<SessionDTO> {
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
    token: deps.sessions.issue({
      userId: user.id,
      permissions,
      roleCode,
      branchScope: user.branchScope,
      warehouseScope: user.warehouseScope,
    }),
  };
}

/**
 * Real auth + first-run bootstrap routes (docs/archive/plan.md — desktop username+PIN):
 *   POST /auth/login          verify user + PIN, return the resolved session
 *   POST /bootstrap/seed      idempotently seed an empty DB (wizard seed step)
 *   POST /bootstrap/admin     create the first-run admin, return their session
 *
 * These are intentionally UNGATED: login has no session yet, and the bootstrap
 * routes run before any user could authenticate (local desktop first-run).
 * "Ungated" is not "unguarded": login throttles per account, and
 * `/bootstrap/admin` refuses once the tenant has an account of its own.
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

  function lockedOut(c: Context, seconds: number) {
    c.header("retry-after", String(seconds));
    return c.json(
      {
        error: "TOO_MANY_ATTEMPTS",
        retryAfterSeconds: seconds,
        message: `محاولات دخول كثيرة. حاول بعد ${seconds} ثانية.`,
      },
      429,
    );
  }

  /**
   * True once this tenant belongs to somebody: any active account other than
   * the seeded default admin. While false the install is a fresh, unclaimed
   * first run and `/bootstrap/admin` is how the owner claims it.
   */
  async function tenantIsClaimed(): Promise<boolean> {
    const users = await deps.uow.users.list();
    return users.some(
      (u) => u.status === "active" && u.email.trim().toLowerCase() !== SEED_ADMIN_EMAIL.toLowerCase(),
    );
  }

  app.post("/auth/login", async (c) => {
    const parsed = loginRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const { username, pin } = parsed.data;
    const needle = username.trim().toLowerCase();

    const waitSeconds = throttle.retryAfter(needle);
    if (waitSeconds > 0) return lockedOut(c, waitSeconds);

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
      const lockedFor = throttle.fail(needle);
      if (lockedFor > 0) return lockedOut(c, lockedFor);
      return c.json({ error: "INVALID_CREDENTIALS", message: "اسم المستخدم أو رمز PIN غير صحيح." }, 401);
    }
    throttle.succeed(needle);
    return c.json(await toSession(user, deps));
  });

  /** Ends the session server-side. Without this a token stayed valid until it idled out. */
  app.post("/auth/logout", (c) => {
    const token = readSessionToken(c);
    if (token) deps.sessions.revoke(token);
    return c.json({ ok: true });
  });

  /** Pre-login tenant identity for the login screen / first-run wizard header. */
  app.get("/tenant", async (c) => {
    return c.json({ name: await tenantName(deps.settings) });
  });

  /** What base data already exists — the same counts `/bootstrap/seed` returns, without seeding. */
  app.get("/bootstrap/status", async (c) => {
    return c.json(await currentCounts(deps.seedStores));
  });

  app.post("/bootstrap/seed", async (c) => {
    const result = await seedIfEmpty(deps.seedStores);
    return c.json(result);
  });

  /**
   * Claims a FRESH install. Ungated by necessity — there is nobody to
   * authenticate as yet — so the guard has to be that there is nothing to take:
   * the moment this tenant has an account of its own, this route is closed.
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
      return c.json(await toSession(user, deps), 201);
    } catch (err) {
      // First-run idempotency: re-running the wizard with the same admin email
      // returns that admin's session (so wizard retries don't dead-end on 409).
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
