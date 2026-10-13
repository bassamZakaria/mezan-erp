import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PlatformAuditUnavailableError, type BackendHandle, type PlatformHandle, type SignedInUser } from "@mezan/backend";
import { OwnerHandOverOutcome, type UserEmailChange } from "@mezan/api";
import {
  AuditSeverityCode,
  normalizeEmail,
  OwnerConfirmation,
  OwnerContactProof,
  PendingOwnerLink,
  pendingOwnerExpired,
  recordSecurityEvent,
  tenantHandedTo,
  tenantNeedingOwner,
  tenantWithOwnerContact,
  tenantWithOwnerRecordDue,
  tenantWithPendingOwner,
  tenantWithPendingOwnerConfirmed,
  tenantWithPendingOwnerDeclined,
  tenantWithPendingOwnerLink,
  TenantStatusCode,
  type OwnerRecordDue,
  type Tenant,
  type TenantOwnerAccount,
} from "@mezan/domain";

import { TenantBooksUnconfirmedError } from "./tenant-books.js";

export enum OwnerContactAudit {
  Linked = "TENANT_OWNER_LINKED",
  EmailChanged = "TENANT_OWNER_EMAIL_CHANGED",
  Unverified = "TENANT_OWNER_CONTACT_UNVERIFIED",
  Verified = "TENANT_OWNER_CONTACT_VERIFIED",
  HandedOver = "TENANT_OWNER_HANDED_OVER",
  HandOverPending = "TENANT_OWNER_HAND_OVER_PENDING",
  HandOverDeclined = "TENANT_OWNER_HAND_OVER_DECLINED",
  HandOverLinkResent = "TENANT_OWNER_HAND_OVER_LINK_RESENT",
  HandOverLinkUnsent = "TENANT_OWNER_HAND_OVER_LINK_UNSENT",
  OwnerNeeded = "TENANT_OWNER_NEEDED",
  Assigned = "TENANT_OWNER_ASSIGNED",
  TenantRecordWritten = "TENANT_OWNER_RECORD_WRITTEN",
}

export { OwnerConfirmation };

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
type RecordingBackend = Pick<BackendHandle, "recordOwnerAssigned">;
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

export class PendingOwnerExpiredError extends Error {
  readonly code = "TENANT_PENDING_OWNER_EXPIRED";

  constructor() {
    super("انتهت مهلة تأكيد نقل الملكية. أرسل رابط التأكيد من جديد أو ألغِ الطلب.");
    this.name = "PendingOwnerExpiredError";
  }
}

export class OwnerRecordDueError extends Error {
  readonly code = "TENANT_OWNER_RECORD_DUE";
  readonly retryable = true;

  constructor(readonly cause?: unknown) {
    super("سجل المالك السابق لم يُكتب بعد في بيانات المنشأة. أعد المحاولة بعد لحظات.");
    this.name = "OwnerRecordDueError";
  }
}

export interface OwnerContact {
  reconcile(tenantId: string, backend: OwnerBackend & RecordingBackend): Promise<void>;
  effectiveOwnerUserId(tenantId: string, backend: OwnerBackend): Promise<string | null>;
  emailChanged(tenantId: string, change: UserEmailChange): Promise<void>;
  signedIn(tenantId: string, user: SignedInUser): Promise<void>;
  handOver(tenantId: string, input: OwnerHandOver): Promise<OwnerHandOverOutcome>;
  assign(tenantId: string, userId: string, actor: string, backend: AssigningBackend): Promise<Tenant>;
  confirmPending(tenantId: string, actor: string, by: OwnerConfirmation, backend: AssigningBackend, link?: { readonly tokenHash: string }): Promise<Tenant>;
  declinePending(tenantId: string, actor: string): Promise<Tenant>;
  resendPending(tenantId: string, actor: string): Promise<Tenant>;
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
  readonly eventIdOf?: () => string;
}

