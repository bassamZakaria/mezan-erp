import { createHash, randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  saveUser,
  recordSuccessfulLogin,
  ALL_SCOPE,
  InvalidUserError,
  DuplicateUserEmailError,
  AuditSeverityCode,
  recordSecurityEvent,
  recordSecurityEventOrFallback,
  seatsOverLimitRefusal,
  type AuditSink,
  type Entitlements,
  type UnitOfWork,
  type SecretHasher,
  type SettingsRepository,
  UserStatusCode,
  accessExpiresAtMs,
  isAccessExpired,
  type User,
} from "@mezan/domain";
import type { PasswordResetTokens } from "@mezan/persistence";
import { CurrentSecretRefusal, loginRequestSchema, bootstrapAdminRequestSchema, unlockAccountRequestSchema, unlockAccountByLinkRequestSchema, stepUpRequestSchema, firebaseSignInRequestSchema, FirebaseRefusal, forgotPasswordRequestSchema, resetPasswordRequestSchema, UNDISCLOSED_TENANT_NAME, type SessionDTO } from "@mezan/contracts";
import {
  accountLocked,
  signInBusy,
  DEVICE_BINDING_HEADER,
  DEVICE_SECRET_HEADER,
  type SessionGrant,
  createAccountLocks,
  createLoginThrottle,
  createMemoryAccountLockStore,
  createSignInGuard,
  createSourceThrottle,
  createSignInGate,
  readSessionToken,
  requestOrigin,
  SignInRefusal,
  SignInVerdict,
  throttleSource,
  tooManyAttempts,
  type AccountLocks,
  type SignInDecision,
  type BoundaryPreparation,
  type LoginThrottle,
  type PrecomputingHasher,
  type SessionRegistry,
  type SignInGate,
  type SourceThrottle,
} from "@mezan/api";
import { SEED_ADMIN_USER_ID, SEED_TENANT_NAME, currentCounts, seedIfEmpty, tenantBooksClaimed, type SeedStores } from "./seed.js";
import { createLogger } from "@mezan/api";

const authLog = createLogger("auth");

export interface AuthRoutesDeps {
  readonly demoSeeded?: boolean;
  readonly onSignedIn?: (user: { readonly userId: string; readonly email: string }) => Promise<void>;
  readonly uow: UnitOfWork;
  // REQUIRED: one writer at a time around the unlock reissue's check-then-write.
  readonly atomic?: <T>(fn: () => Promise<T>) => Promise<T>;
  readonly hasher: SecretHasher;
  readonly settings: SettingsRepository;
  readonly seedStores: SeedStores;
  /** Where a successful login's grant is recorded; the token is the only thing the client gets back. */
  readonly sessions: SessionRegistry;
  /** Failed-attempt lockout. Defaults to a fresh in-memory throttle per app. */
  readonly loginThrottle?: LoginThrottle;
  readonly sourceThrottle?: SourceThrottle;
  readonly signInGate?: SignInGate;
  readonly accountLocks?: AccountLocks;
  readonly onAccountLocked?: (event: AccountLockedEvent) => Promise<void>;
  readonly canMailUnlockCode?: () => Promise<boolean>;
  readonly platformOperatorUnlocks?: boolean;
  readonly secrets?: PrecomputingHasher;
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
  /**
   * The tenant's live entitlements, so a sign-in can be refused when the
   * tenant is over its seat count (DEC-31 rule 6). Omit it — desktop, the
   * scenario rigs — and no seat check happens at all.
   */
  readonly resolveEntitlements?: (c: Context) => Promise<Entitlements | null | undefined> | Entitlements | null | undefined;
  // SECURITY: the cloud platform's own record that this tenant has an owner.
  // True closes the bootstrap routes whatever this database holds.
  readonly claimedElsewhere?: () => Promise<boolean>;
  // SECURITY: false closes `/bootstrap/seed` for a tenant that already has books.
  readonly seedWhenEmpty?: boolean;
  readonly onTenantClaimed?: () => Promise<void>;
  readonly passwordResetTokens?: PasswordResetTokens;
  // CONTRACT: delivers the one-time reset link to the user's own address. Absent — an install with no mail — and «نسيت كلمة المرور» issues nothing.
  readonly onPasswordResetRequested?: (event: { readonly user: User; readonly token: string }) => Promise<void>;
  // SECURITY: present on the cloud edition only. Firebase then holds every credential and the password routes answer 410.
  readonly firebase?: FirebaseVerifier;
}

export interface FirebaseIdentity {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly authTimeSeconds: number;
}

export class FirebaseUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Firebase could not be reached to verify a sign-in", { cause });
    this.name = "FirebaseUnavailableError";
  }
}

