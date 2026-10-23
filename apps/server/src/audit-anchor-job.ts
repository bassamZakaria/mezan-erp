import { isClosedConnectionError } from "./backend-cache.js";
import { createLogger, type JobTracker } from "@mezan/api";
import type { PlatformHandle } from "@mezan/backend";
import { isAuditChainAnchorSource, type AuditChainAnchorSource, type AuditChainVerification } from "@mezan/persistence";
import type { AuditSink } from "@mezan/domain";
import {
  acceptRestore,
  AcceptRestoreRefusal,
  anchorHead,
  AnchorOutcome,
  judgeHead,
  type AcceptRestoreResult,
  type AnchorRefusal,
  PLATFORM_ANCHOR_SCOPE,
  type AuditAnchorSigner,
  type AuditAnchorSink,
  type SignedAuditAnchor,
} from "./audit-anchor.js";
import type { TenantRouter } from "./tenant-router.js";

export enum AnchorLogEvent {
  Anchored = "audit_anchor.anchored",
  Unchanged = "audit_anchor.unchanged",
  Refused = "audit_anchor.refused_possible_tampering",
  Failed = "audit_anchor.failed",
  SweepFailed = "audit_anchor.sweep_failed",
  SkippedClosed = "audit_anchor.skipped_closed",
}

export interface AnchorLogRecord {
  readonly event: AnchorLogEvent;
  readonly scope?: string;
  readonly seq?: number;
  readonly reason?: string;
}

export interface AuditAnchorSweepResult {
  readonly anchored: number;
  readonly unchanged: number;
  readonly refused: number;
  readonly failed: number;
}

export interface AuditAnchorJobOptions {
  readonly platform: PlatformHandle;
  readonly router: TenantRouter;
  readonly signer: AuditAnchorSigner;
  readonly sink: AuditAnchorSink;
  readonly now?: () => Date;
  readonly log?: (record: AnchorLogRecord) => void;
}

interface LiveSnapshot {
  readonly head: { readonly rowId: number; readonly rowHash: string } | null;
  readonly hashes: ReadonlyMap<number, string | null>;
}

const anchorLog = createLogger("audit-anchor");

export function defaultAnchorLog(record: AnchorLogRecord): void {
  if (record.event === AnchorLogEvent.Anchored || record.event === AnchorLogEvent.Unchanged) anchorLog.info(record, record.event);
  else anchorLog.error(record, record.event);
}

async function snapshotOf(audit: AuditSink, extraRow: number | null): Promise<LiveSnapshot | null> {
  if (!isAuditChainAnchorSource(audit) || audit.turn === undefined) return null;
  const source: AuditChainAnchorSource = audit;
  return audit.turn(async () => {
    const head = source.chainHead();
    const hashes = new Map<number, string | null>();
    if (head) hashes.set(head.rowId, source.chainRowHash(head.rowId));
    if (extraRow !== null) hashes.set(extraRow, source.chainRowHash(extraRow));
    return { head, hashes };
  });
}

/**
 * Anchors one chain. The live read happens inside the sink's turn, on the
 * connection the requests share, so it can never see another request's
 * uncommitted row; the network write happens outside it.
 */
export async function anchorOneScope(
  scope: string,
  audit: AuditSink,
  options: Pick<AuditAnchorJobOptions, "signer" | "sink" | "now">,
): Promise<{ outcome: AnchorOutcome; reason?: string; anchor?: SignedAuditAnchor }> {
  const latest = await options.sink.latest(scope);
  const snapshot = await snapshotOf(audit, latest?.anchor.seq ?? null);
  if (snapshot === null) return { outcome: AnchorOutcome.Refused, reason: "the audit sink cannot report its chain head" };
  return anchorHead({
    scope,
    head: snapshot.head,
    rowHashAt: (rowId) => snapshot.hashes.get(rowId) ?? null,
    signer: options.signer,
    latest,
    sink: options.sink,
    now: options.now ?? (() => new Date()),
  });
}

export interface AnchorScopeStatus {
  readonly outcome: AnchorOutcome;
  readonly refusal: AnchorRefusal | null;
  readonly reason: string | null;
  readonly latestAnchoredSeq: number | null;
  readonly latestAnchoredAt: string | null;
  readonly liveHeadSeq: number | null;
  readonly lastRebase: { readonly anchoredAt: string; readonly acceptedBy: string; readonly reason: string; readonly supersededSeq: number } | null;
}

