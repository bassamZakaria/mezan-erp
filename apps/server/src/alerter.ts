import { LogEvent, createLogger, errorIdentity, onErrorLogged } from "@mezan/api";
import { MailOutcome, type PlatformMailer } from "./platform-mail.js";

export enum AlertKind {
  ErrorBurst = "error_burst",
  JobFailed = "job_failed",
  UncleanRestart = "unclean_restart",
  NotReady = "not_ready",
  UnhandledRejection = "unhandled_rejection",
  AuditAnchorDisabled = "audit_anchor_disabled",
}

export const ALERT_DEDUP_WINDOW_MS = 30 * 60_000;
export const ERROR_BURST_WINDOW_MS = 5 * 60_000;
export const ERROR_BURST_THRESHOLD = 20;

export interface AlertFacts {
  readonly kind: AlertKind;
  readonly key?: string;
  readonly summary: string;
  readonly facts?: Readonly<Record<string, string | number | null>>;
}

export interface AlertState {
  readonly key: string;
  readonly kind: AlertKind;
  readonly lastSentAt: string | null;
  readonly lastRaisedAt: string;
  readonly suppressed: number;
}

export interface Alerter {
  raise(alert: AlertFacts): void;
  recent(): readonly AlertState[];
  readonly configured: boolean;
  close(): void;
}

export interface AlerterOptions {
  readonly mailer?: PlatformMailer;
  readonly to?: string;
  readonly host?: string;
  readonly now?: () => Date;
  readonly burstThreshold?: number;
}

interface KeyState {
  kind: AlertKind;
  lastSentAt: number | null;
  lastRaisedAt: number;
  suppressed: number;
}

const log = createLogger("alerts");

function mailBody(alert: AlertFacts, at: Date, host: string, suppressed: number): string {
  const lines = [
    `Mezan alert: ${alert.kind}`,
    `When: ${at.toISOString()}`,
    `Host: ${host}`,
    "",
    alert.summary,
  ];
  for (const [name, value] of Object.entries(alert.facts ?? {})) lines.push(`${name}: ${value ?? "-"}`);
  if (suppressed > 0) lines.push("", `The same alert was raised ${suppressed} more time(s) since the last mail and was held back.`);
  lines.push("", "Read the server log for the full context: docker logs <container> | grep <requestId or event>.");
  return lines.join("\n");
}

/**
 * Mails `to` about what an operator must look at, from the process itself — no external
 * monitoring needed. SECURITY: an alert carries only the facts its caller passes (event names,
 * ids, counts); it never forwards a log line, an error message or a request body, any of which
 * can hold personal data.
 *
 * INVARIANT: the alerter logs its own failures at WARN, never ERROR. An error-level line feeds
 * the burst counter, and a failing mail server would then raise an alert about itself forever.
 */
export function createAlerter(options: AlerterOptions): Alerter {
  const now = options.now ?? (() => new Date());
  const host = options.host ?? process.env["HOSTNAME"] ?? "mezan-cloud";
  const states = new Map<string, KeyState>();
  const configured = Boolean(options.mailer && options.to);
  const burstThreshold = options.burstThreshold ?? ERROR_BURST_THRESHOLD;
  let errorTimes: number[] = [];

  const send = (alert: AlertFacts, suppressed: number): void => {
    const mailer = options.mailer;
    const to = options.to;
    if (!mailer || !to) {
      log.warn({ event: LogEvent.AlertUnsent, alert: alert.kind, reason: "MEZAN_ALERT_EMAIL or platform SMTP is not configured" }, alert.summary);
      return;
    }
    const at = now();
    void mailer
      .send(to, { subject: `[Mezan] ${alert.kind}: ${alert.summary}`.slice(0, 180), body: mailBody(alert, at, host, suppressed) })
      .then((result) => {
        if (result.outcome === MailOutcome.Sent) log.info({ event: LogEvent.AlertSent, alert: alert.kind, suppressed }, "alert mailed");
        else log.warn({ event: LogEvent.AlertUnsent, alert: alert.kind, outcome: result.outcome }, "alert mail was not delivered");
      })
      .catch((err: unknown) => log.warn({ event: LogEvent.AlertUnsent, alert: alert.kind, ...errorIdentity(err) }, "alert mail failed"));
  };

  const raise = (alert: AlertFacts): void => {
    const key = `${alert.kind}:${alert.key ?? ""}`;
    const at = now().getTime();
    const state = states.get(key) ?? { kind: alert.kind, lastSentAt: null, lastRaisedAt: at, suppressed: 0 };
    state.lastRaisedAt = at;
    states.set(key, state);
    if (state.lastSentAt !== null && at - state.lastSentAt < ALERT_DEDUP_WINDOW_MS) {
      state.suppressed += 1;
      return;
    }
    const suppressed = state.suppressed;
    state.lastSentAt = at;
    state.suppressed = 0;
    send(alert, suppressed);
  };

  const stopWatching = onErrorLogged((entry) => {
    const at = now().getTime();
    errorTimes = errorTimes.filter((time) => at - time < ERROR_BURST_WINDOW_MS);
    errorTimes.push(at);
    if (errorTimes.length < burstThreshold) return;
    const count = errorTimes.length;
    errorTimes = [];
    raise({
      kind: AlertKind.ErrorBurst,
      summary: `${count} error-level log lines within ${ERROR_BURST_WINDOW_MS / 60_000} minutes`,
      facts: { lastEvent: entry.event, lastComponent: entry.component },
    });
  });

  return {
    raise,
    configured,
    recent: () =>
      [...states].map(([key, state]) => ({
        key,
        kind: state.kind,
        lastSentAt: state.lastSentAt === null ? null : new Date(state.lastSentAt).toISOString(),
        lastRaisedAt: new Date(state.lastRaisedAt).toISOString(),
        suppressed: state.suppressed,
      })),
    close: stopWatching,
  };
}
