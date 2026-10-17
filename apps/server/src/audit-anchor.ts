import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import type { AuditChainVerification } from "@mezan/persistence";

export const AUDIT_ANCHOR_VERSION = "mezan-audit-anchor-v1";
export const PLATFORM_ANCHOR_SCOPE = "platform";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HEX_32_BYTES = /^[0-9a-f]{64}$/;

export interface AuditAnchor {
  readonly scope: string;
  readonly seq: number;
  readonly headHash: string;
  readonly anchoredAt: string;
  readonly keyId: string;
}

export interface SignedAuditAnchor {
  readonly anchor: AuditAnchor;
  readonly signature: string;
}

export interface AuditAnchorSink {
  append(signed: SignedAuditAnchor): Promise<void>;
  /** Oldest first, at most `limit` of the newest. Reads every anchor of the scope: for verification, not for the per-tick sweep. */
  list(scope: string, limit: number): Promise<readonly SignedAuditAnchor[]>;
  /** The newest anchor alone, in constant work however long the scope's history is. */
  latest(scope: string): Promise<SignedAuditAnchor | null>;
}

export class AuditAnchorKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditAnchorKeyError";
  }
}

export interface AuditAnchorSigner {
  readonly keyId: string;
  readonly publicKeyHex: string;
  /** SECURITY: this signer's own key plus every retired key whose anchors are still honoured; only the own key signs. */
  readonly trustedPublicKeys: readonly string[];
  sign(anchor: Omit<AuditAnchor, "keyId">): SignedAuditAnchor;
}

function canonicalAnchor(anchor: AuditAnchor): Buffer {
  return Buffer.from(JSON.stringify([AUDIT_ANCHOR_VERSION, anchor.scope, anchor.seq, anchor.headHash, anchor.anchoredAt, anchor.keyId]), "utf8");
}

function publicKeyObject(publicKeyHex: string): KeyObject {
  if (!HEX_32_BYTES.test(publicKeyHex)) throw new AuditAnchorKeyError("the audit anchor public key must be 64 hex characters (a 32-byte Ed25519 public key)");
  return createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKeyHex, "hex")]), format: "der", type: "spki" });
}

export function keyIdOf(publicKeyHex: string): string {
  return createHash("sha256").update(publicKeyHex, "utf8").digest("hex").slice(0, 16);
}

/**
 * SECURITY: the seed is the 32-byte Ed25519 seed as 64 hex characters, the same
 * shape the release-signing key uses. It comes from a secret, never from the
 * repository and never from the database an attacker is holding.
 */
export function createAuditAnchorSigner(seedHex: string, retiredPublicKeys: readonly string[] = []): AuditAnchorSigner {
  if (!HEX_32_BYTES.test(seedHex)) throw new AuditAnchorKeyError("MEZAN_AUDIT_ANCHOR_SIGNING_KEY must be the 32-byte Ed25519 seed as 64 lowercase hex characters");
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seedHex, "hex")]), format: "der", type: "pkcs8" });
  const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const publicKeyHex = publicDer.subarray(publicDer.length - 32).toString("hex");
  const keyId = keyIdOf(publicKeyHex);
  return {
    keyId,
    publicKeyHex,
    trustedPublicKeys: [...new Set([publicKeyHex, ...retiredPublicKeys])],
    sign(partial) {
      const anchor: AuditAnchor = { ...partial, keyId };
      return { anchor, signature: sign(null, canonicalAnchor(anchor), privateKey).toString("base64") };
    },
  };
}

export function verifyAnchorSignature(signed: SignedAuditAnchor, publicKeyHex: string): boolean {
  if (signed.anchor.keyId !== keyIdOf(publicKeyHex)) return false;
  try {
    return verify(null, canonicalAnchor(signed.anchor), publicKeyObject(publicKeyHex), Buffer.from(signed.signature, "base64"));
  } catch {
    return false;
  }
}

export function verifyAnchorSignatureAmong(signed: SignedAuditAnchor, publicKeysHex: readonly string[]): boolean {
  return publicKeysHex.some((publicKeyHex) => verifyAnchorSignature(signed, publicKeyHex));
}

export function parseSignedAnchor(raw: unknown): SignedAuditAnchor | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { anchor, signature } = raw as { anchor?: Partial<AuditAnchor>; signature?: unknown };
  if (
    typeof signature !== "string" ||
    typeof anchor !== "object" ||
    anchor === null ||
    typeof anchor.scope !== "string" ||
    typeof anchor.seq !== "number" ||
    !Number.isInteger(anchor.seq) ||
    typeof anchor.headHash !== "string" ||
    typeof anchor.anchoredAt !== "string" ||
    typeof anchor.keyId !== "string"
  ) {
    return null;
  }
  return { anchor: { scope: anchor.scope, seq: anchor.seq, headHash: anchor.headHash, anchoredAt: anchor.anchoredAt, keyId: anchor.keyId }, signature };
}

