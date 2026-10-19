import type { PlatformAcceptRestoreResult, PlatformAuditAnchorPort, PlatformHandle } from "@mezan/backend";
import { AuditRestoreRefusal, TenantAnchorRefusal, TenantAnchorState, type TenantAuditAnchorDTO } from "@mezan/contracts";
import { AnchorOutcome, AnchorRefusal, AcceptRestoreRefusal } from "./audit-anchor.js";
import { acceptRestoreForScope, anchorStatusOf } from "./audit-anchor-job.js";
import type { AuditAnchorService } from "./audit-anchor-setup.js";
import { platformActor } from "./provision-tenant.js";
import type { TenantRouter } from "./tenant-router.js";

const STATE_OF: Readonly<Record<AnchorOutcome, TenantAnchorState>> = {
  [AnchorOutcome.Anchored]: TenantAnchorState.Anchoring,
  [AnchorOutcome.Unchanged]: TenantAnchorState.UpToDate,
  [AnchorOutcome.NoChain]: TenantAnchorState.NoChain,
  [AnchorOutcome.Refused]: TenantAnchorState.Refused,
};

const REFUSAL_OF: Readonly<Record<AnchorRefusal, TenantAnchorRefusal>> = {
  [AnchorRefusal.HeadInconsistent]: TenantAnchorRefusal.HeadInconsistent,
  [AnchorRefusal.NewestAnchorForged]: TenantAnchorRefusal.NewestAnchorForged,
  [AnchorRefusal.RolledBack]: TenantAnchorRefusal.RolledBack,
  [AnchorRefusal.Rewritten]: TenantAnchorRefusal.Rewritten,
};

const ACCEPT_REFUSAL_OF: Readonly<Record<AcceptRestoreRefusal, AuditRestoreRefusal>> = {
  [AcceptRestoreRefusal.ReasonTooShort]: AuditRestoreRefusal.ReasonTooShort,
  [AcceptRestoreRefusal.NoChain]: AuditRestoreRefusal.NoChain,
  [AcceptRestoreRefusal.NothingAnchored]: AuditRestoreRefusal.NothingAnchored,
  [AcceptRestoreRefusal.NothingToAccept]: AuditRestoreRefusal.NothingToAccept,
  [AcceptRestoreRefusal.HeadInconsistent]: AuditRestoreRefusal.HeadInconsistent,
  [AcceptRestoreRefusal.NewestAnchorForged]: AuditRestoreRefusal.NewestAnchorForged,
  [AcceptRestoreRefusal.ChainBroken]: AuditRestoreRefusal.ChainBroken,
};

const ACCEPTABLE: ReadonlySet<AnchorRefusal> = new Set([AnchorRefusal.RolledBack, AnchorRefusal.Rewritten]);

export interface TenantAuditAnchorPortDeps {
  readonly platform: PlatformHandle;
  readonly router: Pick<TenantRouter, "backendOf">;
  readonly anchors: Pick<AuditAnchorService, "signer" | "sink">;
  readonly now: () => Date;
}

// REQUIRED ORDERING: the anchor store is a network call; it runs outside the platform connection's turn.
export function tenantAuditAnchorPort(deps: TenantAuditAnchorPortDeps): PlatformAuditAnchorPort {
  return {
    async status(tenant): Promise<TenantAuditAnchorDTO> {
      const backend = await deps.router.backendOf(tenant.id);
      const status = await deps.platform.outsideTheTurn(() => anchorStatusOf(tenant.id, backend.audit, deps.anchors));
      return {
        state: STATE_OF[status.outcome],
        refusal: status.refusal ? REFUSAL_OF[status.refusal] : null,
        latestAnchoredSeq: status.latestAnchoredSeq,
        latestAnchoredAt: status.latestAnchoredAt,
        liveHeadSeq: status.liveHeadSeq,
        lastRebase: status.lastRebase,
        canAcceptRestore: status.refusal !== null && ACCEPTABLE.has(status.refusal),
      };
    },
    async acceptRestore({ tenant, reason, actorId }): Promise<PlatformAcceptRestoreResult> {
      const backend = await deps.router.backendOf(tenant.id);
      const result = await deps.platform.outsideTheTurn(() =>
        acceptRestoreForScope(tenant.id, backend.audit, { ...deps.anchors, now: deps.now, reason, acceptedBy: platformActor(actorId) }),
      );
      if (!result.accepted) return { accepted: false, refusal: ACCEPT_REFUSAL_OF[result.refusal], reason: result.reason };
      return {
        accepted: true,
        result: {
          seq: result.anchor.anchor.seq,
          headHash: result.anchor.anchor.headHash,
          supersededSeq: result.superseded.seq,
          supersededHeadHash: result.superseded.headHash,
          anchoredAt: result.anchor.anchor.anchoredAt,
        },
      };
    },
  };
}
