import { createHash, randomUUID } from "node:crypto";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import {
  UserImportRowProblemCode,
  UserStatusCode,
  cloneUserPreferences,
  detectSodConflicts,
  parseUserImportCsv,
  resolveImportScope,
  saveUser,
  ungrantablePermissions,
  ungrantableScopes,
  userImportFileProblemMessage,
  userImportRowProblemMessage,
  emailDomainRefusal,
  type Branch,
  type Role,
  type ScopeSelection,
  type SodConflictMatch,
  type UnitOfWork,
  type User,
  type UserImportRow,
  type UserImportRowProblem,
  type UserPreferencesRepository,
  type SecretHasher,
  type Warehouse,
} from "@mezan/domain";
import {
  UserImportRowStatusDTO,
  cloneUserSchema,
  importUsersSchema,
  type CloneUserResultDTO,
  type OneTimeCredentialDTO,
  type UserImportProblemDTO,
  type UserImportReportDTO,
  type UserImportRowResultDTO,
} from "@mezan/contracts";
import { getAuthContext } from "./permission-gate.js";
import { recordAdminEvent } from "./admin-audit.js";
import { generateOneTimeSecrets, takeProvisionedSecrets, CLONE_SECRETS_KEY, type OneTimeSecrets } from "./provisioning-secrets.js";
import type { AuditSink } from "@mezan/domain";

export interface ProvisioningPorts {
  readonly branches?: { findAll(): Promise<readonly Branch[]> };
  readonly warehouses?: { findAll(): Promise<readonly Warehouse[]> };
  readonly preferences?: UserPreferencesRepository;
}

interface CredentialsSet {
  readonly passwordChanged: boolean;
}

export interface ProvisioningKit {
  readonly uow: UnitOfWork;
  readonly hasher: SecretHasher;
  readonly audit: AuditSink | undefined;
  readonly ports: ProvisioningPorts;
  readonly gate: (permission: string) => MiddlewareHandler;
  readonly visibleTarget: MiddlewareHandler;
  readonly saveOptions: () => Promise<{ allowedEmailDomains: readonly string[] }>;
  readonly refuseIfEscalating: (
    c: Context,
    granted: { roleId: string | null; isCompanyAdmin: boolean; branchScope?: ScopeSelection; warehouseScope?: ScopeSelection },
    targetId: string | null,
  ) => Promise<Response | null>;
  readonly refuseIfDomainNotAllowed: (c: Context, email: string) => Promise<Response | null>;
  readonly refuseIfTargetOutranks: (c: Context, targetId: string) => Promise<Response | null>;
  readonly refuseIfOverSeatCap: (c: Context) => Promise<Response | null>;
  readonly refuseSodConflicts: (c: Context, conflicts: readonly SodConflictMatch[]) => Response;
  readonly refuseErased: (c: Context, user: User | null) => Response | null;
  readonly sodConflictsOfGrant: (grant: { roleId: string | null; isCompanyAdmin: boolean }) => Promise<readonly SodConflictMatch[]>;
  readonly auditUser: (c: Context, user: User, action: string, before?: User | null, credentials?: CredentialsSet) => Promise<void>;
  readonly auditSodOverride: (c: Context, user: User, conflicts: readonly SodConflictMatch[], reason: string) => Promise<void>;
  readonly auditRefusal: (c: Context, entityId: string | null, details: Record<string, unknown>) => Promise<void>;
  readonly userErrorResponse: (c: Context, err: unknown) => Response;
  readonly userNotFound: (c: Context) => Response;
}

const NO_STORE = "no-store";
const PASSWORD_SET: CredentialsSet = { passwordChanged: true };

function problemDto(problem: UserImportRowProblem): UserImportProblemDTO {
  const message = userImportRowProblemMessage(problem);
  return { code: problem.code, messageAr: message.ar, messageEn: message.en };
}

function digestOf(actorId: string, rows: readonly UserImportRow[]): string {
  const canonical = rows.map((row) => [row.rowNumber, row.nameAr, row.nameEn, row.email, row.phone, row.roleCode, row.branches, row.warehouses]);
  return createHash("sha256").update(`${actorId}\n${JSON.stringify(canonical)}`).digest("hex");
}