/** What the next sweep would do for this scope. CONTRACT: reads only — it never signs or appends. */
export async function anchorStatusOf(scope: string, audit: AuditSink, options: Pick<AuditAnchorJobOptions, "signer" | "sink">): Promise<AnchorScopeStatus> {
  const latest = await options.sink.latest(scope);
  const snapshot = await snapshotOf(audit, latest?.anchor.seq ?? null);
  const judged: { outcome: AnchorOutcome; refusal?: AnchorRefusal; reason?: string } = snapshot
    ? judgeHead({ head: snapshot.head, rowHashAt: (rowId) => snapshot.hashes.get(rowId) ?? null, signer: options.signer, latest })
    : { outcome: AnchorOutcome.Refused, reason: "the audit sink cannot report its chain head" };
  const rebase = latest?.anchor.rebase;
  return {
    outcome: judged.outcome,
    refusal: judged.refusal ?? null,
    reason: judged.reason ?? null,
    latestAnchoredSeq: latest?.anchor.seq ?? null,
    latestAnchoredAt: latest?.anchor.anchoredAt ?? null,
    liveHeadSeq: snapshot?.head?.rowId ?? null,
    lastRebase: rebase ? { anchoredAt: latest.anchor.anchoredAt, acceptedBy: rebase.acceptedBy, reason: rebase.reason, supersededSeq: rebase.supersededSeq } : null,
  };
}

function chainVerifierOf(audit: AuditSink): (() => Promise<AuditChainVerification>) | undefined {
  const verifyChain = (audit as { verifyChain?: () => Promise<AuditChainVerification> }).verifyChain;
  return typeof verifyChain === "function" ? () => verifyChain.call(audit) : undefined;
}

export async function acceptRestoreForScope(
  scope: string,
  audit: AuditSink,
  options: Pick<AuditAnchorJobOptions, "signer" | "sink" | "now"> & { readonly reason: string; readonly acceptedBy: string },
): Promise<AcceptRestoreResult> {
  const latest = await options.sink.latest(scope);
  const snapshot = await snapshotOf(audit, latest?.anchor.seq ?? null);
  if (snapshot === null) return { accepted: false, refusal: AcceptRestoreRefusal.NoChain, reason: "the audit sink cannot report its chain head" };
  const verifyChain = chainVerifierOf(audit);
  return acceptRestore({
    scope,
    head: snapshot.head,
    rowHashAt: (rowId) => snapshot.hashes.get(rowId) ?? null,
    signer: options.signer,
    latest,
    sink: options.sink,
    now: options.now ?? (() => new Date()),
    reason: options.reason,
    acceptedBy: options.acceptedBy,
    ...(verifyChain ? { verifyChain } : {}),
  });
}

export async function runAuditAnchorSweep(options: AuditAnchorJobOptions): Promise<AuditAnchorSweepResult> {
  const log = options.log ?? defaultAnchorLog;
  const counts = { anchored: 0, unchanged: 0, refused: 0, failed: 0 };

  const scopes: { scope: string; audit: () => Promise<AuditSink | null> }[] = [
    { scope: PLATFORM_ANCHOR_SCOPE, audit: async () => options.platform.audit },
    ...options.router.openTenants().map((open) => ({ scope: open.id, audit: async () => (await options.router.openBackendOf(open.id))?.audit ?? null })),
  ];

  for (const { scope, audit } of scopes) {
    try {
      const sink = await audit();
      if (!sink) continue;
      const result = await anchorOneScope(scope, sink, options);
      if (result.outcome === AnchorOutcome.Anchored) {
        counts.anchored += 1;
        log({ event: AnchorLogEvent.Anchored, scope, seq: result.anchor?.anchor.seq });
      } else if (result.outcome === AnchorOutcome.Unchanged) {
        counts.unchanged += 1;
        log({ event: AnchorLogEvent.Unchanged, scope });
      } else if (result.outcome === AnchorOutcome.Refused) {
        counts.refused += 1;
        log({ event: AnchorLogEvent.Refused, scope, reason: result.reason });
      }
    } catch (err) {
      if (scope !== PLATFORM_ANCHOR_SCOPE && isClosedConnectionError(err)) {
        log({ event: AnchorLogEvent.SkippedClosed, scope });
        continue;
      }
      counts.failed += 1;
      log({ event: AnchorLogEvent.Failed, scope, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return counts;
}

export interface AuditAnchorTimer {
  stop(): Promise<void>;
  runNow(): Promise<AuditAnchorSweepResult | null>;
}

export function startAuditAnchorTimer(options: AuditAnchorJobOptions & { readonly intervalMs: number; readonly job?: JobTracker }): AuditAnchorTimer {
  const log = options.log ?? defaultAnchorLog;
  let current: Promise<AuditAnchorSweepResult | null> = Promise.resolve(null);
  const run = (): Promise<AuditAnchorSweepResult | null> => {
    const sweep = () => runAuditAnchorSweep(options);
    current = (options.job ? options.job.run(sweep, (result) => result.anchored) : sweep()).catch((err: unknown) => {
      log({ event: AnchorLogEvent.SweepFailed, reason: err instanceof Error ? err.message : String(err) });
      return null;
    });
    return current;
  };
  void run();
  const timer = setInterval(() => void run(), options.intervalMs);
  timer.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      await current;
    },
    runNow: run,
  };
}
