import type {
  Notification,
  NotificationChannel,
  NotificationChannelStatus,
  NotificationRepository,
} from "./types.js";

/**
 * Drains the outbound notification queue (ROADMAP §3.3).
 *
 * The rules engine delivers in-app by writing a row; every other channel was
 * stamped `"queued"` and nothing ever drained it, so a tenant who ticked
 * «بريد إلكتروني» on a rule got silence and no way to tell that from a rule
 * that had not matched.
 *
 * **The decision this encodes, because it is the whole of the problem.** This
 * product is offline by default — a shop with no internet is the normal case,
 * not the failure case. So being offline is NOT a delivery failure: the mail
 * stays queued and is retried, unchanged, for as long as the message is still
 * worth sending. Only two things end an attempt permanently:
 *
 * - the server REJECTED it (a bad address, refused auth) — retrying cannot fix
 *   an address that does not exist, and hammering a refused login gets the
 *   tenant's account locked;
 * - the message went stale. A "فاتورة جديدة" notice three weeks late is noise,
 *   and sending a month of backlog the moment a shop reconnects is worse than
 *   sending nothing. {@link DispatchPolicy.maxAgeHours} is where that line is.
 *
 * Nothing here is automatic on a timer: `drain` is called by an operator action
 * or by whatever schedules the desktop's other periodic jobs. A background
 * sender that fires while nobody is watching is how a shop discovers it has
 * been emailing its customers for a week.
 */

/** What happened to one message on one channel. */
export type DispatchOutcome =
  /** Accepted by the server. Terminal. */
  | { readonly kind: "sent" }
  /** No connection. NOT a failure — stays queued, retried next drain. */
  | { readonly kind: "offline"; readonly reason: string }
  /** The server refused it. Terminal: retrying cannot fix it. */
  | { readonly kind: "rejected"; readonly reason: string };

/**
 * Sends one notification over one channel. Implemented by the composition root
 * (SMTP for email); a channel with no transport is skipped, not failed.
 */
export interface NotificationTransport {
  readonly channel: NotificationChannel;
  send(notification: Notification, recipientEmail: string | null): Promise<DispatchOutcome>;
}

export interface DispatchPolicy {
  /**
   * How long a queued message stays worth sending. Past this it is abandoned
   * with a reason rather than delivered late — see the module doc-comment.
   */
  readonly maxAgeHours: number;
  /** Messages to attempt in one drain, so a month offline does not become one enormous send. */
  readonly batchSize: number;
}

export const DEFAULT_DISPATCH_POLICY: DispatchPolicy = {
  // Three days. Long enough to cover a weekend plus a public holiday, short
  // enough that nothing arrives describing a week-old event.
  maxAgeHours: 72,
  batchSize: 50,
};

export interface NotificationDispatcherDeps {
  readonly notifications: NotificationRepository & {
    /** Every notification with at least one channel still `"queued"`. */
    listQueued(limit: number): Promise<readonly Notification[]>;
  };
  readonly transports: readonly NotificationTransport[];
  /** The recipient's address, or null when the user has none on file. */
  readonly recipientEmail: (userId: string) => Promise<string | null>;
  readonly now?: () => string;
  readonly policy?: DispatchPolicy;
}

export interface DrainResult {
  readonly attempted: number;
  readonly sent: number;
  /** Left queued: no connection, and the message is still young enough to matter. */
  readonly stillQueued: number;
  /** Terminal — rejected by the server, or abandoned as stale. */
  readonly failed: number;
  /** No transport is wired for the channel, so it was never attempted. */
  readonly skipped: number;
}

function hoursBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / 3_600_000;
}

export class NotificationDispatcher {
  constructor(private readonly deps: NotificationDispatcherDeps) {}

  async drain(): Promise<DrainResult> {
    const policy = this.deps.policy ?? DEFAULT_DISPATCH_POLICY;
    const now = this.deps.now?.() ?? new Date().toISOString();
    const queued = await this.deps.notifications.listQueued(policy.batchSize);

    let attempted = 0;
    let sent = 0;
    let stillQueued = 0;
    let failed = 0;
    let skipped = 0;

    for (const notification of queued) {
      const next: Record<string, NotificationChannelStatus> = { ...notification.channelStatus };
      let changed = false;

      for (const [channel, status] of Object.entries(notification.channelStatus)) {
        if (status !== "queued") continue;

        if (hoursBetween(notification.createdAt, now) > policy.maxAgeHours) {
          next[channel] = "failed";
          failed += 1;
          changed = true;
          continue;
        }

        const transport = this.deps.transports.find((t) => t.channel === channel);
        if (!transport) {
          skipped += 1;
          continue;
        }

        attempted += 1;
        const outcome = await transport.send(
          notification,
          await this.deps.recipientEmail(notification.recipientUserId),
        );
        if (outcome.kind === "sent") {
          next[channel] = "sent";
          sent += 1;
          changed = true;
        } else if (outcome.kind === "rejected") {
          next[channel] = "failed";
          failed += 1;
          changed = true;
        } else {
          // Offline. Deliberately leaves the status alone so the next drain
          // picks it up unchanged.
          stillQueued += 1;
        }
      }

      if (changed) {
        await this.deps.notifications.save({ ...notification, channelStatus: next });
      }
    }

    return { attempted, sent, stillQueued, failed, skipped };
  }
}
