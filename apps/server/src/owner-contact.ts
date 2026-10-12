import { createHash, randomBytes } from "node:crypto";
import type { BackendHandle, PlatformHandle, SignedInUser } from "@mezan/backend";
import { OwnerHandOverOutcome, type UserEmailChange } from "@mezan/api";
import {
  AuditSeverityCode,
  normalizeEmail,
  OwnerContactProof,
  recordSecurityEvent,
  tenantHandedTo,
  tenantNeedingOwner,
  tenantWithOwnerContact,
  tenantWithPendingOwner,
  tenantWithPendingOwnerConfirmed,
  TenantStatusCode,
  type Tenant,
  type TenantOwnerAccount,
} from "@mezan/domain";

export enum OwnerContactAudit {
  Linked = "TENANT_OWNER_LINKED",
  EmailChanged = "TENANT_OWNER_EMAIL_CHANGED",
  Unverified = "TENANT_OWNER_CONTACT_UNVERIFIED",
  Verified = "TENANT_OWNER_CONTACT_VERIFIED",
  HandedOver = "TENANT_OWNER_HANDED_OVER",
  HandOverPending = "TENANT_OWNER_HAND_OVER_PENDING",
  OwnerNeeded = "TENANT_OWNER_NEEDED",
  Assigned = "TENANT_OWNER_ASSIGNED",
}

export enum OwnerConfirmation {
  PlatformConsole = "platform-console",
  PreviousOwnerLink = "previous-owner-link",
}

export const RECONCILE_ACTOR = "platform:owner-reconcile";
export const PREVIOUS_OWNER_ACTOR = "platform:previous-owner-link";

export function tenantActor(code: string, userId: string): string {
  return `tenant:${code}:${userId}`;
}

export function hashHandOverToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface OwnerHandOver {
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly toEmail: string;
  readonly actorId: string;
  readonly actorCredentialIsOwn?: boolean;
}

export interface PendingHandOverMail {
  readonly tenant: Tenant;
  readonly to: string;
  readonly successorEmail: string;
  readonly token: string;
}

type OwnerBackend = Pick<BackendHandle, "ownerAccount">;
type AssigningBackend = Pick<BackendHandle, "companyAdmins" | "recordOwnerAssigned">;

export class OwnerCandidateNotFoundError extends Error {
  readonly code = "TENANT_OWNER_CANDIDATE_NOT_FOUND";

  constructor() {
    super("الحساب المختار ليس مديرًا نشطًا في هذه المنشأة");
    this.name = "OwnerCandidateNotFoundError";
  }
}

export class NoPendingOwnerError extends Error {
  readonly code = "TENANT_NO_PENDING_OWNER";

  constructor() {
    super("لا يوجد مالك بانتظار التأكيد لهذه المنشأة");
    this.name = "NoPendingOwnerError";
  }
}

export interface OwnerContact {
  // SECURITY: never moves the recorded address. Only the owner's own act does.
  reconcile(tenantId: string, backend: OwnerBackend): Promise<void>;
  // SECURITY: the account the owner rules protect, known even before the platform row names it by id.
  effectiveOwnerUserId(tenantId: string, backend: OwnerBackend): Promise<string | null>;
  emailChanged(tenantId: string, change: UserEmailChange): Promise<void>;
  signedIn(tenantId: string, user: SignedInUser): Promise<void>;
  handOver(tenantId: string, input: OwnerHandOver): Promise<OwnerHandOverOutcome>;
  assign(tenantId: string, userId: string, actor: string, backend: AssigningBackend): Promise<Tenant>;
  confirmPending(tenantId: string, actor: string, by: OwnerConfirmation, backend: AssigningBackend): Promise<Tenant>;
  pendingByToken(token: string): Promise<Tenant | null>;
}

interface Change {
  readonly action: OwnerContactAudit;
  readonly severity: AuditSeverityCode;
}

function changeOf(before: Tenant, after: Tenant): Change {
  if (after.ownerEmail !== before.ownerEmail) return { action: OwnerContactAudit.EmailChanged, severity: AuditSeverityCode.Critical };
  if (after.ownerNeeded === true && before.ownerNeeded !== true) return { action: OwnerContactAudit.OwnerNeeded, severity: AuditSeverityCode.Warning };
  if (after.ownerContactVerified !== before.ownerContactVerified) {
    return after.ownerContactVerified
      ? { action: OwnerContactAudit.Verified, severity: AuditSeverityCode.Info }
      : { action: OwnerContactAudit.Unverified, severity: AuditSeverityCode.Warning };
  }
  return { action: OwnerContactAudit.Linked, severity: AuditSeverityCode.Info };
}