export function createOwnerContact(deps: OwnerContactDeps): OwnerContact {
  const { tenants, signupRequests } = deps.platform.stores;
  const tokenOf = deps.tokenOf ?? (() => randomBytes(32).toString("base64url"));
  const eventIdOf = deps.eventIdOf ?? randomUUID;

  async function write(before: Tenant, after: Tenant, change: Change, actor: string, details: Record<string, unknown>): Promise<boolean> {
    return tenants.compareAndSetOwner(before, after, async () => {
      if (after.ownerEmail !== before.ownerEmail) await signupRequests.followOwnerEmail(before.code, before.ownerEmail, after.ownerEmail);
      // REQUIRED ORDERING: the audit row is written inside the transaction that
      // moves the owner. A row that cannot be written rolls the change back.
      await recordSecurityEvent(deps.platform.audit, {
        module: "platform",
        entityType: "PLATFORM",
        entityId: after.id,
        action: change.action,
        actor,
        severity: change.severity,
        timestamp: after.updatedAt,
        details: { code: after.code, before: before.ownerEmail, after: after.ownerEmail, userId: after.ownerUserId, ...details },
      }).catch((cause: unknown) => {
        throw new PlatformAuditUnavailableError(cause);
      });
    });
  }

  async function mailLink(tenant: Tenant, pending: Tenant, token: string | null, actor: string): Promise<boolean> {
    if (token === null || !deps.mailPendingHandOver || !pending.pendingOwner) return false;
    try {
      await deps.mailPendingHandOver({ tenant: pending, to: tenant.ownerEmail, successorEmail: pending.pendingOwner.email, token });
      return true;
    } catch (err) {
      console.error(`[cloud] the pending hand-over of "${tenant.code}" is recorded, but mailing its confirmation link failed`, err);
      // SECURITY: a link nobody received must not stay redeemable, and the
      // console must not say one was mailed.
      const unsent = tenantWithPendingOwnerLink(pending, PendingOwnerLink.Withdrawn, null, deps.now().toISOString());
      await write(pending, unsent, { action: OwnerContactAudit.HandOverLinkUnsent, severity: AuditSeverityCode.Warning }, actor, { toUserId: pending.pendingOwner.userId }).catch(
        (failure: unknown) => console.error(`[cloud] the unsent confirmation link of "${tenant.code}" could not be withdrawn`, failure),
      );
      return false;
    }
  }

  async function flushOwnerRecord(tenantId: string, backend: RecordingBackend): Promise<void> {
    const tenant = await tenants.findById(tenantId);
    const due = tenant?.ownerRecordDue;
    if (!tenant || !due) return;
    await backend.recordOwnerAssigned(due);
    await write(tenant, tenantWithOwnerRecordDue(tenant, null), { action: OwnerContactAudit.TenantRecordWritten, severity: AuditSeverityCode.Info }, due.actor, { eventId: due.eventId });
  }

  function flushOwnerRecordQuietly(tenantId: string, backend: RecordingBackend): Promise<void> {
    return flushOwnerRecord(tenantId, backend).catch((err: unknown) =>
      console.error(`[cloud] the owner of tenant "${tenantId}" is recorded on the platform; the tenant's own audit row is still due and is retried on the next open`, err),
    );
  }

  // REQUIRED ORDERING: the tenant's own record of the previous owner change is
  // written before another change is accepted. The platform row holds one due
  // record, and a second change written over it would never reach the tenant.
  async function flushOwnerRecordOrRefuse(tenantId: string, backend: RecordingBackend): Promise<void> {
    await flushOwnerRecord(tenantId, backend).catch((cause: unknown) => {
      if (cause instanceof PlatformAuditUnavailableError) throw cause;
      throw new OwnerRecordDueError(cause);
    });
  }

  function withNextOwnerRecordDue(tenant: Tenant, due: OwnerRecordDue): Tenant {
    if (tenant.ownerRecordDue) throw new OwnerRecordDueError();
    return tenantWithOwnerRecordDue(tenant, due);
  }

  function recordDue(userId: string, previousUserId: string | null, actor: string, confirmedBy: OwnerConfirmation): OwnerRecordDue {
    return { eventId: eventIdOf(), userId, previousUserId, actor, confirmedBy };
  }

  async function settle(tenantId: string, actorOf: (tenant: Tenant) => string, next: (tenant: Tenant, at: string) => Promise<Tenant | null> | Tenant | null): Promise<void> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const tenant = await tenants.findById(tenantId);
      // SECURITY: the platform does not learn who owns a company from books
      // nobody has confirmed are that company's.
      if (!tenant || tenant.booksReview) return;
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
    return (await mailLink(tenant, pending, token, actor)) ? OwnerHandOverOutcome.Pending : OwnerHandOverOutcome.PendingUnmailed;
  }

  function alreadyHandedOver(tenant: Tenant, input: OwnerHandOver, at: string): OwnerHandOverOutcome | null {
    const pending = tenant.pendingOwner;
    if (pending && pending.userId === input.toUserId && !pendingOwnerExpired(pending, at)) return pending.tokenHash === null ? OwnerHandOverOutcome.PendingUnmailed : OwnerHandOverOutcome.Pending;
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
      await flushOwnerRecordQuietly(tenantId, backend);
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
        if (tenant.booksReview) throw new TenantBooksUnconfirmedError();
        const at = deps.now().toISOString();
        const done = alreadyHandedOver(tenant, input, at) ?? (await handOverOnce(tenant, input, at));
        if (done) return done;
      }
      throw new Error("the tenant's owner changed while it was being handed over");
    },

    async assign(tenantId, userId, actor, backend) {
      const account = (await backend.companyAdmins()).find((admin) => admin.id === userId);
      if (!account) throw new OwnerCandidateNotFoundError();
      await flushOwnerRecordOrRefuse(tenantId, backend);
      const before = await tenants.findById(tenantId);
      const due = recordDue(account.id, before?.ownerUserId ?? null, actor, OwnerConfirmation.PlatformConsole);
      const assigned = await settleOwner(
        tenantId,
        (tenant, at) => withNextOwnerRecordDue(tenantHandedTo(tenant, account, at), due),
        { action: OwnerContactAudit.Assigned, severity: AuditSeverityCode.Critical },
        actor,
        { fromUserId: due.previousUserId, toUserId: account.id, confirmedBy: OwnerConfirmation.PlatformConsole, eventId: due.eventId },
      );
      await flushOwnerRecordQuietly(tenantId, backend);
      return assigned;
    },

    async confirmPending(tenantId, actor, by, backend, link) {
      const before = await tenants.findById(tenantId);
      const pending = before?.pendingOwner;
      if (!before || !pending || (link && pending.tokenHash !== link.tokenHash)) throw new NoPendingOwnerError();
      if (pendingOwnerExpired(pending, deps.now().toISOString())) throw new PendingOwnerExpiredError();
      if (!(await backend.companyAdmins()).some((admin) => admin.id === pending.userId)) throw new OwnerCandidateNotFoundError();
      await flushOwnerRecordOrRefuse(tenantId, backend);
      const due = recordDue(pending.userId, before.ownerUserId, actor, by);
      const confirmed = await settleOwner(
        tenantId,
        (tenant, at) => {
          // SECURITY: the request is read again inside the write that confirms
          // it. Only the successor, the link and the seven days that were
          // checked above are confirmed, never whatever replaced them since.
          const current = tenant.pendingOwner;
          if (!current || current.userId !== pending.userId || (link && current.tokenHash !== link.tokenHash)) throw new NoPendingOwnerError();
          if (pendingOwnerExpired(current, at)) throw new PendingOwnerExpiredError();
          return withNextOwnerRecordDue(tenantWithPendingOwnerConfirmed(tenant, at), due);
        },
        { action: OwnerContactAudit.HandedOver, severity: AuditSeverityCode.Critical },
        actor,
        { fromUserId: before.ownerUserId, toUserId: pending.userId, confirmedBy: by, eventId: due.eventId },
      );
      await flushOwnerRecordQuietly(tenantId, backend);
      return confirmed;
    },

    async declinePending(tenantId, actor) {
      const before = await tenants.findById(tenantId);
      const pending = before?.pendingOwner;
      if (!before || !pending) throw new NoPendingOwnerError();
      return settleOwner(
        tenantId,
        (tenant, at) => tenantWithPendingOwnerDeclined(tenant, at),
        { action: OwnerContactAudit.HandOverDeclined, severity: AuditSeverityCode.Critical },
        actor,
        { fromUserId: before.ownerUserId, toUserId: pending.userId, requestedBy: pending.requestedBy },
      );
    },

    async resendPending(tenantId, actor) {
      const before = await tenants.findById(tenantId);
      const pending = before?.pendingOwner;
      if (!before || !pending) throw new NoPendingOwnerError();
      const token = deps.mailPendingHandOver ? tokenOf() : null;
      const reissued = await settleOwner(
        tenantId,
        (tenant, at) => tenantWithPendingOwnerLink(tenant, PendingOwnerLink.Reissued, token === null ? null : hashHandOverToken(token), at),
        { action: OwnerContactAudit.HandOverLinkResent, severity: AuditSeverityCode.Warning },
        actor,
        { toUserId: pending.userId },
      );
      await mailLink(before, reissued, token, actor);
      return (await tenants.findById(tenantId)) ?? reissued;
    },

    async pendingByToken(token) {
      const hash = hashHandOverToken(token);
      const found = (await tenants.list()).find((tenant) => tenant.pendingOwner?.tokenHash === hash);
      if (!found?.pendingOwner || pendingOwnerExpired(found.pendingOwner, deps.now().toISOString())) return null;
      return found;
    },
  };
}
