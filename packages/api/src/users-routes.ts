import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import {
  saveUser,
  setUserStatus,
  isTenantAdmin,
  targetOutranksCaller,
  ungrantablePermissions,
  ungrantableScopes,
  detectSodConflicts,
  emailDomainRefusal,
  WILDCARD_PERMISSION,
  type AccountAuthority,
  InvalidUserError,
  DuplicateUserEmailError,
  EmailDomainNotAllowedError,
  UnknownRoleError,
  UserNotFoundError,
  LastCompanyAdminError,
  UserErasureRefusedError,
  assertUserErasable,
  erasedUser,
  isErasedUser,
  type AuditSink,
  type SodConflictMatch,
  type User,
  type UnitOfWork,
  type ScopeSelection,
  type SecretHasher,
} from "@mezan/domain";
import { ErasureRetention, createUserSchema, eraseUserSchema, updateUserSchema } from "@mezan/contracts";
import { EMPTY_ERASURE_COUNTS, type UserErasurePort } from "./user-erasure.js";
import {
  createPermissionGate,
  getAuthContext,
  type AuthContextResolver,
} from "./permission-gate.js";
import { recordAdminEvent, recordSecurityAdminEvent } from "./admin-audit.js";
import type { SessionRegistry } from "./session-auth.js";
import type { LoginThrottle } from "./login-throttle.js";

function serializeUser(user: User) {
  return {
    id: user.id,
    nameAr: user.nameAr,
    nameEn: user.nameEn,
    email: user.email,
    phone: user.phone,
    roleId: user.roleId,
    isCompanyAdmin: user.isCompanyAdmin,
    employeeId: user.employeeId,
    branchScope: user.branchScope,
    warehouseScope: user.warehouseScope,
    status: user.status,
    hasPin: user.pinHash !== null,
    photoUrl: user.photoUrl,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    erasedAt: user.erasedAt ?? null,
  };
}

