import { createHmac, randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { verifyCheckinResponse, type CheckinClaim } from "@mezan/domain";

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
 *   > 30 days   still READ_ONLY, and the shell puts a blocking notice over the
 *               window. THE APP STILL OPENS. It used to `app.exit(1)` before a
 *               window existed, which meant a shop 31 days past a network fault
 *               double-clicked the icon and nothing happened at all: no dialog,
 *               no log, and their books inside a file the app refused to open.
 *               A licensing lapse never withholds data — that is the whole
 *               ethic of this module, and exiting was the one place it was
 *               broken.
 *
 * That middle band is what makes this safe to ship to Egyptian SMBs on
 * unreliable connections. A hard cut at 7 days would take a shop's own books
 * away over a week of bad internet, which is a bigger business risk than the
 * piracy it prevents.
 *
 * THE CLOCK IS NOT TRUSTED, AND NEITHER IS THE FILE. `lastVerifiedAt`, the
 * monotonic high-water mark and the install stamp live in ONE record that is
 * MAC'd with a key derived from the sealed database key (see
 * `createLicenseGuardStore`), and `lastVerifiedAt` is cross-checked against that
 * high-water mark — the check the old comment here claimed and no code
 * performed. An edited or unsigned record resolves to TAMPERED. A deleted one
 * reads as never checked in, and the clock then starts at the licence's own
 * signed `notBefore` — never at today.
 */
export const READ_ONLY_AFTER_DAYS = 7;
export const BLOCKING_NOTICE_AFTER_DAYS = 30;

/** @deprecated Kept as the documented name of the 30-day threshold; nothing exits. */
export const REFUSE_TO_START_AFTER_DAYS = BLOCKING_NOTICE_AFTER_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Benign jitter between a server's clock and the local high-water mark. */
const CLOCK_SKEW_TOLERANCE_MS = 10 * 60 * 1000;

export type CheckinVerdict = "ok" | "read-only" | "blocked" | "revoked" | "tampered";

// ---------------------------------------------------------------------------
// The tamper-evident guard record (L-10).
// ---------------------------------------------------------------------------

export interface LicenseGuardRecord {
  /** Greatest wall-clock value ever observed, epoch ms. Rollback detection. */
  readonly highWater: number | null;
  /** ISO time of the last VERIFIED online confirmation, or null if never. */
  readonly lastVerifiedAt: string | null;
  /** ISO. The licence's own `notBefore`, or first-launch when it has none. */
  readonly installedAt: string | null;
  /** Latched by a SIGNED revocation answer; only a signed answer clears it. */
  readonly revoked: boolean;
}

export type GuardIntegrity = "ok" | "missing" | "tampered";

export interface GuardRead {
  readonly record: LicenseGuardRecord;
  readonly integrity: GuardIntegrity;
}

export const EMPTY_GUARD_RECORD: LicenseGuardRecord = {
  highWater: null,
  lastVerifiedAt: null,
  installedAt: null,
  revoked: false,
};

export interface LicenseGuardStore {
  /** Synchronous on purpose: the write gate re-reads this on every request. */
  read(): GuardRead;
  write(record: LicenseGuardRecord): void;
  readonly filePath: string;
}

export function guardFilePath(dir: string): string {
  return path.join(dir, "license-guard.json");
}

export function guardSecretFilePath(dir: string): string {
  return path.join(dir, "license-guard.key");
}

const INSTALL_SECRET_RE = /^[0-9a-f]{64}$/;
const OWNER_ONLY = 0o600;

/**
 * Canonical bytes for the MAC — a fixed key order, so re-serialising the same
 * record on another platform or Node version cannot invalidate it.
 */
function canonical(record: LicenseGuardRecord): string {
  return JSON.stringify([
    record.highWater,
    record.lastVerifiedAt,
    record.installedAt,
    record.revoked,
  ]);
}

function macOf(record: LicenseGuardRecord, macKey: string): string {
  return createHmac("sha256", `mezan.license.guard.v1:${macKey}`)
    .update(canonical(record))
    .digest("hex");
}

/**
 * The guard record's store.
 *
 * `macKey` is the tenant database's sealed encryption key — the one secret on
 * the machine an owner cannot read out of a text file and a thief cannot carry
 * to another PC. Without it the record is exactly what the audit found: a
 * plain JSON file whose deletion reset the anti-piracy clock. With it, editing
 * or deleting the record is DETECTED, and detection is not permissive: a
 * record that carries a MAC we cannot check, or one whose MAC does not match,
 * resolves to TAMPERED.
 *
 * `macKey: null` is the install with no database key
 * (`--allow-unencrypted-database`, `pnpm start`). SECURITY: its record is
 * MAC'd all the same, under a secret this install mints for itself on its
 * first write (`license-guard.key`, owner-readable only). The record used to
 * be written plainly there, and setting `lastVerifiedAt` by hand turned
 * READ_ONLY back into ACTIVE. A record with no MAC, or one whose secret has
 * gone, is TAMPERED. The one exception is a record an earlier build wrote
 * before any secret existed: it is sealed once, and what it claimed about
 * check-ins and the install date is dropped rather than believed, so the clock
 * falls back to the licence's own signed start date.
 */