export interface FirebaseVerifier {
  /** Null for a token that is malformed, expired, revoked or issued for another project; throws FirebaseUnavailableError when Firebase cannot answer. */
  verify(idToken: string): Promise<FirebaseIdentity | null>;
}

const FIREBASE_STEP_UP_MAX_AGE_SECONDS = 5 * 60;

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const PASSWORD_RESET_TOKEN_BYTES = 32;
// SECURITY: one emailed link per account per window, so a stranger who knows the address can neither flood the inbox nor keep cancelling the link the owner is about to open.
const PASSWORD_RESET_REISSUE_MS = 5 * 60 * 1000;

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AccountLockedEvent {
  readonly user: User;
  readonly unlockCode: string | null;
  readonly unlockLinkToken: string | null;
  readonly source: string;
  readonly reissued?: boolean;
}

export const ACCESS_EXPIRED_ERROR = "ACCESS_EXPIRED";
const SIGN_IN_BUSY_RETRY_SECONDS = 2;
const SIGN_IN_BUSY_STATUS = 503;
const ACCOUNT_LOCKED_STATUS = 423;

export { UNDISCLOSED_TENANT_NAME };

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
async function toSession(user: User, deps: AuthRoutesDeps, origin: string | null, device: DeviceBinding | null = null): Promise<SessionDTO> {
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
  // SECURITY: a temporary password grants nothing. Every door that checks permissions — billing, desktop IPC, the API — refuses it, not only the HTTP gate.
  if (user.mustChangePassword) permissions = [];
  return {
    userId: user.id,
    nameAr: user.nameAr,
    nameEn: user.nameEn,
    email: user.email,
    isCompanyAdmin: user.isCompanyAdmin,
    mustChangePassword: user.mustChangePassword,
    permissions,
    roleCode,
    photoUrl: user.photoUrl,
    branchScope: user.branchScope === ALL_SCOPE ? "*" : [...user.branchScope],
    warehouseScope: user.warehouseScope === ALL_SCOPE ? "*" : [...user.warehouseScope],
    tenantName: await tenantName(deps.settings),
    ...(deps.firebase ? { credentialsInFirebase: true } : {}),
    // The client gets a token and nothing else it could forge with. The
    // permissions travel too, but only so the UI can hide what the user cannot
    // do — the server re-reads them from this session on every request and
    // never from what comes back.
    ...(await issueSession(
      deps.sessions,
      { userId: user.id, permissions, roleCode, branchScope: user.branchScope, warehouseScope: user.warehouseScope, accessExpiresAt: accessExpiresAtMs(user), mustChangePassword: user.mustChangePassword },
      origin,
      device,
    )),
  };
}

interface DeviceBinding {
  readonly heldSecret: string | null;
}

async function issueSession(sessions: SessionRegistry, grant: SessionGrant, origin: string | null, device: DeviceBinding | null): Promise<{ token: string; deviceSecret?: string }> {
  return device ? sessions.issueDeviceBound(grant, origin, device.heldSecret) : { token: await sessions.issue(grant, origin) };
}

function deviceBindingOf(c: Context): DeviceBinding | null {
  return c.req.header(DEVICE_BINDING_HEADER) === "1" ? { heldSecret: c.req.header(DEVICE_SECRET_HEADER) ?? null } : null;
}

