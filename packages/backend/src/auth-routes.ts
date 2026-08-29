import { Hono } from "hono";
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
import { readSessionToken, type SessionRegistry } from "@mezan/api";
import { SEED_TENANT_NAME, currentCounts, seedIfEmpty, type SeedStores } from "./seed.js";

export interface AuthRoutesDeps {
  readonly uow: UnitOfWork;
  readonly hasher: SecretHasher;
  readonly settings: SettingsRepository;
  readonly seedStores: SeedStores;
  /** Where a successful login's grant is recorded; the token is the only thing the client gets back. */
  readonly sessions: SessionRegistry;
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
 * Real auth + first-run bootstrap routes (docs/plan.md — desktop username+PIN):
 *   POST /auth/login          verify user + PIN, return the resolved session
 *   POST /bootstrap/seed      idempotently seed an empty DB (wizard seed step)
 *   POST /bootstrap/admin     create the first-run admin, return their session
 *
 * These are intentionally UNGATED: login has no session yet, and the bootstrap
 * routes run before any user could authenticate (local desktop first-run).
 */
export function createAuthRoutes(deps: AuthRoutesDeps) {
  const app = new Hono();

  app.post("/auth/login", async (c) => {
    const parsed = loginRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const { username, pin } = parsed.data;
    const needle = username.trim().toLowerCase();
    // The email, and only the email. Matching the FULL NAME, as this did, made
    // "who can log in" a property of a field any admin may edit, and two people
    // who share a display name shared an account door.
    const user = await deps.uow.users.findByEmail(needle);
    if (!user || user.status !== "active" || !user.pinHash) {
      return c.json({ error: "INVALID_CREDENTIALS", message: "اسم المستخدم أو رمز PIN غير صحيح." }, 401);
    }
    const ok = await deps.hasher.verify(pin, user.pinHash);
    if (!ok) {
      return c.json({ error: "INVALID_CREDENTIALS", message: "اسم المستخدم أو رمز PIN غير صحيح." }, 401);
    }
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

  app.post("/bootstrap/admin", async (c) => {
    const parsed = bootstrapAdminRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
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
      if (err instanceof DuplicateUserEmailError) {
        const existing = await deps.uow.users.findByEmail(parsed.data.email);
        if (existing && existing.isCompanyAdmin && existing.status === "active") {
          return c.json(await toSession(existing, deps), 200);
        }
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
