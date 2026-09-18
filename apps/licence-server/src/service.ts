import { readFileSync, writeFileSync } from "node:fs";
import { signCheckinResponse, type CheckinClaim } from "@mezan/domain";

/**
 * The vendor's check-in service — the half of the licensing scheme that did not
 * exist.
 *
 * WHAT IT IS FOR. An offline licence proves a signature, a machine binding and
 * an expiry date. It cannot know it was refunded yesterday, that the
 * subscription lapsed, or that the same file is running in three shops. This
 * answers exactly that one question, and nothing else: is licence X, on machine
 * Y, still good?
 *
 * WHY THE ANSWER IS SIGNED. An unsigned `{"revoked":false}` proves nothing that
 * anyone with a hosts file cannot also produce, and an unsigned
 * `{"revoked":true}` lets anybody on the path switch a paying shop off. So the
 * answer is signed with the same vendor key the licences are, over bytes naming
 * the licence, the machine and the server's clock — see
 * packages/domain/src/licensing/checkin.ts.
 *
 * WHAT IT DELIBERATELY IS NOT. No accounts, no database, no admin UI, no
 * issuance. Licences are minted offline by `pnpm licence:issue`, and the
 * revocation list is a JSON file a person edits. A service that could mint
 * licences would be a service worth attacking; this one holds the signing key
 * and answers a yes/no question, which is the smallest thing that closes the
 * gap.
 */

export interface RevocationFile {
  /** Licence ids the vendor has withdrawn. */
  readonly revoked: readonly string[];
  /**
   * Every (licence, machine) pair the service has answered, appended as it is
   * seen. This is the EVIDENCE for a revocation decision: one licence checking
   * in from four fingerprints is the copied-file case the whole scheme exists
   * to catch, and it is a person who decides what to do about it.
   */
  readonly seen?: Readonly<Record<string, readonly string[]>>;
}

const EMPTY: RevocationFile = { revoked: [], seen: {} };

export function readRevocations(filePath: string): RevocationFile {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<RevocationFile>;
    return {
      revoked: Array.isArray(parsed.revoked) ? parsed.revoked.filter((v) => typeof v === "string") : [],
      seen: typeof parsed.seen === "object" && parsed.seen !== null ? parsed.seen : {},
    };
  } catch {
    // A MISSING LIST REVOKES NOTHING. The failure mode of a mistyped path must
    // not be "every customer is switched off at once".
    return EMPTY;
  }
}

export function recordSeen(filePath: string, current: RevocationFile, claim: CheckinClaim): void {
  const seen = { ...(current.seen ?? {}) };
  const existing = seen[claim.licenseId] ?? [];
  if (existing.includes(claim.fingerprint)) return;
  seen[claim.licenseId] = [...existing, claim.fingerprint];
  try {
    writeFileSync(filePath, `${JSON.stringify({ revoked: current.revoked, seen }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch {
    // Bookkeeping. It must never turn a valid check-in into a failure.
  }
}

export interface CheckinRequestBody {
  readonly licenseId: unknown;
  readonly fingerprint: unknown;
}

export interface ServiceResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface CheckinServiceDeps {
  readonly revocationsPath: string;
  /** Vendor Ed25519 private seed (hex). The one secret this process holds. */
  readonly privateKey: string;
  readonly now?: () => Date;
  readonly read?: (filePath: string) => RevocationFile;
  readonly record?: (filePath: string, current: RevocationFile, claim: CheckinClaim) => void;
}

/**
 * `POST /checkin`. Pure enough to test without binding a socket.
 *
 * A malformed request is 400 and NOT a revocation: the install must be able to
 * tell "I could not be checked" from "you are revoked", because the first
 * degrades over a month and the second is immediate.
 */
export async function handleCheckin(
  body: CheckinRequestBody,
  deps: CheckinServiceDeps,
): Promise<ServiceResponse> {
  const { licenseId, fingerprint } = body;
  if (
    typeof licenseId !== "string" ||
    licenseId === "" ||
    typeof fingerprint !== "string" ||
    fingerprint === "" ||
    licenseId.includes("|") ||
    fingerprint.includes("|")
  ) {
    return { status: 400, body: { error: "BAD_REQUEST" } };
  }

  const read = deps.read ?? readRevocations;
  const record = deps.record ?? recordSeen;
  const current = read(deps.revocationsPath);
  const claim: CheckinClaim = {
    licenseId,
    fingerprint,
    revoked: current.revoked.includes(licenseId),
    serverTime: (deps.now?.() ?? new Date()).toISOString(),
  };
  record(deps.revocationsPath, current, claim);

  return {
    status: 200,
    body: {
      revoked: claim.revoked,
      serverTime: claim.serverTime,
      signature: await signCheckinResponse(claim, deps.privateKey),
    },
  };
}

/** `GET /health` — is the service up and does it hold a usable signing key? */
export function handleHealth(deps: Pick<CheckinServiceDeps, "privateKey">): ServiceResponse {
  return {
    status: deps.privateKey.length === 64 ? 200 : 503,
    body: { ok: deps.privateKey.length === 64, service: "mezan-licence-checkin" },
  };
}