const SAFE_SCOPE = /^[A-Za-z0-9._-]{1,128}$/;

export function assertSafeScope(scope: string): void {
  if (!SAFE_SCOPE.test(scope) || scope === "." || scope === "..") throw new Error(`"${scope}" is not a valid audit anchor scope`);
}

/**
 * Dev and test sink: one JSON line per anchor, appended and never rewritten by
 * this code. A local file is NOT external to the host it protects; production
 * uses the S3 sink.
 */
export function createFileAuditAnchorSink(dir: string): AuditAnchorSink {
  const fileOf = (scope: string): string => {
    assertSafeScope(scope);
    return path.join(dir, `${scope}.jsonl`);
  };
  return {
    async append(signed) {
      const file = fileOf(signed.anchor.scope);
      mkdirSync(dir, { recursive: true });
      const created = !existsSync(file);
      appendFileSync(file, `${JSON.stringify(signed)}\n`, { mode: 0o600 });
      if (created) chmodSync(file, 0o600);
    },
    async list(scope, limit) {
      const file = fileOf(scope);
      if (!existsSync(file)) return [];
      const anchors = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => {
          try {
            return parseSignedAnchor(JSON.parse(line) as unknown);
          } catch {
            return null;
          }
        });
      const valid = anchors.filter((a): a is SignedAuditAnchor => a !== null);
      return valid.slice(-limit);
    },
    async latest(scope) {
      const file = fileOf(scope);
      if (!existsSync(file)) return null;
      return newestAnchorInFile(file);
    },
  };
}

const TAIL_CHUNK_BYTES = 4096;

function newestAnchorInFile(file: string): SignedAuditAnchor | null {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    let window = TAIL_CHUNK_BYTES;
    for (;;) {
      const start = Math.max(0, size - window);
      const buffer = Buffer.alloc(size - start);
      readSync(fd, buffer, 0, buffer.length, start);
      const lines = buffer.toString("utf8").split("\n");
      if (start > 0) lines.shift();
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = (lines[i] as string).trim();
        if (line === "") continue;
        try {
          const parsed = parseSignedAnchor(JSON.parse(line) as unknown);
          if (parsed) return parsed;
        } catch {
          continue;
        }
      }
      if (start === 0) return null;
      window *= 2;
    }
  } finally {
    closeSync(fd);
  }
}

export interface AuditChainView {
  head(): { readonly rowId: number; readonly rowHash: string } | null;
  rowHashAt(rowId: number): string | null;
  verify?(): Promise<AuditChainVerification>;
}

export enum AnchorVerdict {
  Ok = "OK",
  NoAnchors = "NO_ANCHORS",
  ChainBroken = "CHAIN_BROKEN",
  RolledBack = "ROLLED_BACK",
  Rewritten = "REWRITTEN",
  AnchorsForged = "ANCHORS_FORGED",
  AnchorsRegressed = "ANCHORS_REGRESSED",
}

export interface AnchorFinding {
  readonly verdict: AnchorVerdict;
  readonly detail: string;
}

export interface AnchorVerification {
  readonly scope: string;
  readonly ok: boolean;
  readonly anchorsChecked: number;
  readonly latestAnchoredSeq: number | null;
  readonly liveHeadSeq: number | null;
  readonly findings: readonly AnchorFinding[];
}

export interface VerifyAgainstAnchorsInput {
  readonly scope: string;
  readonly chain: AuditChainView;
  readonly anchors: readonly SignedAuditAnchor[];
  readonly publicKeyHex: string;
  /** Retired keys whose anchors still count as genuine. */
  readonly trustedPublicKeys?: readonly string[];
  readonly verifyChain: boolean;
}

/**
 * Checks, in the order an auditor would trust them: the anchors are genuinely
 * ours; they only ever moved forward; the live chain verifies; and every
 * anchored head is still the row it was. A restored older backup shows as
 * ROLLED_BACK (the live head is behind an anchor), a re-chained history as
 * REWRITTEN (the row at an anchored sequence no longer has the anchored hash).
 */