/**
 * Real auth + first-run bootstrap routes (docs/archive/plan.md — email + password):
 *   POST /auth/login          verify user + password, return the resolved session
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
export interface AuthMount {
  readonly routes: Hono;
  readonly beforeTheTurn: Readonly<Record<string, BoundaryPreparation>>;
}

export function createAuthRoutes(deps: AuthRoutesDeps): Hono {
  return createAuth(deps).routes;
}

export function createAuth(deps: AuthRoutesDeps): AuthMount {
  const app = new Hono();
  const throttle = deps.loginThrottle ?? createLoginThrottle();
  const sources = deps.sourceThrottle ?? createSourceThrottle();
  const gate = deps.signInGate ?? createSignInGate();
  const locks = deps.accountLocks ?? createAccountLocks({ known: createMemoryAccountLockStore() });
  const guard = createSignInGuard({ throttle, sources, locks });
  const canMailUnlockCode = deps.canMailUnlockCode ?? (async () => false);
  const firebase = deps.firebase;
  const passwordsClosed = firebase !== undefined;
  const signInWithFirebase = (c: Context) =>
    c.json({ error: FirebaseRefusal.SignInWithFirebase, message: "سجّل الدخول بالبريد الإلكتروني وكلمة المرور أو بحساب Google من صفحة الدخول.", messageEn: "Sign in with your email and password or your Google account on the sign-in page." }, 410);
  if (firebase) {
    for (const path of ["/auth/forgot-password", "/auth/reset-password", "/auth/unlock", "/auth/unlock-link"]) app.post(path, signInWithFirebase);
  }

  async function refused(c: Context, held: SignInDecision): Promise<Response> {
    if (held.verdict === SignInVerdict.Locked) {
      return c.json(accountLocked({ mailed: await canMailUnlockCode(), operatorUnlocks: deps.platformOperatorUnlocks === true }), ACCOUNT_LOCKED_STATUS);
    }
    return lockedOut(c, held.retryAfterSeconds);
  }

  const verifyPasswordBeforeTheTurn: BoundaryPreparation = async (c) => {
    const secrets = deps.secrets;
    if (!secrets) return;
    const parsed = loginRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return;
    const needle = parsed.data.username.trim().toLowerCase();
    const origin = requestOrigin(c);
    // ORDER MATTERS: the lock and both ladders are asked before a hash is
    // bought, and a caller the gate has no place for is answered here — it must
    // not reach the handler, which would hash for it under the connection's turn.
    await deps.audit?.settled?.();
    if (passwordsClosed) return;
    const known = (await deps.uow.users.findByEmail(needle)) !== null;
    if ((await guard.check(needle, origin, known)).verdict !== SignInVerdict.Proceed) return;
    const checked = gate.admit(throttleSource(origin), async () => {
      await deps.audit?.settled?.();
      const user = await deps.uow.users.findByEmail(needle);
      const hash = user && user.status === UserStatusCode.Active ? user.passwordHash : await decoyHash();
      return secrets.precompute({ verify: [[parsed.data.password, hash]] });
    });
    if (checked !== null) return checked;
    c.header("retry-after", String(SIGN_IN_BUSY_RETRY_SECONDS));
    return c.json(signInBusy(SIGN_IN_BUSY_RETRY_SECONDS), SIGN_IN_BUSY_STATUS);
  };

  // Hashed before the request queues for the connection, and only while nobody
  // has claimed the tenant: the handler then checks the claim and inserts the
  // admin inside one transaction, with nothing left to wait for in between.
  const hashClaimSecretsBeforeTheTurn: BoundaryPreparation = async (c) => {
    const secrets = deps.secrets;
    if (!secrets) return;
    const parsed = bootstrapAdminRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return;
    await deps.audit?.settled?.();
    if (await tenantIsClaimed()) return;
    return secrets.precompute({ hash: [parsed.data.password] });
  };

  const hashResetPasswordBeforeTheTurn: BoundaryPreparation = async (c) => {
    const parsed = resetPasswordRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success || !deps.secrets) return;
    return deps.secrets.precompute({ hash: [parsed.data.password] });
  };

  /**
   * A hash to verify against when the account does not exist, so a miss costs
   * the same scrypt a hit does. Built once, lazily — hashing on every mount
   * would slow every app construction, including the tests'.
   */
  let decoy: Promise<string> | null = null;
  const decoyHash = () => (decoy ??= deps.hasher.hash("mezan-login-timing-decoy"));

  function security(c: Context, action: string, severity: AuditSeverityCode, details: Record<string, unknown>) {
    if (!deps.audit) return Promise.resolve();
    return recordSecurityEventOrFallback(deps.audit, {
      module: "auth",
      entityType: "AUTH_USER",
      entityId: typeof details["userId"] === "string" ? (details["userId"] as string) : null,
      action,
      actor: typeof details["userId"] === "string" ? (details["userId"] as string) : "anonymous",
      severity,
      details: { ...details, origin: requestOrigin(c) ?? "host" },
    });
  }

  function lockedOut(c: Context, seconds: number) {
    c.header("retry-after", String(seconds));
    return c.json(tooManyAttempts(seconds), 429);
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
  async function hasLiveSession(c: Context): Promise<boolean> {
    const token = readSessionToken(c);
    if (!token) return false;
    return (await deps.sessions.find(token, requestOrigin(c), c.req.header(DEVICE_SECRET_HEADER) ?? null)) !== null;
  }

  async function tenantIsClaimed(): Promise<boolean> {
    if (await deps.claimedElsewhere?.()) return true;
    return claimedInThisDatabase();
  }

  async function claimedInThisDatabase(): Promise<boolean> {
    const settings = await deps.settings.get();
    const users = settings?.tenantClaimedAt ? [] : await deps.uow.users.list();
    return tenantBooksClaimed({ claimedAt: settings?.tenantClaimedAt, userIds: users.map((u) => u.id) });
  }

  // SECURITY: writes the claim once; it is never cleared and is unreachable
  // from `PUT /settings`. The company name rides in the SAME write and nowhere
  // earlier: this route is anonymous, so a name written before the claim is
  // recorded would let a refused or failed request rename somebody else's tenant.
  async function recordTenantClaim(at: string, companyName: string): Promise<void> {
    const settings = await deps.settings.get();
    if (!settings || settings.tenantClaimedAt) return;
    await deps.settings.save({ ...settings, tenantClaimedAt: at, companyName });
  }

  /**
   * Retires the seeded fallback admin the moment a real one exists.
   *
   * `USER-ADMIN` is created so a fresh tenant is never account-less, and on a
   * packaged build its password is generated. It was then left ACTIVE forever, with
   * `isCompanyAdmin: true` — a permanent, unattributable `["*"]` account on
   * every install, which is the classic "generic admin account" audit finding
   * arrived at through the front door. Three things followed from it: the
   * tenant admin could quietly claim it by setting a password of their own choosing
   * and share it; an auditor asking "whose account is this" got no answer; and
   * whoever installed the software — typically the vendor's technician, not the
   * owner — could set `MEZAN_SEED_ADMIN_PASSWORD` before first run and leave with a
   * permanent key.
   *
   * Claiming the tenant is exactly the moment it stops being needed, so that is
   * when it is deactivated. It is not deleted: `--reset-admin` reactivates it
   * from the machine's own filesystem, which is the recovery door for an owner
   * who has lost their password, and deleting the row would take the audit history
   * that points at it with it.
   */
  async function retireSeedAdmin(uow: UnitOfWork): Promise<void> {
    const seed = await uow.users.findById(SEED_ADMIN_USER_ID);
    if (!seed || seed.status !== UserStatusCode.Active) return;
    await uow.users.save({ ...seed, status: UserStatusCode.Inactive });
  }

  async function alreadyClaimed(c: Context, email: string | null) {
    await security(c, "BOOTSTRAP_REFUSED", AuditSeverityCode.Critical, { email });
    return c.json(
      {
        error: "TENANT_ALREADY_PROVISIONED",
        message: "تم إعداد هذه المنشأة بالفعل. سجّل الدخول بحسابك.",
      },
      409,
    );
  }

  // SECURITY: a locked account is mailed again only once its last code and
  // link have expired, so whoever keeps knocking buys the administrators at
  // most one mail an hour. The second read of `unlockReissueDue` is made after
  // the only await, with nothing awaited before the issue: two attempts that
  // arrive together cannot both mail.
  const atomically = <T>(fn: () => Promise<T>): Promise<T> => (deps.atomic ? deps.atomic(fn) : fn());

  async function mailFreshUnlockIfDue(c: Context, needle: string, user: User, origin: string | null): Promise<void> {
    if (!deps.onAccountLocked || !(await guard.unlockReissueDue(needle))) return;
    if (!(await canMailUnlockCode())) return;
    const reissue = async () => {
      if (!(await guard.unlockReissueDue(needle))) return null;
      return { unlockCode: await guard.issueUnlockCode(needle), unlockLinkToken: await guard.issueUnlockLink(needle) };
    };
    const issued = await atomically(reissue);
    if (!issued) return;
    const { unlockCode, unlockLinkToken } = issued;
    await security(c, "ACCOUNT_UNLOCK_REISSUED", AuditSeverityCode.Warning, { username: needle, userId: user.id });
    await deps.onAccountLocked({ user, unlockCode, unlockLinkToken, source: origin ?? "host", reissued: true });
  }

  async function admit(c: Context, signedIn: User, needle: string, origin: string | null): Promise<Response> {
    /**
     * OVER THE SEAT COUNT — the reverse trial's drop to Free can leave a tenant
     * with more active users than the Free plan allows. DEC-31 rule 6: nothing
     * is deleted and nobody is deactivated automatically; only a company admin
     * can sign in, so that a human decides who stays. Checked AFTER the
     * credential, so it can never tell an outsider how many users a tenant has.
     */
    if (isAccessExpired(signedIn, Date.now())) {
      await guard.succeeded(needle, origin);
      await security(c, "LOGIN_REFUSED_ACCESS_EXPIRED", AuditSeverityCode.Warning, { userId: signedIn.id, accessExpiresAt: signedIn.accessExpiresAt ?? null });
      return c.json(
        {
          error: ACCESS_EXPIRED_ERROR,
          message: "انتهت مدة الوصول الممنوحة لهذا الحساب. اطلب من مدير النظام تمديدها.",
          messageEn: "This account's access period has ended. Ask the administrator to extend it.",
        },
        403,
      );
    }
    if (!signedIn.isCompanyAdmin) {
      const entitlements = await deps.resolveEntitlements?.(c);
      if (entitlements) {
        const active = (await deps.uow.users.list()).filter((u) => u.status === UserStatusCode.Active).length;
        if (active > entitlements.seats) {
          const refusal = seatsOverLimitRefusal(entitlements.seats, active, {
            nameAr: entitlements.planNameAr ?? entitlements.plan,
            nameEn: entitlements.planNameEn ?? entitlements.plan,
          });
          await security(c, "LOGIN_REFUSED_SEATS", AuditSeverityCode.Warning, { userId: signedIn.id, seats: entitlements.seats, active });
          return c.json(refusal, 403);
        }
      }
    }
    await guard.succeeded(needle, origin);
    const at = new Date().toISOString();
    await recordSuccessfulLogin(signedIn.id, at, deps.uow);
    await security(c, "LOGIN_SUCCEEDED", AuditSeverityCode.Info, { userId: signedIn.id, username: needle });
    // SECURITY: announced only here, after this request's own password check. A
    // session answered without one proves nothing about who holds the credential.
    await deps.onSignedIn?.({ userId: signedIn.id, email: signedIn.email }).catch((err: unknown) =>
      authLog.error({ err: err }, "the sign-in succeeded, but announcing it failed"),
    );
    // The session is bound to the origin the CREDENTIAL was verified from, so
    // the till that logged in is the only place the token it got back works.
    return c.json(await toSession(signedIn, deps, requestOrigin(c), deviceBindingOf(c)));
  }

  app.post("/auth/login", async (c) => {
    const parsed = loginRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const { username, password } = parsed.data;
    const needle = username.trim().toLowerCase();
    // Remote callers are counted per (account, source); the host's own console
    // is counted per account. See login-throttle.ts — this is what stops one
    // phone on the shop wifi from taking the counter out of service.
    const origin = requestOrigin(c);

    // The email, and only the email. Matching the FULL NAME, as this did, made
    // "who can log in" a property of a field any admin may edit, and two people
    // who share a display name shared an account door.
    if (passwordsClosed) return signInWithFirebase(c);
    const user = await deps.uow.users.findByEmail(needle);
    const held = await guard.check(needle, origin, user !== null);
    if (held.verdict !== SignInVerdict.Proceed) {
      await security(c, "LOGIN_BLOCKED", AuditSeverityCode.Warning, {
        username: needle,
        retryAfterSeconds: held.retryAfterSeconds,
        accountLocked: held.verdict === SignInVerdict.Locked,
      });
      if (held.verdict === SignInVerdict.Locked && user) await mailFreshUnlockIfDue(c, needle, user, origin);
      return refused(c, held);
    }

    // An unknown email used to return before any hashing happened, so the
    // response time answered "does this account exist" for free. Verify against
    // a throwaway hash instead, and spend the same scrypt either way.
    const verified =
      user && user.status === UserStatusCode.Active
        ? await deps.hasher.verify(password, user.passwordHash)
        : (await deps.hasher.verify(password, await decoyHash()), false);
    // The check may have handed the connection back. The verdict holds only for
    // the account as it stands now: still active, still on the password it was
    // checked against.
    const current = verified && user ? await deps.uow.users.findById(user.id) : null;
    const signedIn = current !== null && current.status === UserStatusCode.Active && current.passwordHash === user?.passwordHash ? current : null;
    if (verified && signedIn === null) {
      await security(c, "LOGIN_FAILED", AuditSeverityCode.Warning, { username: needle, accountChangedDuringCheck: true });
      return c.json({ error: "INVALID_CREDENTIALS", message: "البريد الإلكتروني أو كلمة المرور غير صحيحة." }, 401);
    }
    if (signedIn === null) {
      const { failure, unlock } = await atomically(async () => {
        const failed = await guard.failed(needle, origin, user !== null);
        const mailed = failed.verdict === SignInVerdict.Locked && failed.justLocked && user && deps.onAccountLocked;
        return { failure: failed, unlock: mailed ? { unlockCode: await guard.issueUnlockCode(needle), unlockLinkToken: await guard.issueUnlockLink(needle) } : null };
      });
      if (failure.verdict === SignInVerdict.Locked) {
        if (failure.justLocked) {
          await security(c, "ACCOUNT_HARD_LOCKED", AuditSeverityCode.Critical, { username: needle, userId: user?.id });
          if (user && unlock) await deps.onAccountLocked?.({ user, ...unlock, source: origin ?? "host" });
        }
        return refused(c, failure);
      }
      if (failure.verdict === SignInVerdict.Wait) {
        await security(c, "ACCOUNT_LOCKED", AuditSeverityCode.Critical, { username: needle, lockedForSeconds: failure.retryAfterSeconds });
        return lockedOut(c, failure.retryAfterSeconds);
      }
      await security(c, "LOGIN_FAILED", AuditSeverityCode.Warning, { username: needle });
      return c.json({ error: "INVALID_CREDENTIALS", message: "البريد الإلكتروني أو كلمة المرور غير صحيحة." }, 401);
    }
    return admit(c, signedIn, needle, origin);
  });

  app.post("/auth/firebase", async (c) => {
    if (!firebase) return c.json({ error: "NOT_FOUND" }, 404);
    const parsed = firebaseSignInRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const origin = requestOrigin(c);
    let identity: FirebaseIdentity | null;
    try {
      identity = await firebase.verify(parsed.data.idToken);
    } catch (err) {
      if (!(err instanceof FirebaseUnavailableError)) throw err;
      authLog.error({ err }, "Firebase could not be reached to verify a sign-in");
      return c.json({ error: "SIGN_IN_UNAVAILABLE", message: "تعذّر التحقق من الدخول الآن. أعد المحاولة بعد قليل." }, 503);
    }
    const needle = identity?.email.trim().toLowerCase() ?? "";
    // SECURITY: an unverified address proves nothing about who holds the mailbox, so it opens nothing.
    const user = identity?.emailVerified ? await deps.uow.users.findByEmail(needle) : null;
    if (!user || user.status !== UserStatusCode.Active || user.id === SEED_ADMIN_USER_ID) {
      // A token Firebase did not sign is noise, not an attempt on an account: it writes nothing to the tenant's log.
      if (identity) await security(c, "LOGIN_FAILED", AuditSeverityCode.Warning, { username: needle, firebase: true, emailVerified: identity.emailVerified });
      return c.json({ error: "INVALID_CREDENTIALS", message: "البريد الإلكتروني أو كلمة المرور غير صحيحة." }, 401);
    }
    // A temporary password is never imported into Firebase, so holding a Firebase credential already proves it was replaced.
    const signedIn = user.mustChangePassword
      ? await atomically(async () => {
          const current = await deps.uow.users.findById(user.id);
          if (!current || !current.mustChangePassword) return current;
          const cleared = { ...current, mustChangePassword: false };
          await deps.uow.users.save(cleared);
          return cleared;
        })
      : user;
    if (!signedIn || signedIn.status !== UserStatusCode.Active) {
      return c.json({ error: "INVALID_CREDENTIALS", message: "البريد الإلكتروني أو كلمة المرور غير صحيحة." }, 401);
    }
    return admit(c, signedIn, needle, origin);
  });

  app.post("/auth/step-up", async (c) => {
    const parsed = stepUpRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const token = readSessionToken(c);
    const origin = requestOrigin(c);
    const grant = token ? await deps.sessions.find(token, origin, c.req.header(DEVICE_SECRET_HEADER) ?? null) : null;
    const user = grant ? await deps.uow.users.findById(grant.userId) : null;
    if (!token || !user || user.status !== UserStatusCode.Active) {
      return c.json({ error: "UNAUTHENTICATED", message: "انتهت الجلسة، سجّل الدخول مرة أخرى." }, 401);
    }
    if ("idToken" in parsed.data) {
      const identity = firebase ? await firebase.verify(parsed.data.idToken).catch(() => null) : null;
      const sameUser = identity !== null && identity.emailVerified && identity.email.trim().toLowerCase() === user.email.trim().toLowerCase();
      if (!sameUser) {
        await security(c, "STEP_UP_FAILED", AuditSeverityCode.Warning, { userId: user.id, firebase: true });
        return c.json({ error: CurrentSecretRefusal.IncorrectPassword, message: "تعذّر تأكيد هويتك. أعد المحاولة." }, 403);
      }
      // SECURITY: an ID token lives an hour; only a sign-in made moments ago proves the person is at the keyboard now.
      if (Date.now() / 1000 - identity.authTimeSeconds > FIREBASE_STEP_UP_MAX_AGE_SECONDS) {
        return c.json({ error: FirebaseRefusal.ReauthenticationTooOld, message: "أكّد هويتك مرة أخرى للمتابعة." }, 403);
      }
      await deps.sessions.confirmStepUp(token);
      await security(c, "STEP_UP_CONFIRMED", AuditSeverityCode.Info, { userId: user.id, firebase: true });
      return c.json({ ok: true });
    }
    if (passwordsClosed) return signInWithFirebase(c);
    const held = await guard.check(user.email, origin, true);
    if (held.verdict !== SignInVerdict.Proceed) return refused(c, held);
    if (!(await deps.hasher.verify(parsed.data.password, user.passwordHash))) {
      const failure = await atomically(() => guard.failed(user.email, origin, true));
      await security(c, "STEP_UP_FAILED", AuditSeverityCode.Warning, { userId: user.id });
      if (failure.verdict === SignInVerdict.Locked || failure.verdict === SignInVerdict.Wait) return refused(c, failure);
      return c.json({ error: CurrentSecretRefusal.IncorrectPassword, message: "كلمة المرور غير صحيحة." }, 403);
    }
    await deps.sessions.confirmStepUp(token);
    await security(c, "STEP_UP_CONFIRMED", AuditSeverityCode.Info, { userId: user.id });
    return c.json({ ok: true });
  });

  app.post("/auth/unlock", async (c) => {
    const parsed = unlockAccountRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const needle = parsed.data.username.trim().toLowerCase();
    const origin = requestOrigin(c);
    const bucket = throttleSource(origin);
    const wait = bucket === null ? 0 : await sources.retryAfter(bucket);
    if (wait > 0) return lockedOut(c, wait);
    if (!(await guard.redeemUnlockCode(needle, parsed.data.code))) {
      if (bucket !== null) await sources.fail(bucket);
      await security(c, "ACCOUNT_UNLOCK_REFUSED", AuditSeverityCode.Warning, { username: needle });
      return c.json({ error: SignInRefusal.InvalidUnlockCode, message: "رمز فكّ القفل غير صحيح أو انتهت صلاحيته." }, 400);
    }
    const user = await deps.uow.users.findByEmail(needle);
    await security(c, "ACCOUNT_UNLOCKED_BY_CODE", AuditSeverityCode.Warning, { username: needle, userId: user?.id });
    return c.json({ ok: true });
  });

  app.post("/auth/unlock-link", async (c) => {
    const parsed = unlockAccountByLinkRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const bucket = throttleSource(requestOrigin(c));
    const wait = bucket === null ? 0 : await sources.retryAfter(bucket);
    if (wait > 0) return lockedOut(c, wait);
    const account = await guard.redeemUnlockLink(parsed.data.token);
    if (account === null) {
      if (bucket !== null) await sources.fail(bucket);
      await security(c, "ACCOUNT_UNLOCK_REFUSED", AuditSeverityCode.Warning, { byLink: true });
      return c.json({ error: SignInRefusal.InvalidUnlockLink, message: "رابط فكّ القفل غير صالح، أو انتهت صلاحيته، أو استُخدم من قبل." }, 400);
    }
    const user = await deps.uow.users.findByEmail(account);
    await security(c, "ACCOUNT_UNLOCKED_BY_LINK", AuditSeverityCode.Warning, { username: account, userId: user?.id });
    return c.json({ ok: true });
  });

  app.post("/auth/forgot-password", async (c) => {
    const parsed = forgotPasswordRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const bucket = throttleSource(requestOrigin(c));
    const wait = bucket === null ? 0 : await sources.retryAfter(bucket);
    if (wait > 0) return lockedOut(c, wait);
    // SECURITY: every request counts against the source, and the answer is the same whether or not the account exists.
    if (bucket !== null) await sources.fail(bucket);
    const needle = parsed.data.username.trim().toLowerCase();
    const user = await deps.uow.users.findByEmail(needle);
    const tokens = deps.passwordResetTokens;
    const send = deps.onPasswordResetRequested;
    const latest = user && tokens ? await tokens.latestExpiry(user.id, Date.now()) : null;
    const issuedRecently = latest !== null && latest - PASSWORD_RESET_TTL_MS > Date.now() - PASSWORD_RESET_REISSUE_MS;
    if (user && user.status === UserStatusCode.Active && !user.erasedAt && tokens && send && !issuedRecently) {
      const token = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url");
      await tokens.issue(user.id, hashResetToken(token), Date.now() + PASSWORD_RESET_TTL_MS);
      await send({ user, token }).catch((err: unknown) => authLog.error({ err }, "the password-reset link was issued, but mailing it failed"));
      await security(c, "PASSWORD_RESET_REQUESTED", AuditSeverityCode.Warning, { userId: user.id });
    }
    return c.json({ ok: true }, 202);
  });

  app.post("/auth/reset-password", async (c) => {
    const parsed = resetPasswordRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const bucket = throttleSource(requestOrigin(c));
    const wait = bucket === null ? 0 : await sources.retryAfter(bucket);
    if (wait > 0) return lockedOut(c, wait);
    const userId = deps.passwordResetTokens ? await deps.passwordResetTokens.redeem(hashResetToken(parsed.data.token), Date.now()) : null;
    const user = userId ? await deps.uow.users.findById(userId) : null;
    if (!user || user.status !== UserStatusCode.Active || user.erasedAt) {
      if (bucket !== null) await sources.fail(bucket);
      await security(c, "PASSWORD_RESET_REFUSED", AuditSeverityCode.Warning, {});
      return c.json({ error: SignInRefusal.InvalidResetLink, message: "رابط إعادة تعيين كلمة المرور غير صالح، أو انتهت صلاحيته، أو استُخدم من قبل." }, 400);
    }
    const passwordHash = await deps.hasher.hash(parsed.data.password);
    const saved = await atomically(async () => {
      const current = await deps.uow.users.findById(user.id);
      if (!current || current.status !== UserStatusCode.Active) return false;
      await deps.uow.users.save({ ...current, passwordHash, mustChangePassword: false });
      return true;
    });
    if (!saved) return c.json({ error: SignInRefusal.InvalidResetLink, message: "رابط إعادة تعيين كلمة المرور غير صالح، أو انتهت صلاحيته، أو استُخدم من قبل." }, 400);
    await deps.sessions.revokeUser(user.id);
    await guard.unlock(user.email);
    await security(c, "PASSWORD_RESET_BY_LINK", AuditSeverityCode.Warning, { userId: user.id });
    return c.json({ ok: true });
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
  app.post("/auth/logout", async (c) => {
    const token = readSessionToken(c);
    if (token && (await deps.sessions.find(token, requestOrigin(c), c.req.header(DEVICE_SECRET_HEADER) ?? null))) await deps.sessions.revoke(token);
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
    if (await tenantIsClaimed()) return c.json({ name: UNDISCLOSED_TENANT_NAME });
    return c.json({ name: await tenantName(deps.settings) });
  });

  /**
   * What base data already exists, and — the part the login screen needs —
   * whether anybody has claimed this install yet.
   *
   * A fresh packaged install landed on a login screen with an empty account
   * list, a blank email box and nothing saying the machine had never been set
   * up; the only account that existed had a password nobody knows. The owner typed
   * their own name, failed five times, and was locked out of a brand-new
   * install inside ninety seconds. The client can now open the wizard instead.
   */
  app.get("/bootstrap/status", async (c) => {
    const claimed = await tenantIsClaimed();
    const demoSeeded = deps.demoSeeded === true;
    // SECURITY: this route is unauthenticated and a tenant code is guessable,
    // so once someone owns the tenant its record counts are answered only to a
    // signed-in session (the first-run wizard's seed step holds one).
    if (claimed && !(await hasLiveSession(c))) return c.json({ claimed, demoSeeded });
    return c.json({ ...(await currentCounts(deps.seedStores)), claimed, demoSeeded });
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
   * has nothing in it yet; a claimed tenant's counts go only to a signed-in
   * session, as on `/bootstrap/status` — and on the desktop edition neither is reachable from the LAN
   * socket at all, because `/bootstrap/*` is off its path allow-list.
   */
  app.post("/bootstrap/seed", async (c) => {
    const result = deps.seedWhenEmpty === false ? await currentCounts(deps.seedStores) : await seedIfEmpty(deps.seedStores);
    if (!(await hasLiveSession(c)) && (await tenantIsClaimed())) return c.json({ claimed: true });
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
    const raw: unknown = await c.req.json().catch(() => null);
    // SECURITY: a claimed tenant is refused before the body is validated, so an
    // anonymous caller learns nothing about the claim's schema.
    if (await tenantIsClaimed()) {
      const attempted = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["email"] : null;
      return alreadyClaimed(c, typeof attempted === "string" ? attempted.slice(0, 320) : null);
    }
    const parsed = bootstrapAdminRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    await seedIfEmpty(deps.seedStores);
    try {
      // ORDER MATTERS: the claim is read again here, inside the transaction that
      // inserts the admin and records the claim. Seeding above may have handed
      // the connection back, and the read at the top of this handler is then
      // one every concurrent claimant shared.
      const user = await deps.uow.transaction(async (tx) => {
        if (await claimedInThisDatabase()) return null;
        const claimed = await saveUser(
          {
            id: crypto.randomUUID(),
            nameAr: parsed.data.nameAr,
            nameEn: parsed.data.nameEn,
            email: parsed.data.email,
            phone: null,
            password: parsed.data.password,
            passwordIsTemporary: false,
            roleId: null,
            isCompanyAdmin: true,
            employeeId: null,
            branchScope: ALL_SCOPE,
            warehouseScope: ALL_SCOPE,
            status: UserStatusCode.Active,
            createdAt: new Date().toISOString(),
          },
          tx,
          deps.hasher,
        );
        await recordTenantClaim(new Date().toISOString(), parsed.data.companyName);
        await retireSeedAdmin(tx);
        // REQUIRED ORDERING: recorded INSIDE the transaction that makes the
        // claim, and not through `security()`, which never fails its caller.
        // The single highest-authority write in the product either leaves its
        // own record or does not happen.
        if (deps.audit) {
          await recordSecurityEvent(deps.audit, {
            module: "auth",
            entityType: "AUTH_USER",
            entityId: claimed.id,
            action: "TENANT_CLAIMED",
            actor: claimed.id,
            severity: "CRITICAL",
            details: { userId: claimed.id, email: claimed.email, seedAdminRetired: true, origin: requestOrigin(c) ?? "host" },
          });
        }
        return claimed;
      });
      if (!user) return alreadyClaimed(c, parsed.data.email);
      await deps.onTenantClaimed?.();
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

  return { routes: app, beforeTheTurn: { "/auth/login": verifyPasswordBeforeTheTurn, "/bootstrap/admin": hashClaimSecretsBeforeTheTurn, "/auth/reset-password": hashResetPasswordBeforeTheTurn } };
}