const WRITE_ATTEMPTS = 2;

export interface OwnerContactDeps {
  readonly platform: PlatformHandle;
  readonly now: () => Date;
  readonly mailPendingHandOver?: (mail: PendingHandOverMail) => Promise<void>;
  readonly tokenOf?: () => string;
}

export function createOwnerContact(deps: OwnerContactDeps): OwnerContact {
  const { tenants, signupRequests } = deps.platform.stores;
  const tokenOf = deps.tokenOf ?? (() => randomBytes(32).toString("base64url"));

  async function write(before: Tenant, after: Tenant, change: Change, actor: string, details: Record<string, unknown>): Promise<boolean> {
    return tenants.compareAndSetOwner(before, after, async () => {
      if (after.ownerEmail !== before.ownerEmail) await signupRequests.followOwnerEmail(before.code, before.ownerEmail, after.ownerEmail);
      await recordSecurityEvent(deps.platform.audit, {
        module: "platform",
        entityType: "PLATFORM",
        entityId: after.id,
        action: change.action,
        actor,
        severity: change.severity,
        timestamp: after.updatedAt,
        details: { code: after.code, before: before.ownerEmail, after: after.ownerEmail, userId: after.ownerUserId, ...details },
      });
    });
  }

  // SECURITY: every owner write resolves its tenant by id. A code is handed to
  // another company once its tenant is released.
  async function settle(tenantId: string, actorOf: (tenant: Tenant) => string, next: (tenant: Tenant, at: string) => Promise<Tenant | null> | Tenant | null): Promise<void> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const tenant = await tenants.findById(tenantId);
      if (!tenant) return;
      const after = await next(tenant, deps.now().toISOString());
      if (!after) return;
      if (await write(tenant, after, changeOf(tenant, after), actorOf(tenant), {})) return;
    }
  }

  function ownerOf(tenant: Tenant, candidate: TenantOwnerAccount, emailBefore: string, canAdminister: boolean): boolean {
    if (tenant.ownerUserId !== null) return tenant.ownerUserId === candidate.id;
    return canAdminister && tenant.ownerEmail === normalizeEmail(emailBefore);
  }

  async function recordedAccount(tenant: Tenant, backend: OwnerBackend) {
    return backend.ownerAccount(tenant.ownerUserId === null ? { email: tenant.ownerEmail } : { userId: tenant.ownerUserId });
  }

  async function handOverOnce(tenant: Tenant, input: OwnerHandOver, at: string): Promise<OwnerHandOverOutcome | null> {
    const actor = tenantActor(tenant.code, input.actorId);
    const successor = { id: input.toUserId, email: input.toEmail };
    const details = { fromUserId: input.fromUserId, toUserId: input.toUserId };
    // SECURITY: only the owner's own act hands the tenant over at once. Anyone
    // else's nomination, for themself or for a third account, waits for the
    // platform or for the previously recorded owner address to confirm it.
    if (input.actorId === input.fromUserId && input.actorCredentialIsOwn !== false) {
      const moved = await write(tenant, tenantHandedTo(tenant, successor, at), { action: OwnerContactAudit.HandedOver, severity: AuditSeverityCode.Critical }, actor, details);
      return moved ? OwnerHandOverOutcome.Verified : null;
    }
    const token = deps.mailPendingHandOver ? tokenOf() : null;
    const pending = tenantWithPendingOwner(tenant, successor, { requestedBy: actor, tokenHash: token === null ? null : hashHandOverToken(token) }, at);
    const recorded = await write(tenant, pending, { action: OwnerContactAudit.HandOverPending, severity: AuditSeverityCode.Critical }, actor, details);
    if (!recorded) return null;
    if (token !== null) {
      await deps
        .mailPendingHandOver?.({ tenant: pending, to: tenant.ownerEmail, successorEmail: pending.pendingOwner?.email ?? input.toEmail, token })
        .catch((err: unknown) => console.error(`[cloud] the pending hand-over of "${tenant.code}" was recorded, but mailing its confirmation link failed`, err));
    }
    return OwnerHandOverOutcome.Pending;
  }

  function alreadyHandedOver(tenant: Tenant, input: OwnerHandOver): OwnerHandOverOutcome | null {
    if (tenant.pendingOwner?.userId === input.toUserId) return OwnerHandOverOutcome.Pending;
    if (tenant.ownerUserId === input.toUserId) return OwnerHandOverOutcome.Verified;
    return null;
  }

  async function settleOwner(tenantId: string, after: (tenant: Tenant, at: string) => Tenant, change: Change, actor: string, details: Record<string, unknown>): Promise<Tenant> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const tenant = await tenants.findById(tenantId);
      if (!tenant) throw new Error("TENANT_NOT_FOUND");
      const next = after(tenant, deps.now().toISOString());
      if (await write(tenant, next, change, actor, details)) return next;
    }
    throw new Error("the tenant's owner changed while it was being assigned");
  }

  return {
    async reconcile(tenantId, backend) {
      await settle(tenantId, () => RECONCILE_ACTOR, async (tenant, at) => {
        const account = await recordedAccount(tenant, backend);
        if (!account || !account.canAdminister) return tenant.status === TenantStatusCode.Provisioning ? null : tenantNeedingOwner(tenant, at);
        return tenantWithOwnerContact(tenant, account, OwnerContactProof.Unproven, at);
      });
    },

    async effectiveOwnerUserId(tenantId, backend) {
      const tenant = await tenants.findById(tenantId);
      if (!tenant) return null;
      if (tenant.ownerUserId !== null) return tenant.ownerUserId;
      const account = await backend.ownerAccount({ email: tenant.ownerEmail });
      return account?.canAdminister ? account.id : null;
    },

    async emailChanged(tenantId, change) {
      const owner = { id: change.userId, email: change.after };
      const ownAct = change.userId === change.actorId && change.actorCredentialIsOwn !== false;
      const proof = ownAct ? OwnerContactProof.OwnerActed : OwnerContactProof.Unproven;
      await settle(tenantId, (tenant) => tenantActor(tenant.code, change.actorId), (tenant, at) =>
        tenant.ownerUserId === change.userId ? tenantWithOwnerContact(tenant, owner, proof, at) : null,
      );
    },

    async signedIn(tenantId, user) {
      const owner = { id: user.userId, email: user.email };
      const proof = user.credentialIsOwn ? OwnerContactProof.OwnerActed : OwnerContactProof.Unproven;
      await settle(tenantId, (tenant) => tenantActor(tenant.code, user.userId), (tenant, at) =>
        ownerOf(tenant, owner, user.email, user.canAdminister) ? tenantWithOwnerContact(tenant, owner, proof, at) : null,
      );
    },

    async handOver(tenantId, input) {
      for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
        const tenant = await tenants.findById(tenantId);
        if (!tenant) throw new Error("TENANT_NOT_FOUND");
        const done = alreadyHandedOver(tenant, input) ?? (await handOverOnce(tenant, input, deps.now().toISOString()));
        if (done) return done;
      }
      throw new Error("the tenant's owner changed while it was being handed over");
    },

    async assign(tenantId, userId, actor, backend) {
      const account = (await backend.companyAdmins()).find((admin) => admin.id === userId);
      if (!account) throw new OwnerCandidateNotFoundError();
      const before = await tenants.findById(tenantId);
      const assigned = await settleOwner(
        tenantId,
        (tenant, at) => tenantHandedTo(tenant, account, at),
        { action: OwnerContactAudit.Assigned, severity: AuditSeverityCode.Critical },
        actor,
        { fromUserId: before?.ownerUserId ?? null, toUserId: account.id, confirmedBy: OwnerConfirmation.PlatformConsole },
      );
      await backend.recordOwnerAssigned({ userId: account.id, previousUserId: before?.ownerUserId ?? null, actor, confirmedBy: OwnerConfirmation.PlatformConsole });
      return assigned;
    },

    async confirmPending(tenantId, actor, by, backend) {
      const before = await tenants.findById(tenantId);
      const pending = before?.pendingOwner;
      if (!before || !pending) throw new NoPendingOwnerError();
      if (!(await backend.companyAdmins()).some((admin) => admin.id === pending.userId)) throw new OwnerCandidateNotFoundError();
      const confirmed = await settleOwner(
        tenantId,
        (tenant, at) => tenantWithPendingOwnerConfirmed(tenant, at),
        { action: OwnerContactAudit.HandedOver, severity: AuditSeverityCode.Critical },
        actor,
        { fromUserId: before.ownerUserId, toUserId: pending.userId, confirmedBy: by },
      );
      await backend.recordOwnerAssigned({ userId: pending.userId, previousUserId: before.ownerUserId, actor, confirmedBy: by });
      return confirmed;
    },

    async pendingByToken(token) {
      const hash = hashHandOverToken(token);
      return (await tenants.list()).find((tenant) => tenant.pendingOwner?.tokenHash === hash) ?? null;
    },
  };
}
