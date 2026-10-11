import type { BackendHandle, PlatformHandle, SignedInUser } from "@mezan/backend";
import type { UserEmailChange } from "@mezan/api";
import {
  normalizeEmail,
  OwnerContactProof,
  recordSecurityEvent,
  tenantHandedTo,
  tenantWithOwnerContact,
  type AuditSeverity,
  type Tenant,
  type TenantOwnerAccount,
} from "@mezan/domain";

export enum OwnerContactAudit {
  Linked = "TENANT_OWNER_LINKED",
  EmailChanged = "TENANT_OWNER_EMAIL_CHANGED",
  Unverified = "TENANT_OWNER_CONTACT_UNVERIFIED",
  Verified = "TENANT_OWNER_CONTACT_VERIFIED",
  HandedOver = "TENANT_OWNER_HANDED_OVER",
}

export const RECONCILE_ACTOR = "platform:owner-reconcile";

export function tenantActor(code: string, userId: string): string {
  return `tenant:${code}:${userId}`;
}

export interface OwnerHandOver {
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly toEmail: string;
  readonly actorId: string;
}

export interface OwnerContact {
  // SECURITY: never moves the recorded address. Only the owner's own act does.
  reconcile(code: string, backend: Pick<BackendHandle, "ownerAccount">): Promise<void>;
  emailChanged(code: string, change: UserEmailChange): Promise<void>;
  signedIn(code: string, user: SignedInUser): Promise<void>;
  handOver(code: string, input: OwnerHandOver): Promise<void>;
}

interface Change {
  readonly action: OwnerContactAudit;
  readonly severity: AuditSeverity;
}

function changeOf(before: Tenant, after: Tenant): Change {
  if (after.ownerEmail !== before.ownerEmail) return { action: OwnerContactAudit.EmailChanged, severity: "CRITICAL" };
  if (after.ownerContactVerified !== before.ownerContactVerified) {
    return after.ownerContactVerified
      ? { action: OwnerContactAudit.Verified, severity: "INFO" }
      : { action: OwnerContactAudit.Unverified, severity: "WARNING" };
  }
  return { action: OwnerContactAudit.Linked, severity: "INFO" };
}

const WRITE_ATTEMPTS = 2;

export function createOwnerContact(deps: { readonly platform: PlatformHandle; readonly now: () => Date }): OwnerContact {
  const { tenants, signupRequests } = deps.platform.stores;

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

  async function settle(code: string, actor: string, next: (tenant: Tenant, at: string) => Promise<Tenant | null> | Tenant | null): Promise<void> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const tenant = await tenants.findByCode(code);
      if (!tenant) return;
      const after = await next(tenant, deps.now().toISOString());
      if (!after) return;
      if (await write(tenant, after, changeOf(tenant, after), actor, {})) return;
    }
  }

  function ownerOf(tenant: Tenant, candidate: TenantOwnerAccount, emailBefore: string): boolean {
    if (tenant.ownerUserId !== null) return tenant.ownerUserId === candidate.id;
    return tenant.ownerEmail === normalizeEmail(emailBefore);
  }

  return {
    async reconcile(code, backend) {
      await settle(code, RECONCILE_ACTOR, async (tenant, at) => {
        const account = await backend.ownerAccount(tenant.ownerUserId === null ? { email: tenant.ownerEmail } : { userId: tenant.ownerUserId });
        if (!account || (tenant.ownerUserId === null && !account.canAdminister)) return null;
        return tenantWithOwnerContact(tenant, account, OwnerContactProof.Unproven, at);
      });
    },

    async emailChanged(code, change) {
      const owner = { id: change.userId, email: change.after };
      const proof = change.userId === change.actorId ? OwnerContactProof.OwnerActed : OwnerContactProof.Unproven;
      await settle(code, tenantActor(code, change.actorId), (tenant, at) =>
        ownerOf(tenant, owner, change.before) ? tenantWithOwnerContact(tenant, owner, proof, at) : null,
      );
    },

    async signedIn(code, user) {
      const owner = { id: user.userId, email: user.email };
      await settle(code, tenantActor(code, user.userId), (tenant, at) =>
        ownerOf(tenant, owner, user.email) ? tenantWithOwnerContact(tenant, owner, OwnerContactProof.OwnerActed, at) : null,
      );
    },

    async handOver(code, input) {
      const tenant = await tenants.findByCode(code);
      if (!tenant) throw new Error("TENANT_NOT_FOUND");
      const after = tenantHandedTo(tenant, { id: input.toUserId, email: input.toEmail }, input.actorId === input.toUserId, deps.now().toISOString());
      const moved = await write(tenant, after, { action: OwnerContactAudit.HandedOver, severity: "CRITICAL" }, tenantActor(code, input.actorId), {
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
      });
      if (!moved) throw new Error("the tenant's owner changed while it was being handed over");
    },
  };
}