function userErrorResponse(c: Context, err: unknown) {
  if (err instanceof InvalidUserError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (err instanceof DuplicateUserEmailError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof EmailDomainNotAllowedError) {
    return c.json({ error: err.code, message: err.message }, 422);
  }
  if (err instanceof UnknownRoleError) {
    return c.json({ error: err.code, message: err.message }, 400);
  }
  if (err instanceof UserNotFoundError) {
    return c.json({ error: err.code, message: err.message }, 404);
  }
  // 409, not 400: the request is well formed and the caller is allowed to
  // deactivate users — it is the tenant's state that forbids this one (D117).
  if (err instanceof LastCompanyAdminError) {
    return c.json({ error: err.code, message: err.message }, 409);
  }
  if (err instanceof UserErasureRefusedError) {
    return c.json({ error: err.code, reason: err.reason, message: err.message, messageEn: err.messageEn }, 409);
  }
  throw err;
}

export interface UsersRoutesOptions {
  /**
   * The tenant's allowed email domains, read per request rather than captured
   * at mount: an admin who adds a domain in الإعدادات must not have to restart
   * the app before the next account can use it.
   */
  readonly readAllowedEmailDomains?: () => Promise<readonly string[]>;
  /** Who created an account, changed its role, gave it admin, or reset its PIN. */
  readonly audit?: AuditSink;
  /**
   * The live session registry.
   *
   * REQUIRED for deactivation to mean anything. The permission grant is
   * snapshotted into the session at login and never re-read, so without this a
   * dismissed employee keeps full access for up to twelve hours after
   * `POST /users/:id/deactivate`, a demoted user keeps their old permission
   * set, and a PIN reset does not evict the session it was meant to close.
   * `revokeUser` existed and was called from nowhere.
   */
  readonly sessions?: SessionRegistry;
  /** The SAME throttle `/auth/login` counts against, so an admin can clear a lockout. */
  readonly loginThrottle?: LoginThrottle;
  /**
   * The person's data held outside the user row. `POST /:id/erase` is mounted
   * only with BOTH this and `audit`: an erasure nobody can prove happened is
   * worse than none, so the absence of the sink removes the route rather than
   * quietly skipping the record.
   */
  readonly erasure?: UserErasurePort;
}

/**
 * What an erasure keeps, sent with every result so the screen — and the person
 * who asked — can be told. Each rests on a retention duty a lawyer still has
 * to confirm for the tenant (D348); none of it is a claim of compliance.
 */
const ERASURE_RETAINS: readonly ErasureRetention[] = [
  ErasureRetention.PostedJournalEntries,
  ErasureRetention.AuditTrail,
  ErasureRetention.ApprovalDecisions,
  ErasureRetention.NamesPrintedOnPostedDocuments,
  ErasureRetention.PayrollRecords,
  ErasureRetention.AttendanceHours,
  ErasureRetention.EmployeeDocumentAttachments,
];

/**
 * Users CRUD — every route is permission-gated (docs/archive/catalog/09 §المستخدمون).
 * `resolveAuthContext` is required, never defaulted.
 */
export function createUsersRoutes(
  uow: UnitOfWork,
  hasher: SecretHasher,
  resolveAuthContext: AuthContextResolver,
  options: UsersRoutesOptions = {},
) {
  const { readAllowedEmailDomains, audit, sessions, loginThrottle, erasure } = options;
  const gate = createPermissionGate(resolveAuthContext);
  const app = new Hono();

  /**
   * The ROLE and the admin flag travel — they are what a user account grants.
   * The PIN hash never does: a forensic log that carries the secret it is
   * meant to protect is a second copy of the credential store.
   *
   * That a credential CHANGED does travel, and has to. A supervisor who resets
   * the cashier's PIN, signs in as them, issues a credit note against a stolen
   * sale and resets the PIN back used to leave two UPDATE rows byte-identical
   * to a phone-number correction — and every document then named the wrong
   * person. `profile-routes` already recorded this for a SELF-service change;
   * the admin-initiated direction, which is the dangerous one, recorded nothing.
   */
  function auditUser(c: Context, user: User, action: string, before?: User | null, credentials?: CredentialChange) {
    return recordAdminEvent(audit, c, {
      module: "admin",
      entityType: "USER",
      entityId: user.id,
      action,
      details: {
        email: user.email,
        roleId: user.roleId,
        isCompanyAdmin: user.isCompanyAdmin,
        status: user.status,
        branchScope: user.branchScope,
        warehouseScope: user.warehouseScope,
        ...(credentials?.pinChanged ? { pinChanged: true } : {}),
        ...(credentials?.passwordChanged ? { passwordChanged: true } : {}),
        ...(before
          ? {
              previousRoleId: before.roleId,
              previousIsCompanyAdmin: before.isCompanyAdmin,
              previousStatus: before.status,
              previousBranchScope: before.branchScope,
              previousWarehouseScope: before.warehouseScope,
            }
          : {}),
      },
    });
  }

  interface CredentialChange {
    readonly pinChanged: boolean;
    readonly passwordChanged: boolean;
  }

  function credentialChange(body: { pin?: string | null; password?: string }): CredentialChange {
    return { pinChanged: body.pin !== undefined, passwordChanged: body.password !== undefined };
  }

  /**
   * A credential set BY SOMEBODY ELSE, on the security stream at CRITICAL.
   *
   * Separate from the UPDATE row because this is the event an auditor searches
   * for by name, and because it is the one administrative act that makes every
   * later document attributable to the wrong person.
   */
  function auditCredentialReset(c: Context, user: User, change: CredentialChange) {
    if (!change.pinChanged && !change.passwordChanged) return Promise.resolve();
    const actor = getAuthContext(c)?.userId;
    if (actor === user.id) return Promise.resolve(); // self-service; profile-routes records it
    return recordSecurityAdminEvent(audit, c, {
      module: "admin",
      entityType: "USER",
      entityId: user.id,
      action: "CREDENTIAL_RESET_BY_ADMIN",
      severity: "CRITICAL",
      details: {
        email: user.email,
        pinChanged: change.pinChanged,
        passwordChanged: change.passwordChanged,
      },
    });
  }

  /**
   * A refusal, recorded.
   *
   * Every escalation guard returned 403 and wrote nothing, so a clerk probing
   * fifty times — and using the outrank refusal as a free oracle over the org's
   * authority map — left zero rows. The reconnaissance half of an insider fraud
   * was invisible, and the one signal that would have caught the escalation
   * holes BEFORE they were exploited was discarded.
   */
  function auditRefusal(c: Context, entityId: string | null, details: Record<string, unknown>) {
    return recordSecurityAdminEvent(audit, c, {
      module: "admin",
      entityType: "USER",
      entityId,
      action: "PRIVILEGE_ESCALATION_DENIED",
      severity: "CRITICAL",
      details,
    });
  }

  const saveOptions = async () => ({ allowedEmailDomains: (await readAllowedEmailDomains?.()) ?? [] });

  /**
   * The authority an account carries — the admin flag, whatever its role
   * grants, and WHERE it may act. Read from the ROLE STORE, never from the
   * request: the caller names a roleId, and what that id is worth is the
   * server's to say.
   *
   * An unresolvable `roleId` is reported as such rather than as "no
   * permissions". Treating it as harmless made a security predicate fail open
   * on exactly the account whose authority the server could not establish.
   */
  async function authorityOf(account: {
    roleId: string | null;
    isCompanyAdmin: boolean;
    branchScope?: AccountAuthority["branchScope"];
    warehouseScope?: AccountAuthority["warehouseScope"];
  }): Promise<AccountAuthority> {
    const scopes = { branchScope: account.branchScope, warehouseScope: account.warehouseScope };
    if (!account.roleId) {
      return { isCompanyAdmin: account.isCompanyAdmin, permissions: [], ...scopes };
    }
    const role = await uow.roles.findById(account.roleId);
    return {
      isCompanyAdmin: account.isCompanyAdmin,
      permissions: role ? [...role.permissions] : [],
      roleUnresolved: !role,
      ...scopes,
    };
  }

  function refuseScope(c: Context, scopes: readonly string[]) {
    return c.json(
      {
        error: "PRIVILEGE_ESCALATION_DENIED",
        scopes: [...scopes],
        message: "لا يمكنك منح نطاق أوسع من نطاقك.",
      },
      403,
    );
  }

  function refuseGrant(c: Context, permissions: readonly string[]) {
    return c.json(
      {
        error: "PRIVILEGE_ESCALATION_DENIED",
        permissions: [...permissions],
        message: "لا يمكنك منح صلاحيات لا تملكها.",
      },
      403,
    );
  }

  /**
   * ENH-051 — the role a user is being given grants both sides of a
   * `permissions/sod.ts` pair. Refused unless the caller acknowledges it with
   * a reason; the acknowledgement is then audited on the user, so putting a
   * specific person into a conflicted seat is a decision on record even when
   * the role itself was saved (and acknowledged) long before.
   */
  function refuseSodConflicts(c: Context, conflicts: readonly SodConflictMatch[]) {
    return c.json(
      {
        error: "SOD_CONFLICT",
        conflicts,
        message:
          "الدور المطلوب إسناده يجمع بين طرفي فصل مهام لا يجوز الجمع بينهما لهذا المستخدم. أرسل acknowledge مع سبب لحفظه رغم ذلك.",
      },
      409,
    );
  }

  /**
   * `isCompanyAdmin` grants the wildcard just as surely as a role listing
   * `"*"` does — `authorityOf` above already treats it that way for the
   * outrank/escalation checks — so it is checked here too. Without this, the
   * quickest way past every SoD gate in the product was the flag this route
   * exists to set: `isCompanyAdmin: true`, no role, nothing to look up.
   */
  async function sodConflictsOfGrant(grant: { roleId: string | null; isCompanyAdmin: boolean }): Promise<readonly SodConflictMatch[]> {
    if (grant.isCompanyAdmin) return detectSodConflicts([WILDCARD_PERMISSION]);
    if (!grant.roleId) return [];
    const role = await uow.roles.findById(grant.roleId);
    if (!role) return [];
    return detectSodConflicts(role.permissions);
  }

  /**
   * INVARIANT: every refusal the caller CANNOT argue with is evaluated before
   * `SOD_CONFLICT`, which they can. A 409 that says «أرسل acknowledge مع سبب»
   * ahead of a 422 the acknowledgement will never satisfy asks an admin to put
   * an override on record as the price of finding out the address was never
   * allowed. Keep the acknowledgeable gate last.
   */
  async function refuseIfDomainNotAllowed(c: Context, email: string) {
    const refusal = emailDomainRefusal(email, (await saveOptions()).allowedEmailDomains);
    return refusal ? userErrorResponse(c, refusal) : null;
  }

  function auditSodOverride(c: Context, user: User, conflicts: readonly SodConflictMatch[], reason: string) {
    return recordAdminEvent(audit, c, {
      module: "admin",
      entityType: "USER",
      entityId: user.id,
      action: "SOD_OVERRIDE",
      severity: "WARNING",
      details: { roleId: user.roleId, reason, conflicts: conflicts.map((cf) => cf.ruleId) },
    });
  }

  function refuseOutranked(c: Context) {
    return c.json(
      {
        error: "PRIVILEGE_ESCALATION_DENIED",
        message: "لا يمكنك تعديل حساب صلاحياته أوسع من صلاحياتك.",
      },
      403,
    );
  }

  /**
   * The second half of authorization, and the half that was missing: the gate
   * says the caller may edit users, this says WHICH authority they may hand
   * out. Returns a refusal response, or null when the grant is within reach.
   *
   * Both dimensions are compared. Comparing only the permission list left every
   * branch and warehouse boundary in the product optional for anyone holding
   * `admin.users.edit`: a branch manager scoped to one branch could `PUT` their
   * OWN account with `branchScope: "*"` and an unchanged role — identical
   * authority on the only axis anyone checked — and walk out with tenant-wide
   * reach.
   */
  async function refuseIfEscalating(
    c: Context,
    granted: { roleId: string | null; isCompanyAdmin: boolean; branchScope?: ScopeSelection; warehouseScope?: ScopeSelection },
    /** The account being written, so a refusal can name what was reached for. Null on create. */
    targetId: string | null,
  ) {
    const ctx = getAuthContext(c);
    if (!ctx) return refuseOutranked(c);
    const authority = await authorityOf(granted);
    if (authority.isCompanyAdmin && !isTenantAdmin(ctx)) {
      await auditRefusal(c, targetId, { reason: "GRANT_COMPANY_ADMIN", permissions: ["*"] });
      return refuseGrant(c, ["*"]);
    }
    const ungrantable = ungrantablePermissions(ctx, authority.permissions);
    if (ungrantable.length > 0) {
      await auditRefusal(c, targetId, { reason: "GRANT_UNHELD_PERMISSIONS", permissions: ungrantable });
      return refuseGrant(c, ungrantable);
    }
    // WHERE is authority too: a caller who can write a wider branch/warehouse
    // scope than they hold defeats every read-narrowing at once (D118). Audited
    // like every other refusal — a probe that leaves no row is a probe nobody
    // ever sees.
    const overreach = ungrantableScopes(ctx, granted);
    if (overreach.length > 0) {
      await auditRefusal(c, targetId, { reason: "WIDEN_SCOPE", scopes: overreach });
      return refuseScope(c, overreach);
    }
    return null;
  }

  /**
   * Refuses a write that would push the tenant's ACTIVE user count past its
   * plan's seat count — create, and reactivation via `/activate` or a `PUT`
   * that flips `status` from `inactive` to `active`. Null when there is
   * nothing to refuse (no bound entitlements, or seats still have room).
   */
  async function refuseIfOverSeatCap(c: Context) {
    const entitlements = c.get("entitlements");
    if (!entitlements) return null;
    const activeCount = (await uow.users.list()).filter((u) => u.status === "active").length;
    if (activeCount >= entitlements.seats) {
      return c.json(
        { error: "SEAT_LIMIT_REACHED", message: "وصلتم إلى الحد الأقصى للمستخدمين في باقتكم" },
        409,
      );
    }
    return null;
  }

  /** Refuses any write against an account that already outranks the caller. */
  async function refuseIfTargetOutranks(c: Context, targetId: string) {
    const ctx = getAuthContext(c);
    const target = await uow.users.findById(targetId);
    if (!target) return c.json({ error: "USER_NOT_FOUND", message: "المستخدم غير موجود." }, 404);
    if (!ctx || targetOutranksCaller(ctx, await authorityOf(target))) {
      await auditRefusal(c, targetId, { reason: "TARGET_OUTRANKS_CALLER", targetEmail: target.email });
      return refuseOutranked(c);
    }
    return null;
  }

  function refuseErased(c: Context, user: User | null) {
    if (!user || !isErasedUser(user)) return null;
    return c.json(
      {
        error: "USER_ERASED",
        message: "محيت بيانات هذا المستخدم الشخصية؛ لا يمكن تعديله أو تفعيله. أنشئ حسابًا جديدًا إن عاد.",
        messageEn: "This user's personal data was erased; the account cannot be edited or reactivated. Create a new account if they return.",
      },
      409,
    );
  }

  app.get("/", gate("admin.users.view"), async (c) => {
    const users = await uow.users.list();
    return c.json(users.map(serializeUser));
  });

  app.get("/:id", gate("admin.users.view"), async (c) => {
    const user = await uow.users.findById(c.req.param("id"));
    if (!user) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json(serializeUser(user));
  });

  app.post("/", gate("admin.users.create"), async (c) => {
    const parsed = createUserSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const escalation = await refuseIfEscalating(c, parsed.data, null);
    if (escalation) return escalation;
    const domainRefusal = await refuseIfDomainNotAllowed(c, parsed.data.email);
    if (domainRefusal) return domainRefusal;
    const conflicts = await sodConflictsOfGrant(parsed.data);
    if (conflicts.length > 0 && !(parsed.data.acknowledge && parsed.data.reason)) {
      return refuseSodConflicts(c, conflicts);
    }
    const overCap = await refuseIfOverSeatCap(c);
    if (overCap) return overCap;
    try {
      const user = await saveUser(
        { id: crypto.randomUUID(), ...parsed.data, createdAt: new Date().toISOString() },
        uow,
        hasher,
        await saveOptions(),
      );
      await auditUser(c, user, "CREATE", null, credentialChange(parsed.data));
      if (conflicts.length > 0) await auditSodOverride(c, user, conflicts, parsed.data.reason ?? "");
      return c.json(serializeUser(user), 201);
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  app.put("/:id", gate("admin.users.edit"), async (c) => {
    const parsed = updateUserSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    }
    const id = c.req.param("id");
    // Read before the write: "role changed" is only evidence with both ends.
    const before = await uow.users.findById(id);
    // A PUT is an EDIT. Letting an unknown id fall through created the account
    // instead, so a caller-chosen id was a second, unaudited create route.
    if (!before) return c.json({ error: "USER_NOT_FOUND", message: "المستخدم غير موجود." }, 404);
    const erasedRefusal = refuseErased(c, before);
    if (erasedRefusal) return erasedRefusal;
    const outranked = await refuseIfTargetOutranks(c, id);
    if (outranked) return outranked;
    const escalation = await refuseIfEscalating(c, parsed.data, id);
    if (escalation) return escalation;
    // The check runs only when the GRANT itself is changing — role OR the
    // admin flag, since either one decides which side(s) of a rule this
    // account reaches. An unrelated edit (phone number, branch scope) to an
    // account already sitting in a conflicted seat must not re-block on every
    // save of a decision nobody is making right now.
    const domainRefusal = await refuseIfDomainNotAllowed(c, parsed.data.email);
    if (domainRefusal) return domainRefusal;
    const grantChanged = before.roleId !== parsed.data.roleId || before.isCompanyAdmin !== parsed.data.isCompanyAdmin;
    const conflicts = grantChanged ? await sodConflictsOfGrant(parsed.data) : [];
    if (conflicts.length > 0 && !(parsed.data.acknowledge && parsed.data.reason)) {
      return refuseSodConflicts(c, conflicts);
    }
    // Reactivation is a seat grant like any other: a PUT that flips a
    // deactivated account back to `active` must stop at the same cap
    // `POST /` and `/activate` do, or the cap is only a suggestion.
    if (before.status === "inactive" && parsed.data.status === "active") {
      const overCap = await refuseIfOverSeatCap(c);
      if (overCap) return overCap;
    }
    const change = credentialChange(parsed.data);
    try {
      // ONE transaction around read-check-write. Without it two concurrent
      // edits interleave between the guard and the save, and the later write
      // lands over the earlier one — which cannot escalate (the guard still
      // bounds what either caller may write) but does silently undo a
      // promotion and reset a PIN nobody asked to reset.
      const user = await uow.transaction(async (tx) => {
        const current = await tx.users.findById(id);
        if (!current) throw new UserNotFoundError(id);
        return saveUser(
          // The account keeps the date it was created on; stamping `now` here
          // reset it on every edit.
          { id, ...parsed.data, createdAt: current.createdAt },
          tx,
          hasher,
          await saveOptions(),
        );
      });
      await auditUser(c, user, "UPDATE", before, change);
      await auditCredentialReset(c, user, change);
      if (conflicts.length > 0) await auditSodOverride(c, user, conflicts, parsed.data.reason ?? "");
      // A grant is snapshotted into the session at login. Anything that changes
      // what this account is worth — its role, its admin flag, its scope, its
      // credential — has to end the sessions carrying the old answer, or every
      // incident-response action the product offers is advisory for half a day.
      if (
        sessions &&
        (change.pinChanged ||
          change.passwordChanged ||
          before.roleId !== user.roleId ||
          before.isCompanyAdmin !== user.isCompanyAdmin ||
          JSON.stringify(before.branchScope) !== JSON.stringify(user.branchScope) ||
          JSON.stringify(before.warehouseScope) !== JSON.stringify(user.warehouseScope) ||
          user.status !== "active")
      ) {
        sessions.revokeUser(user.id);
      }
      return c.json(serializeUser(user));
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  app.post("/:id/deactivate", gate("admin.users.deactivate"), async (c) => {
    const outranked = await refuseIfTargetOutranks(c, c.req.param("id"));
    if (outranked) return outranked;
    try {
      const user = await setUserStatus(c.req.param("id"), "inactive", uow);
      await auditUser(c, user, "DEACTIVATE");
      // Firing someone at 10:00 must not leave them posting at 10:05.
      sessions?.revokeUser(user.id);
      if (loginThrottle) loginThrottle.succeed(user.email.trim().toLowerCase());
      return c.json(serializeUser(user));
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  app.post("/:id/activate", gate("admin.users.edit"), async (c) => {
    const id = c.req.param("id");
    const outranked = await refuseIfTargetOutranks(c, id);
    if (outranked) return outranked;
    const target = await uow.users.findById(id);
    const erasedRefusal = refuseErased(c, target);
    if (erasedRefusal) return erasedRefusal;
    if (target?.status === "inactive") {
      const overCap = await refuseIfOverSeatCap(c);
      if (overCap) return overCap;
    }
    try {
      const user = await setUserStatus(id, "active", uow);
      await auditUser(c, user, "ACTIVATE");
      return c.json(serializeUser(user));
    } catch (err) {
      return userErrorResponse(c, err);
    }
  });

  /**
   * Clears a failed-login lockout.
   *
   * The lockout is deliberately keyed per ACCOUNT, which is right — but it left
   * the product with no way back in short of waiting fifteen minutes or
   * restarting the machine everyone is selling on. A trainer demoing wrong
   * PINs, a new hire fumbling a numeric pad, or anyone on the shop wifi who
   * knows the owner's email (it is printed on every invoice) could take a till
   * out of service with no recourse inside the product.
   *
   * Gated on its own permission so the branch manager standing beside the till
   * can use it without also being handed every colleague's PIN.
   */
  app.post("/:id/unlock", gate("admin.users.unlock"), async (c) => {
    const user = await uow.users.findById(c.req.param("id"));
    if (!user) return c.json({ error: "USER_NOT_FOUND", message: "المستخدم غير موجود." }, 404);
    const erasedRefusal = refuseErased(c, user);
    if (erasedRefusal) return erasedRefusal;
    const outranked = await refuseIfTargetOutranks(c, c.req.param("id"));
    if (outranked) return outranked;
    loginThrottle?.succeed(user.email.trim().toLowerCase());
    await recordSecurityAdminEvent(audit, c, {
      module: "admin",
      entityType: "USER",
      entityId: user.id,
      action: "ACCOUNT_UNLOCKED",
      severity: "WARNING",
      details: { email: user.email },
    });
    return c.json({ ok: true, userId: user.id });
  });

  if (erasure && audit) {
    const port = erasure;
    /**
     * «محو البيانات الشخصية» (D348) — the erasure the store listings promise.
     *
     * IDEMPOTENT BY DESIGN: a second call on an already-erased account is a
     * 200 with `alreadyErased: true` and no second write. A deletion request
     * that 409s on the retry is a deletion request the requester reasonably
     * reads as failed, and the retry must not re-run the linked-data sweep
     * against records the first pass already anonymised.
     */
    app.post("/:id/erase", gate("admin.users.erase_personal"), async (c) => {
      const parsed = eraseUserSchema.safeParse(await c.req.json().catch(() => ({})));
      if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
      const id = c.req.param("id");
      const ctx = getAuthContext(c);
      if (!ctx) return c.json({ error: "UNAUTHENTICATED" }, 401);
      // ORDER MATTERS: the hash hands the connection back, so it is taken
      // before anything is read — every check below is then made on rows no
      // other request has had a turn to change.
      const unusableHash = await hasher.hash(`${randomUUID()}${randomUUID()}`);
      const outranked = await refuseIfTargetOutranks(c, id);
      if (outranked) return outranked;
      const target = await uow.users.findById(id);
      if (!target) return c.json({ error: "USER_NOT_FOUND", message: "المستخدم غير موجود." }, 404);
      if (isErasedUser(target)) {
        return c.json({
          user: serializeUser(target),
          erased: { ...EMPTY_ERASURE_COUNTS, sessionsRevoked: false },
          alreadyErased: true,
          retained: ERASURE_RETAINS,
        });
      }
      if (parsed.data.confirmEmail.trim().toLowerCase() !== target.email) {
        return c.json(
          {
            error: "ERASURE_CONFIRMATION_MISMATCH",
            message: "البريد المكتوب للتأكيد لا يطابق بريد هذا المستخدم.",
            messageEn: "The confirmation email does not match this user's email.",
          },
          422,
        );
      }
      try {
        const result = await uow.transaction(async (tx) => {
          const current = await tx.users.findById(id);
          if (!current) throw new UserNotFoundError(id);
          if (isErasedUser(current)) return null;
          const employee = current.employeeId ? await port.linkedEmployee(current.employeeId) : null;
          assertUserErasable(current, { actorId: ctx.userId, users: await tx.users.list(), employee });
          const erased = erasedUser(current, new Date().toISOString(), unusableHash);
          await tx.users.save(erased);
          const counts = await port.eraseLinkedPersonalData({ userId: current.id, employee });
          // The actor, the subject id and the reason travel; the erased person's
          // NAME AND EMAIL must not, or the audit row becomes a surviving copy
          // of exactly what the erasure removed. It is awaited inside the
          // transaction, so a sink that cannot record rolls the erasure back.
          await recordSecurityAdminEvent(audit, c, {
            module: "admin",
            entityType: "USER",
            entityId: current.id,
            action: "PERSONAL_DATA_ERASED",
            severity: "CRITICAL",
            details: { reason: parsed.data.reason, employeeId: current.employeeId, ...counts, retained: ERASURE_RETAINS },
          });
          return { erased, counts, previousEmail: current.email };
        });
        if (!result) {
          const now = await uow.users.findById(id);
          return c.json({
            user: serializeUser(now ?? target),
            erased: { ...EMPTY_ERASURE_COUNTS, sessionsRevoked: false },
            alreadyErased: true,
            retained: ERASURE_RETAINS,
          });
        }
        sessions?.revokeUser(id);
        loginThrottle?.succeed(result.previousEmail);
        return c.json({
          user: serializeUser(result.erased),
          erased: { ...result.counts, sessionsRevoked: sessions !== undefined },
          alreadyErased: false,
          retained: ERASURE_RETAINS,
        });
      } catch (err) {
        return userErrorResponse(c, err);
      }
    });
  }

  return app;
}