export function createLicenseGuardStore(params: {
  readonly dir: string;
  readonly macKey: string | null;
  readonly fs?: {
    readFile(p: string): string | null;
    writeFile(p: string, data: string): void;
  };
}): LicenseGuardStore {
  const filePath = guardFilePath(params.dir);
  const io = params.fs ?? {
    readFile: (p: string) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    writeFile: (p: string, data: string) => {
      writeFileSync(p, data, { encoding: "utf8", mode: OWNER_ONLY });
      chmodSync(p, OWNER_ONLY);
    },
  };

  const secretPath = guardSecretFilePath(params.dir);
  const installMacKey = (secret: string): string => `install:${secret}`;
  const readInstallSecret = (): string | null => {
    const held = io.readFile(secretPath)?.trim() ?? null;
    return held !== null && INSTALL_SECRET_RE.test(held) ? held : null;
  };
  const mintInstallSecret = (): string => {
    const minted = randomBytes(32).toString("hex");
    io.writeFile(secretPath, `${minted}\n`);
    return minted;
  };
  const write = (record: LicenseGuardRecord): void => {
    const macKey = params.macKey ?? installMacKey(readInstallSecret() ?? mintInstallSecret());
    io.writeFile(filePath, `${JSON.stringify({ record, mac: macOf(record, macKey) }, null, 2)}\n`);
  };

  return {
    filePath,
    read(): GuardRead {
      const raw = io.readFile(filePath);
      if (raw === null) return { record: EMPTY_GUARD_RECORD, integrity: "missing" };

      let parsed: { record?: unknown; mac?: unknown };
      try {
        parsed = JSON.parse(raw) as { record?: unknown; mac?: unknown };
      } catch {
        return { record: EMPTY_GUARD_RECORD, integrity: "tampered" };
      }

      const r = parsed.record as Partial<LicenseGuardRecord> | undefined;
      if (!r || typeof r !== "object") {
        return { record: EMPTY_GUARD_RECORD, integrity: "tampered" };
      }
      const record: LicenseGuardRecord = {
        highWater: typeof r.highWater === "number" ? r.highWater : null,
        lastVerifiedAt: typeof r.lastVerifiedAt === "string" ? r.lastVerifiedAt : null,
        installedAt: typeof r.installedAt === "string" ? r.installedAt : null,
        revoked: r.revoked === true,
      };

      const mac = typeof parsed.mac === "string" ? parsed.mac : null;
      if (params.macKey === null) {
        const secret = readInstallSecret();
        if (mac === null && secret === null) {
          const sealed: LicenseGuardRecord = { highWater: record.highWater, lastVerifiedAt: null, installedAt: null, revoked: record.revoked };
          try {
            write(sealed);
          } catch {
            return { record: sealed, integrity: "tampered" };
          }
          return { record: sealed, integrity: "ok" };
        }
        if (mac === null || secret === null || mac !== macOf(record, installMacKey(secret))) return { record, integrity: "tampered" };
        return { record, integrity: "ok" };
      }
      if (mac === null || mac !== macOf(record, params.macKey)) {
        return { record, integrity: "tampered" };
      }
      return { record, integrity: "ok" };
    },
    write,
  };
}

// ---------------------------------------------------------------------------
// The policy.
// ---------------------------------------------------------------------------

export interface CheckinDecision {
  readonly verdict: CheckinVerdict;
  readonly daysSince: number;
  /** True past the 30-day mark: the shell renders a blocking notice over the app. */
  readonly blocking: boolean;
}

/**
 * The whole policy, as a pure function of the guard record and the clock.
 *
 * A NEVER-CHECKED INSTALL IS NOT PUNISHED IMMEDIATELY. `installedAt` — the
 * licence's own signed `notBefore` — starts the clock, so a shop that has
 * genuinely never been online still gets its first week, and a consultant can
 * commission a machine in a village with no connection and have it work. Using
 * the SIGNED notBefore rather than a local stamp is also what stops "delete the
 * guard file" from buying another seven days: the attacker cannot move it.
 *
 * THE CROSS-CHECK. A `lastVerifiedAt` later than the greatest wall-clock value
 * the install has ever seen cannot have happened; it is a hand-edited record,
 * and it resolves to TAMPERED rather than to a fresh week.
 */