export async function verifyAgainstAnchors(input: VerifyAgainstAnchorsInput): Promise<AnchorVerification> {
  const findings: AnchorFinding[] = [];
  const head = input.chain.head();
  const liveHeadSeq = head?.rowId ?? null;

  const trusted = [input.publicKeyHex, ...(input.trustedPublicKeys ?? [])];
  const genuine: SignedAuditAnchor[] = [];
  for (const signed of input.anchors) {
    if (signed.anchor.scope !== input.scope || !verifyAnchorSignatureAmong(signed, trusted)) {
      findings.push({ verdict: AnchorVerdict.AnchorsForged, detail: `anchor at seq ${signed.anchor.seq} does not carry a valid signature for this scope` });
    } else {
      genuine.push(signed);
    }
  }

  let previous: AuditAnchor | null = null;
  for (const { anchor } of genuine) {
    if (previous !== null && anchor.seq < previous.seq) {
      findings.push({ verdict: AnchorVerdict.AnchorsRegressed, detail: `anchor sequence went backwards: ${previous.seq} then ${anchor.seq}` });
    }
    if (previous !== null && anchor.seq === previous.seq && anchor.headHash !== previous.headHash) {
      findings.push({ verdict: AnchorVerdict.Rewritten, detail: `two anchors disagree about seq ${anchor.seq}` });
    }
    previous = anchor;
  }

  if (input.verifyChain && input.chain.verify) {
    const chain = await input.chain.verify();
    if (!chain.ok) {
      findings.push({
        verdict: AnchorVerdict.ChainBroken,
        detail: `the live chain does not verify: ${chain.reason}${chain.brokenRowId === null ? "" : ` at row ${chain.brokenRowId}`}`,
      });
    }
  }

  for (const { anchor } of genuine) {
    if (liveHeadSeq === null || liveHeadSeq < anchor.seq) {
      findings.push({
        verdict: AnchorVerdict.RolledBack,
        detail: `the live chain ends at ${liveHeadSeq ?? "nothing"} but seq ${anchor.seq} was anchored at ${anchor.anchoredAt}`,
      });
      continue;
    }
    const live = input.chain.rowHashAt(anchor.seq);
    if (live !== anchor.headHash) {
      findings.push({
        verdict: AnchorVerdict.Rewritten,
        detail: `row ${anchor.seq} is ${live === null ? "missing or unchained" : "different"} from what was anchored at ${anchor.anchoredAt}`,
      });
    }
  }

  const latest = genuine.length === 0 ? null : (genuine[genuine.length - 1] as SignedAuditAnchor).anchor;
  if (input.anchors.length === 0) findings.push({ verdict: AnchorVerdict.NoAnchors, detail: "no anchor has been recorded for this scope yet" });

  const faults = findings.filter((f) => f.verdict !== AnchorVerdict.NoAnchors);
  return {
    scope: input.scope,
    ok: faults.length === 0 && input.anchors.length > 0,
    anchorsChecked: genuine.length,
    latestAnchoredSeq: latest?.seq ?? null,
    liveHeadSeq,
    findings,
  };
}

export enum AnchorOutcome {
  Anchored = "ANCHORED",
  Unchanged = "UNCHANGED",
  NoChain = "NO_CHAIN",
  Refused = "REFUSED",
}

export interface AnchorHeadInput {
  readonly scope: string;
  readonly head: { readonly rowId: number; readonly rowHash: string } | null;
  readonly rowHashAt: (rowId: number) => string | null;
  readonly signer: AuditAnchorSigner;
  readonly latest: SignedAuditAnchor | null;
  readonly sink: AuditAnchorSink;
  readonly now: () => Date;
}

export interface AnchorHeadResult {
  readonly outcome: AnchorOutcome;
  readonly reason?: string;
  readonly anchor?: SignedAuditAnchor;
}

/**
 * REQUIRED ORDERING: a head is signed only after it is shown to extend the
 * newest anchor already on record. Signing whatever the file says would let a
 * rollback or a rewrite launder itself into the new "truth" at the next tick;
 * instead the job refuses and the discrepancy keeps shouting.
 */
export async function anchorHead(input: AnchorHeadInput): Promise<AnchorHeadResult> {
  const { head } = input;
  if (head === null) return { outcome: AnchorOutcome.NoChain };
  if (input.rowHashAt(head.rowId) !== head.rowHash) {
    return { outcome: AnchorOutcome.Refused, reason: `the chain head names row ${head.rowId}, which is missing or carries another hash` };
  }
  const { latest } = input;
  if (latest) {
    if (!verifyAnchorSignatureAmong(latest, input.signer.trustedPublicKeys)) {
      return { outcome: AnchorOutcome.Refused, reason: `the newest anchor on record (seq ${latest.anchor.seq}) does not carry a valid signature` };
    }
    if (head.rowId < latest.anchor.seq) {
      return { outcome: AnchorOutcome.Refused, reason: `the chain ends at ${head.rowId}, behind the anchored ${latest.anchor.seq} (rollback)` };
    }
    if (input.rowHashAt(latest.anchor.seq) !== latest.anchor.headHash) {
      return { outcome: AnchorOutcome.Refused, reason: `row ${latest.anchor.seq} no longer matches its anchor (rewrite)` };
    }
    if (head.rowId === latest.anchor.seq) return { outcome: AnchorOutcome.Unchanged };
  }
  const signed = input.signer.sign({ scope: input.scope, seq: head.rowId, headHash: head.rowHash, anchoredAt: input.now().toISOString() });
  await input.sink.append(signed);
  return { outcome: AnchorOutcome.Anchored, anchor: signed };
}