function findRole(roles: readonly Role[], code: string): Role | undefined {
  return roles.find((role) => role.code === code) ?? roles.find((role) => role.code.toLowerCase() === code.toLowerCase());
}

interface PlannedRow {
  readonly row: UserImportRow;
  readonly problems: readonly UserImportRowProblem[];
  readonly role: Role | null;
  readonly branchScope: ScopeSelection;
  readonly warehouseScope: ScopeSelection;
  readonly conflicts: readonly SodConflictMatch[];
}

export function createUserProvisioningRoutes(kit: ProvisioningKit): Hono {
  const app = new Hono();
  const { uow, hasher, audit, ports, gate } = kit;

  async function seatRoom(c: Context): Promise<{ limit: number | null; active: number; available: number | null }> {
    const entitlements = c.get("entitlements");
    const active = (await uow.users.list()).filter((user) => user.status === UserStatusCode.Active).length;
    if (!entitlements) return { limit: null, active, available: null };
    return { limit: entitlements.seats, active, available: Math.max(0, entitlements.seats - active) };
  }

  async function plan(
    c: Context,
    rows: readonly UserImportRow[],
    acknowledged: boolean,
    available: number | null,
  ): Promise<readonly PlannedRow[]> {
    const ctx = getAuthContext(c);
    const roles = await uow.roles.list();
    const takenEmails = new Set((await uow.users.list()).map((user) => user.email));
    const branches = (await ports.branches?.findAll()) ?? [];
    const warehouses = (await ports.warehouses?.findAll()) ?? [];
    const allowedDomains = (await kit.saveOptions()).allowedEmailDomains;
    const roleVerdicts = new Map<string, { grantable: boolean; conflicts: readonly SodConflictMatch[] }>();
    let seatsUsed = 0;
    return rows.map((row): PlannedRow => {
      const problems: UserImportRowProblem[] = [...row.problems];
      if (row.email !== "" && takenEmails.has(row.email)) problems.push({ code: UserImportRowProblemCode.EmailTaken });
      if (row.email !== "" && emailDomainRefusal(row.email, allowedDomains)) problems.push({ code: UserImportRowProblemCode.EmailDomainNotAllowed });

      const role = row.roleCode === "" ? null : (findRole(roles, row.roleCode) ?? null);
      let conflicts: readonly SodConflictMatch[] = [];
      if (row.roleCode !== "" && !role) problems.push({ code: UserImportRowProblemCode.UnknownRole, detail: row.roleCode });
      if (role) {
        let verdict = roleVerdicts.get(role.id);
        if (!verdict) {
          verdict = {
            grantable: ctx !== undefined && ungrantablePermissions(ctx, role.permissions).length === 0,
            conflicts: detectSodConflicts(role.permissions),
          };
          roleVerdicts.set(role.id, verdict);
        }
        conflicts = verdict.conflicts;
        if (!verdict.grantable) problems.push({ code: UserImportRowProblemCode.RoleNotGrantable, detail: role.code });
        else if (conflicts.length > 0 && !acknowledged) problems.push({ code: UserImportRowProblemCode.SodConflict, detail: role.code });
      }

      const branch = resolveImportScope(row.branches, branches);
      for (const token of branch.unknown) problems.push({ code: UserImportRowProblemCode.UnknownBranch, detail: token });
      const warehouse = resolveImportScope(row.warehouses, warehouses);
      for (const token of warehouse.unknown) problems.push({ code: UserImportRowProblemCode.UnknownWarehouse, detail: token });
      if (ctx && branch.unknown.length === 0 && warehouse.unknown.length === 0 && ungrantableScopes(ctx, { branchScope: branch.scope, warehouseScope: warehouse.scope }).length > 0) {
        problems.push({ code: UserImportRowProblemCode.ScopeNotGrantable });
      }

      if (problems.length === 0 && available !== null) {
        seatsUsed += 1;
        if (seatsUsed > available) problems.push({ code: UserImportRowProblemCode.SeatLimitReached });
      }
      return { row, problems, role, branchScope: branch.scope, warehouseScope: warehouse.scope, conflicts };
    });
  }

  function reportOf(
    planned: readonly PlannedRow[],
    fileProblems: readonly UserImportProblemDTO[],
    seats: { limit: number | null; active: number; available: number | null },
    extra: { dryRun: boolean; digest: string | null; created: number; credentials: readonly OneTimeCredentialDTO[] },
  ): UserImportReportDTO {
    const rows: UserImportRowResultDTO[] = planned.map((entry) => ({
      rowNumber: entry.row.rowNumber,
      email: entry.row.email,
      nameAr: entry.row.nameAr,
      roleCode: entry.row.roleCode,
      status: entry.problems.length === 0 ? UserImportRowStatusDTO.Ok : UserImportRowStatusDTO.Error,
      problems: entry.problems.map(problemDto),
    }));
    const valid = rows.filter((row) => row.status === UserImportRowStatusDTO.Ok).length;
    return {
      dryRun: extra.dryRun,
      digest: extra.digest,
      fileProblems: [...fileProblems],
      rows,
      summary: { total: rows.length, valid, invalid: rows.length - valid },
      seats,
      created: extra.created,
      credentials: [...extra.credentials],
    };
  }

  app.post("/import", gate("admin.users.create"), async (c) => {
    const parsedBody = importUsersSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsedBody.success) return c.json({ error: "VALIDATION_ERROR", details: parsedBody.error.flatten() }, 400);
    const body = parsedBody.data;
    const actorId = getAuthContext(c)?.userId ?? "unknown";
    const seats = await seatRoom(c);
    const parsed = parseUserImportCsv(body.csv);
    const fileProblems: UserImportProblemDTO[] = parsed.fileProblems.map((problem) => {
      const message = userImportFileProblemMessage(problem);
      return { code: problem.code, column: problem.column, messageAr: message.ar, messageEn: message.en };
    });
    const acknowledged = Boolean(body.acknowledge && body.reason);
    const planned = fileProblems.length > 0 ? [] : await plan(c, parsed.rows, acknowledged, seats.available);
    const clean = fileProblems.length === 0 && planned.length > 0 && planned.every((entry) => entry.problems.length === 0);
    const digest = clean ? digestOf(actorId, parsed.rows) : null;
    c.header("cache-control", NO_STORE);

    if (body.dryRun) {
      return c.json(reportOf(planned, fileProblems, seats, { dryRun: true, digest, created: 0, credentials: [] }));
    }
    if (!clean) {
      return c.json(reportOf(planned, fileProblems, seats, { dryRun: false, digest: null, created: 0, credentials: [] }), 422);
    }
    if (body.digest !== digest) {
      return c.json(
        {
          error: "DRY_RUN_REQUIRED",
          message: "نفّذ تشغيلًا تجريبيًا لهذا الملف نفسه أولًا، ثم أكّد الاستيراد بالبصمة التي يعيدها.",
          messageEn: "Run a dry run of this exact file first, then confirm the import with the digest it returns.",
        },
        409,
      );
    }

    const prepared = takeProvisionedSecrets(c);
    const options = await kit.saveOptions();
    try {
      const created = await uow.transaction(async (tx) => {
        const made: { user: User; secrets: OneTimeSecrets; entry: PlannedRow }[] = [];
        for (const entry of planned) {
          const secrets = prepared?.get(entry.row.rowNumber) ?? generateOneTimeSecrets();
          const user = await saveUser(
            {
              id: randomUUID(),
              nameAr: entry.row.nameAr,
              nameEn: entry.row.nameEn,
              email: entry.row.email,
              phone: entry.row.phone,
              password: secrets.password,
              roleId: entry.role?.id ?? null,
              isCompanyAdmin: false,
              employeeId: null,
              branchScope: entry.branchScope,
              warehouseScope: entry.warehouseScope,
              status: UserStatusCode.Active,
              createdAt: new Date().toISOString(),
            },
            tx,
            hasher,
            options,
          );
          made.push({ user, secrets, entry });
        }
        return made;
      });
      for (const { user, entry } of created) {
        await kit.auditUser(c, user, "CREATE", null, PASSWORD_SET);
        if (entry.conflicts.length > 0) await kit.auditSodOverride(c, user, entry.conflicts, body.reason ?? "");
      }
      await recordAdminEvent(audit, c, {
        module: "admin",
        entityType: "USER_IMPORT",
        entityId: digest,
        action: "USERS_IMPORTED",
        details: {
          created: created.length,
          roleCodes: Array.from(new Set(planned.map((entry) => entry.role?.code ?? entry.row.roleCode))),
          sodAcknowledged: planned.some((entry) => entry.conflicts.length > 0),
        },
      });
      const credentials: OneTimeCredentialDTO[] = created.map(({ user, secrets, entry }) => ({
        rowNumber: entry.row.rowNumber,
        userId: user.id,
        email: user.email,
        nameAr: user.nameAr,
        password: secrets.password,
      }));
      return c.json(reportOf(planned, fileProblems, seats, { dryRun: false, digest, created: created.length, credentials }), 201);
    } catch (err) {
      return kit.userErrorResponse(c, err);
    }
  });

  app.post("/:id/clone", gate("admin.users.create"), kit.visibleTarget, async (c) => {
    const parsed = cloneUserSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "VALIDATION_ERROR", details: parsed.error.flatten() }, 400);
    const sourceId = c.req.param("id");
    const source = await uow.users.findById(sourceId);
    if (!source) return kit.userNotFound(c);
    const erased = kit.refuseErased(c, source);
    if (erased) return erased;
    const outranked = await kit.refuseIfTargetOutranks(c, sourceId);
    if (outranked) return outranked;
    if (source.isCompanyAdmin || source.roleId === null) {
      await kit.auditRefusal(c, sourceId, { reason: "CLONE_COMPANY_ADMIN_REFUSED" });
      return c.json(
        {
          error: "CLONE_ADMIN_REFUSED",
          message: "لا يُستنسخ حساب مدير الشركة؛ أنشئ المستخدم يدويًا ليكون منح هذه الصلاحية قرارًا مسجلًا.",
          messageEn: "A company-admin account cannot be cloned; create the user by hand so granting this access is a recorded decision.",
        },
        422,
      );
    }
    const grant = { roleId: source.roleId, isCompanyAdmin: false, branchScope: source.branchScope, warehouseScope: source.warehouseScope };
    const escalation = await kit.refuseIfEscalating(c, grant, null);
    if (escalation) return escalation;
    const domainRefusal = await kit.refuseIfDomainNotAllowed(c, parsed.data.email);
    if (domainRefusal) return domainRefusal;
    const conflicts = await kit.sodConflictsOfGrant(grant);
    if (conflicts.length > 0 && !(parsed.data.acknowledge && parsed.data.reason)) return kit.refuseSodConflicts(c, conflicts);
    const overCap = await kit.refuseIfOverSeatCap(c);
    if (overCap) return overCap;

    const secrets = takeProvisionedSecrets(c)?.get(CLONE_SECRETS_KEY) ?? generateOneTimeSecrets();
    try {
      const user = await saveUser(
        {
          id: randomUUID(),
          nameAr: parsed.data.nameAr,
          nameEn: parsed.data.nameEn,
          email: parsed.data.email,
          phone: parsed.data.phone,
          password: secrets.password,
          roleId: source.roleId,
          isCompanyAdmin: false,
          employeeId: null,
          branchScope: source.branchScope,
          warehouseScope: source.warehouseScope,
          status: UserStatusCode.Active,
          createdAt: new Date().toISOString(),
        },
        uow,
        hasher,
        await kit.saveOptions(),
      );
      const sourcePreferences = (await ports.preferences?.get(sourceId)) ?? null;
      if (sourcePreferences && ports.preferences) await ports.preferences.save(cloneUserPreferences(sourcePreferences, user.id));
      await kit.auditUser(c, user, "CREATE", null, PASSWORD_SET);
      await recordAdminEvent(audit, c, {
        module: "admin",
        entityType: "USER",
        entityId: user.id,
        action: "USER_CLONED",
        details: { sourceUserId: sourceId, roleId: source.roleId, preferencesCopied: sourcePreferences !== null },
      });
      if (conflicts.length > 0) await kit.auditSodOverride(c, user, conflicts, parsed.data.reason ?? "");
      const result: CloneUserResultDTO = {
        user: { id: user.id, email: user.email, nameAr: user.nameAr, roleId: user.roleId },
        preferencesCopied: sourcePreferences !== null,
        credentials: { rowNumber: null, userId: user.id, email: user.email, nameAr: user.nameAr, password: secrets.password },
      };
      c.header("cache-control", NO_STORE);
      return c.json(result, 201);
    } catch (err) {
      return kit.userErrorResponse(c, err);
    }
  });

  return app;
}