export function decideCheckin(params: {
  readonly record: LicenseGuardRecord;
  readonly integrity: GuardIntegrity;
  readonly now: Date;
  /** Falls back when the record carries no install stamp (no licence yet). */
  readonly installedAtFallback?: string | null;
}): CheckinDecision {
  const now = params.now.getTime();

  if (params.integrity === "tampered") {
    return { verdict: "tampered", daysSince: 0, blocking: true };
  }
  if (params.record.revoked) {
    return { verdict: "revoked", daysSince: 0, blocking: true };
  }

  const lastVerified = params.record.lastVerifiedAt;
  if (lastVerified !== null && params.record.highWater !== null) {
    const parsedLast = Date.parse(lastVerified);
    if (
      !Number.isNaN(parsedLast) &&
      parsedLast > params.record.highWater + CLOCK_SKEW_TOLERANCE_MS
    ) {
      return { verdict: "tampered", daysSince: 0, blocking: true };
    }
  }

  const since = lastVerified ?? params.record.installedAt ?? params.installedAtFallback ?? null;
  const parsed = since === null ? Number.NaN : Date.parse(since);
  // An unreadable timestamp must not silently grant unlimited offline use, and
  // must not brick a working shop either: treat it as "checked in now" and let
  // the next real check-in write a clean value.
  if (Number.isNaN(parsed)) return { verdict: "ok", daysSince: 0, blocking: false };

  const daysSince = Math.floor((now - parsed) / DAY_MS);
  if (daysSince > BLOCKING_NOTICE_AFTER_DAYS) {
    return { verdict: "blocked", daysSince, blocking: true };
  }
  if (daysSince > READ_ONLY_AFTER_DAYS) {
    return { verdict: "read-only", daysSince, blocking: false };
  }
  return { verdict: "ok", daysSince, blocking: false };
}

// ---------------------------------------------------------------------------
// The network attempt.
// ---------------------------------------------------------------------------

/** Why an attempt did not produce a usable answer. Never an Error message. */
export type CheckinFailure = "NO_ENDPOINT" | "UNREACHABLE" | "BAD_ANSWER";

export interface CheckinAttempt {
  readonly reachedServer: boolean;
  readonly revoked: boolean;
  /** The SERVICE's clock from a verified answer — never this machine's. */
  readonly serverTime: string | null;
  readonly failure?: CheckinFailure;
  /** English, for the log file only. NEVER interpolated into Arabic copy. */
  readonly detail?: string;
}

/**
 * Asks the licensing service whether this licence is still good.
 *
 * FAILING TO REACH THE SERVER IS NOT A REVOCATION. An offline shop, a DNS
 * hiccup or a vendor outage must never be read as "this licence is void" — that
 * is what the day counter above is for, and it degrades gently. Only an
 * explicit, SIGNED answer of `revoked: true` revokes.
 *
 * AND AN UNSIGNED ANSWER IS NOT AN ANSWER. The reply is verified against the
 * same vendor key the licence itself is signed with, over bytes that name this
 * licence, this machine and the server's clock, so neither a hosts-file
 * redirect nor a captured older reply can switch a shop off or keep a revoked
 * copy alive. `serverTime` must also move FORWARD of the last verified time, or
 * the answer is a replay.
 *
 * No endpoint configured means no check-in is possible, which is reported as a
 * failure rather than as a pass: an install that can never check in still walks
 * the same 7/30-day path, which is what stops "just do not configure the URL"
 * from being the way around all of this.
 */
