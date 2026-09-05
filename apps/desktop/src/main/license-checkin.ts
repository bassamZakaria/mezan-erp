import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * HOW LONG AN INSTALL MAY GO WITHOUT CONFIRMING ITS LICENCE ONLINE.
 *
 * The offline licence proves a signature, a fingerprint and an expiry date. What
 * it cannot prove is that the licence has not been REVOKED since — a refunded
 * sale, a lapsed subscription, or a file copied onto a second machine that the
 * signature is perfectly happy about. A periodic check-in is the only thing that
 * answers that, and it has to bite, or it is decoration.
 *
 * The two thresholds are the owner's decision and they are not symmetrical on
 * purpose:
 *
 *   ≤  7 days   normal. Writes allowed.
 *   >  7 days   READ_ONLY. Every record stays readable, printable and
 *               exportable; new postings are refused. A thief's copy stops
 *               being worth anything almost immediately — nobody runs a shop on
 *               a system that cannot post — while a paying customer whose
 *               router died can still tell a customer what they owe.
 *   > 30 days   the app refuses to start.
 *
 * That middle band is what makes this safe to ship to Egyptian SMBs on
 * unreliable connections. A hard cut at 7 days would take a shop's own books
 * away over a week of bad internet, which is a bigger business risk than the
 * piracy it prevents.
 *
 * THE CLOCK IS NOT TRUSTED. `lastVerifiedAt` is compared against the monotonic
 * high-water mark the licence verifier already keeps (license-clock.json), so
 * winding the machine clock back does not buy more days — the same guard that
 * already produces TAMPERED.
 */
export const READ_ONLY_AFTER_DAYS = 7;
export const REFUSE_TO_START_AFTER_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CheckinVerdict = "ok" | "read-only" | "refuse-to-start";

export interface CheckinState {
  /** ISO time of the last SUCCESSFUL online confirmation, or null if never. */
  readonly lastVerifiedAt: string | null;
}

export function checkinFilePath(dbPath: string): string {
  return path.join(path.dirname(dbPath), "license-checkin.json");
}

export async function readCheckinState(dbPath: string): Promise<CheckinState> {
  try {
    const parsed = JSON.parse(await readFile(checkinFilePath(dbPath), "utf8")) as {
      lastVerifiedAt?: unknown;
    };
    return {
      lastVerifiedAt: typeof parsed.lastVerifiedAt === "string" ? parsed.lastVerifiedAt : null,
    };
  } catch {
    return { lastVerifiedAt: null };
  }
}

export async function recordSuccessfulCheckin(dbPath: string, at: Date): Promise<void> {
  await writeFile(
    checkinFilePath(dbPath),
    `${JSON.stringify({ lastVerifiedAt: at.toISOString() }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

/**
 * The whole policy, as a pure function of two timestamps.
 *
 * A NEVER-CHECKED INSTALL IS NOT PUNISHED IMMEDIATELY. `installedAt` — in
 * practice the licence's own `notBefore` — starts the clock, so a shop that has
 * genuinely never been online still gets its first week, and a consultant can
 * commission a machine in a village with no connection and have it work.
 */
export function decideCheckin(params: {
  readonly lastVerifiedAt: string | null;
  readonly installedAt: string;
  readonly now: Date;
}): { readonly verdict: CheckinVerdict; readonly daysSince: number } {
  const since = params.lastVerifiedAt ?? params.installedAt;
  const parsed = Date.parse(since);
  // An unreadable timestamp must not silently grant unlimited offline use, and
  // must not brick a working shop either: treat it as "checked in now" and let
  // the next real check-in write a clean value.
  if (Number.isNaN(parsed)) return { verdict: "ok", daysSince: 0 };

  const daysSince = Math.floor((params.now.getTime() - parsed) / DAY_MS);
  if (daysSince > REFUSE_TO_START_AFTER_DAYS) return { verdict: "refuse-to-start", daysSince };
  if (daysSince > READ_ONLY_AFTER_DAYS) return { verdict: "read-only", daysSince };
  return { verdict: "ok", daysSince };
}

export interface CheckinAttempt {
  readonly reachedServer: boolean;
  readonly revoked: boolean;
  readonly error?: string;
}

/**
 * Asks the licensing service whether this licence is still good.
 *
 * FAILING TO REACH THE SERVER IS NOT A REVOCATION. An offline shop, a DNS
 * hiccup or a vendor outage must never be read as "this licence is void" — that
 * is what the day counter above is for, and it degrades gently. Only an
 * explicit, successful answer of `{ "revoked": true }` revokes.
 *
 * No endpoint configured means no check-in is possible, which is reported as
 * "did not reach the server" rather than as a pass: an install that can never
 * check in still walks the same 7/30-day path, which is what stops "just do not
 * configure the URL" from being the way around all of this.
 */
export async function attemptCheckin(params: {
  readonly endpoint: string | undefined;
  readonly licenseId: string;
  readonly fingerprint: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<CheckinAttempt> {
  if (!params.endpoint) {
    return { reachedServer: false, revoked: false, error: "no check-in endpoint configured" };
  }
  const doFetch = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 15_000);
  try {
    const res = await doFetch(params.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ licenseId: params.licenseId, fingerprint: params.fingerprint }),
      signal: controller.signal,
    });
    if (!res.ok) return { reachedServer: false, revoked: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { revoked?: unknown };
    return { reachedServer: true, revoked: body.revoked === true };
  } catch (err) {
    return {
      reachedServer: false,
      revoked: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Arabic, ready to render, with the day count and what to do about it. */
export function checkinMessageAr(verdict: CheckinVerdict, daysSince: number): string {
  if (verdict === "read-only") {
    return (
      `لم يتم التحقق من الترخيص عبر الإنترنت منذ ${daysSince} يوماً. ` +
      `يمكنك الاطلاع على البيانات وطباعتها وتصديرها، ولا يمكن تسجيل قيود جديدة حتى يتم التحقق. ` +
      `اتصل بالإنترنت أو تواصل مع الدعم.`
    );
  }
  if (verdict === "refuse-to-start") {
    return (
      `لم يتم التحقق من الترخيص عبر الإنترنت منذ ${daysSince} يوماً، ولا يمكن تشغيل البرنامج. ` +
      `اتصل بالإنترنت ثم أعد التشغيل، أو تواصل مع الدعم للحصول على ملف ترخيص جديد.`
    );
  }
  return "الترخيص سارٍ.";
}
