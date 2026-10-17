import type { PlatformHandle } from "@mezan/backend";
import { isAuditChainAnchorSource, type AuditChainAnchorSource } from "@mezan/persistence";
import type { AuditSink } from "@mezan/domain";
import {
  anchorHead,
  AnchorOutcome,
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

export function defaultAnchorLog(record: AnchorLogRecord): void {
  const line = JSON.stringify({ at: new Date().toISOString(), service: "mezan-cloud", ...record });
  if (record.event === AnchorLogEvent.Anchored || record.event === AnchorLogEvent.Unchanged) console.log(line);
  else console.error(line);
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
  const [latest = null] = (await options.sink.list(scope, 1)).slice(-1);
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

export async function runAuditAnchorSweep(options: AuditAnchorJobOptions): Promise<AuditAnchorSweepResult> {
  const log = options.log ?? defaultAnchorLog;
  const counts = { anchored: 0, unchanged: 0, refused: 0, failed: 0 };

  const scopes: { scope: string; audit: () => Promise<AuditSink> }[] = [
    { scope: PLATFORM_ANCHOR_SCOPE, audit: async () => options.platform.audit },
    ...options.router.openTenants().map((open) => ({ scope: open.id, audit: async () => (await options.router.backendOf(open.id)).audit })),
  ];

  for (const { scope, audit } of scopes) {
    try {
      const result = await anchorOneScope(scope, await audit(), options);
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

export function startAuditAnchorTimer(options: AuditAnchorJobOptions & { readonly intervalMs: number }): AuditAnchorTimer {
  const log = options.log ?? defaultAnchorLog;
  let current: Promise<AuditAnchorSweepResult | null> = Promise.resolve(null);
  const run = (): Promise<AuditAnchorSweepResult | null> => {
    current = runAuditAnchorSweep(options).catch((err: unknown) => {
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