export async function attemptCheckin(params: {
  readonly endpoint: string | undefined;
  readonly licenseId: string | null;
  readonly fingerprint: string | null;
  /** Vendor Ed25519 public key (hex). Without it no answer can be trusted. */
  readonly publicKey: string | null;
  /** The last verified server time, for replay rejection. */
  readonly lastVerifiedAt: string | null;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}): Promise<CheckinAttempt> {
  if (!params.endpoint || !params.licenseId || !params.fingerprint || !params.publicKey) {
    return {
      reachedServer: false,
      revoked: false,
      serverTime: null,
      failure: "NO_ENDPOINT",
      detail: "no endpoint, licence id, fingerprint or vendor key configured",
    };
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
    if (!res.ok) {
      return {
        reachedServer: false,
        revoked: false,
        serverTime: null,
        failure: "UNREACHABLE",
        detail: `HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as {
      revoked?: unknown;
      serverTime?: unknown;
      signature?: unknown;
    };
    if (
      typeof body.revoked !== "boolean" ||
      typeof body.serverTime !== "string" ||
      typeof body.signature !== "string"
    ) {
      return {
        reachedServer: false,
        revoked: false,
        serverTime: null,
        failure: "BAD_ANSWER",
        detail: "answer is missing revoked/serverTime/signature",
      };
    }
    const serverMs = Date.parse(body.serverTime);
    if (Number.isNaN(serverMs)) {
      return {
        reachedServer: false,
        revoked: false,
        serverTime: null,
        failure: "BAD_ANSWER",
        detail: "serverTime is not a date",
      };
    }
    const lastMs = params.lastVerifiedAt === null ? Number.NaN : Date.parse(params.lastVerifiedAt);
    if (!Number.isNaN(lastMs) && serverMs <= lastMs) {
      return {
        reachedServer: false,
        revoked: false,
        serverTime: null,
        failure: "BAD_ANSWER",
        detail: "serverTime did not advance — replayed answer",
      };
    }
    const claim: CheckinClaim = {
      licenseId: params.licenseId,
      fingerprint: params.fingerprint,
      revoked: body.revoked,
      serverTime: body.serverTime,
    };
    const signatureOk = await verifyCheckinResponse(claim, body.signature, params.publicKey);
    if (!signatureOk) {
      return {
        reachedServer: false,
        revoked: false,
        serverTime: null,
        failure: "BAD_ANSWER",
        detail: "the answer's signature did not verify against the vendor key",
      };
    }
    return { reachedServer: true, revoked: body.revoked, serverTime: body.serverTime };
  } catch (err) {
    return {
      reachedServer: false,
      revoked: false,
      serverTime: null,
      failure: "UNREACHABLE",
      detail: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Folds a verified attempt into the guard record and persists it.
 *
 * `lastVerifiedAt` takes the SERVER's clock, never this machine's: a machine
 * whose clock is a year ahead must not be able to buy itself a year offline.
 * The high-water mark moves with it for the same reason.
 */
export function applyCheckinAttempt(
  store: LicenseGuardStore,
  attempt: CheckinAttempt,
  now: Date,
): void {
  if (!attempt.reachedServer || attempt.serverTime === null) return;
  const current = store.read();
  const serverMs = Date.parse(attempt.serverTime);
  store.write({
    ...current.record,
    lastVerifiedAt: attempt.serverTime,
    highWater: Math.max(current.record.highWater ?? 0, now.getTime(), serverMs),
    revoked: attempt.revoked,
  });
}

// ---------------------------------------------------------------------------
// Arabic copy. No caught Error message is ever interpolated into any of it.
// ---------------------------------------------------------------------------

/** Arabic, ready to render, with the day count and what to do about it. */
export function checkinMessageAr(verdict: CheckinVerdict, daysSince: number): string {
  if (verdict === "revoked") {
    return "تم إلغاء هذا الترخيص. البرنامج في وضع القراءة فقط — بياناتك متاحة للعرض والطباعة والتصدير. تواصل مع الدعم.";
  }
  if (verdict === "tampered") {
    return (
      "تعذّر التحقق من سجل الترخيص على هذا الجهاز، وقد يكون قد تغيّر. " +
      "البرنامج في وضع القراءة فقط — بياناتك متاحة للعرض والطباعة والتصدير. تواصل مع الدعم."
    );
  }
  if (verdict === "read-only") {
    return (
      `لم يتم التحقق من الترخيص عبر الإنترنت منذ ${daysSince} يوماً. ` +
      `يمكنك الاطلاع على البيانات وطباعتها وتصديرها، ولا يمكن تسجيل قيود جديدة حتى يتم التحقق. ` +
      `اتصل بالإنترنت أو تواصل مع الدعم.`
    );
  }
  if (verdict === "blocked") {
    return (
      `لم يتم التحقق من الترخيص عبر الإنترنت منذ ${daysSince} يوماً. ` +
      `بياناتك كاملة ومتاحة للعرض والطباعة والتصدير، ولا يمكن تسجيل قيود جديدة. ` +
      `اتصل بالإنترنت ثم اضغط «تحقق الآن»، أو تواصل مع الدعم للحصول على ملف ترخيص جديد.`
    );
  }
  return "الترخيص سارٍ.";
}

/**
 * The THREE causes a check-in can fail for, each with its own sentence.
 *
 * The English text of a caught exception used to be interpolated straight into
 * the Arabic — «تعذّر الوصول إلى خدمة التراخيص (no check-in endpoint
 * configured)» — and on a shipped install that was the only variant possible.
 * A shop owner cannot act on `ECONNREFUSED`; they can act on "this copy was
 * built without a licensing address, call support".
 */
export function checkinFailureMessageAr(failure: CheckinFailure): string {
  switch (failure) {
    case "NO_ENDPOINT":
      return "لا يمكن التحقق من الترخيص من هذه النسخة: لم يُضبط عنوان خدمة التراخيص عند بنائها. تواصل مع الدعم.";
    case "UNREACHABLE":
      return "تعذّر الوصول إلى خدمة التراخيص. تأكد من اتصال هذا الجهاز بالإنترنت ثم حاول مرة أخرى.";
    case "BAD_ANSWER":
      return "وصل رد غير صالح من خدمة التراخيص، ولم يُقبل. حاول مرة أخرى، وإذا تكرر تواصل مع الدعم.";
  }
}
