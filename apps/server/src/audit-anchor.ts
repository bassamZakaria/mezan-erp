import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
import path from "node:path";
import type { AuditChainVerification } from "@mezan/persistence";

export const AUDIT_ANCHOR_VERSION = "mezan-audit-anchor-v1";
export const AUDIT_ANCHOR_REBASE_VERSION = "mezan-audit-anchor-rebase-v1";
export const PLATFORM_ANCHOR_SCOPE = "platform";

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HEX_32_BYTES = /^[0-9a-f]{64}$/;

export interface AnchorRebase {
  readonly supersededSeq: number;
  readonly supersededHeadHash: string;
  readonly reason: string;
  readonly acceptedBy: string;
}

export interface AuditAnchor {
  readonly scope: string;
  readonly seq: number;
  readonly headHash: string;
  readonly anchoredAt: string;
  readonly keyId: string;
  readonly rebase?: AnchorRebase;
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

// EXTERNAL CONTRACT: these tuples are what every stored anchor was signed over. A plain anchor keeps the v1 tuple byte for byte;
// a rebase signs its own, so the reason and the superseded head cannot be swapped after the fact.
function canonicalAnchor(anchor: AuditAnchor): Buffer {
  const fields = anchor.rebase
    ? [AUDIT_ANCHOR_REBASE_VERSION, anchor.scope, anchor.seq, anchor.headHash, anchor.anchoredAt, anchor.keyId, anchor.rebase.supersededSeq, anchor.rebase.supersededHeadHash, anchor.rebase.reason, anchor.rebase.acceptedBy]
    : [AUDIT_ANCHOR_VERSION, anchor.scope, anchor.seq, anchor.headHash, anchor.anchoredAt, anchor.keyId];
  return Buffer.from(JSON.stringify(fields), "utf8");
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
  const base = { scope: anchor.scope, seq: anchor.seq, headHash: anchor.headHash, anchoredAt: anchor.anchoredAt, keyId: anchor.keyId };
  if (anchor.rebase === undefined) return { anchor: base, signature };
  const rebase = parseRebase(anchor.rebase);
  return rebase ? { anchor: { ...base, rebase }, signature } : null;
}

function parseRebase(raw: unknown): AnchorRebase | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { supersededSeq, supersededHeadHash, reason, acceptedBy } = raw as Partial<AnchorRebase>;
  if (typeof supersededSeq !== "number" || !Number.isInteger(supersededSeq) || typeof supersededHeadHash !== "string" || typeof reason !== "string" || typeof acceptedBy !== "string") {
    return null;
  }
  return { supersededSeq, supersededHeadHash, reason, acceptedBy };
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
  Superseded = "SUPERSEDED_BY_RESTORE",
}

const INFORMATIONAL_VERDICTS: ReadonlySet<AnchorVerdict> = new Set([AnchorVerdict.NoAnchors, AnchorVerdict.Superseded]);

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

  const rebaseAt = genuine.reduce((found, signed, index) => (signed.anchor.rebase !== undefined ? index : found), -1);
  const superseded = rebaseAt > 0 ? genuine.slice(0, rebaseAt) : [];
  const current = rebaseAt >= 0 ? genuine.slice(rebaseAt) : genuine;
  const rebase = rebaseAt >= 0 ? (genuine[rebaseAt] as SignedAuditAnchor).anchor : null;
  if (rebase?.rebase) {
    findings.push({
      verdict: AnchorVerdict.Superseded,
      detail:
        `a restore was accepted at ${rebase.anchoredAt} by ${rebase.rebase.acceptedBy}: «${rebase.rebase.reason}». ` +
        `The anchored head before it (seq ${rebase.rebase.supersededSeq}, ${rebase.rebase.supersededHeadHash}) and ${superseded.length} earlier anchor(s) in this window are superseded; ` +
        `the restored chain is anchored from seq ${rebase.seq}`,
    });
  }

  let previous: AuditAnchor | null = null;
  for (const { anchor } of current) {
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

  for (const { anchor } of current) {
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

  const faults = findings.filter((f) => !INFORMATIONAL_VERDICTS.has(f.verdict));
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

export enum AnchorRefusal {
  HeadInconsistent = "HEAD_INCONSISTENT",
  NewestAnchorForged = "NEWEST_ANCHOR_FORGED",
  RolledBack = "ROLLED_BACK",
  Rewritten = "REWRITTEN",
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
  readonly refusal?: AnchorRefusal;
  readonly reason?: string;
  readonly anchor?: SignedAuditAnchor;
}

/** What `anchorHead` would do with this head, without signing or writing anything. */
export function judgeHead(input: Pick<AnchorHeadInput, "head" | "rowHashAt" | "signer" | "latest">): AnchorHeadResult {
  const { head } = input;
  if (head === null) return { outcome: AnchorOutcome.NoChain };
  if (input.rowHashAt(head.rowId) !== head.rowHash) {
    return { outcome: AnchorOutcome.Refused, refusal: AnchorRefusal.HeadInconsistent, reason: `the chain head names row ${head.rowId}, which is missing or carries another hash` };
  }
  const { latest } = input;
  if (latest) {
    if (!verifyAnchorSignatureAmong(latest, input.signer.trustedPublicKeys)) {
      return { outcome: AnchorOutcome.Refused, refusal: AnchorRefusal.NewestAnchorForged, reason: `the newest anchor on record (seq ${latest.anchor.seq}) does not carry a valid signature` };
    }
    if (head.rowId < latest.anchor.seq) {
      return { outcome: AnchorOutcome.Refused, refusal: AnchorRefusal.RolledBack, reason: `the chain ends at ${head.rowId}, behind the anchored ${latest.anchor.seq} (rollback)` };
    }
    if (input.rowHashAt(latest.anchor.seq) !== latest.anchor.headHash) {
      return { outcome: AnchorOutcome.Refused, refusal: AnchorRefusal.Rewritten, reason: `row ${latest.anchor.seq} no longer matches its anchor (rewrite)` };
    }
    if (head.rowId === latest.anchor.seq) return { outcome: AnchorOutcome.Unchanged };
  }
  return { outcome: AnchorOutcome.Anchored };
}

/**
 * REQUIRED ORDERING: a head is signed only after it is shown to extend the
 * newest anchor already on record. Signing whatever the file says would let a
 * rollback or a rewrite launder itself into the new "truth" at the next tick;
 * instead the job refuses and the discrepancy keeps shouting — until an owner
 * accepts the restore (`acceptRestore`), which leaves its own signed record.
 */
export async function anchorHead(input: AnchorHeadInput): Promise<AnchorHeadResult> {
  const judged = judgeHead(input);
  if (judged.outcome !== AnchorOutcome.Anchored || input.head === null) return judged;
  const signed = input.signer.sign({ scope: input.scope, seq: input.head.rowId, headHash: input.head.rowHash, anchoredAt: input.now().toISOString() });
  await input.sink.append(signed);
  return { outcome: AnchorOutcome.Anchored, anchor: signed };
}

export const ACCEPT_RESTORE_MIN_REASON = 10;

export enum AcceptRestoreRefusal {
  ReasonTooShort = "REASON_TOO_SHORT",
  NoChain = "NO_CHAIN",
  NothingAnchored = "NOTHING_ANCHORED",
  NothingToAccept = "NOTHING_TO_ACCEPT",
  HeadInconsistent = "HEAD_INCONSISTENT",
  NewestAnchorForged = "NEWEST_ANCHOR_FORGED",
  ChainBroken = "CHAIN_BROKEN",
}

export interface AcceptRestoreInput extends AnchorHeadInput {
  readonly reason: string;
  readonly acceptedBy: string;
  readonly verifyChain?: () => Promise<AuditChainVerification>;
}

export type AcceptRestoreResult =
  | { readonly accepted: true; readonly anchor: SignedAuditAnchor; readonly superseded: AuditAnchor }
  | { readonly accepted: false; readonly refusal: AcceptRestoreRefusal; readonly reason: string };

/**
 * SECURITY: the one way past a refused anchor. It signs a rebase only for the
 * two refusals a legitimate restore produces (the live chain is behind, or has
 * replaced, the anchored head), only over a chain that verifies on its own,
 * and only with a reason — the rebase names the head it supersedes, so the
 * verifier keeps reporting the history it replaced. Anything else (a forged
 * anchor trail, an inconsistent head, a broken chain) stays refused.
 */
export async function acceptRestore(input: AcceptRestoreInput): Promise<AcceptRestoreResult> {
  const reason = input.reason.trim();
  if (reason.length < ACCEPT_RESTORE_MIN_REASON) {
    return { accepted: false, refusal: AcceptRestoreRefusal.ReasonTooShort, reason: `the reason must be at least ${ACCEPT_RESTORE_MIN_REASON} characters` };
  }
  const { head, latest } = input;
  if (head === null) return { accepted: false, refusal: AcceptRestoreRefusal.NoChain, reason: "the database has no audit chain" };
  if (latest === null) return { accepted: false, refusal: AcceptRestoreRefusal.NothingAnchored, reason: "nothing has been anchored for this scope yet" };
  const judged = judgeHead(input);
  if (judged.refusal === AnchorRefusal.HeadInconsistent) return { accepted: false, refusal: AcceptRestoreRefusal.HeadInconsistent, reason: judged.reason ?? "" };
  if (judged.refusal === AnchorRefusal.NewestAnchorForged) return { accepted: false, refusal: AcceptRestoreRefusal.NewestAnchorForged, reason: judged.reason ?? "" };
  if (judged.refusal !== AnchorRefusal.RolledBack && judged.refusal !== AnchorRefusal.Rewritten) {
    return { accepted: false, refusal: AcceptRestoreRefusal.NothingToAccept, reason: "the live chain extends its newest anchor; there is no restore to accept" };
  }
  if (input.verifyChain) {
    const chain = await input.verifyChain();
    if (!chain.ok) return { accepted: false, refusal: AcceptRestoreRefusal.ChainBroken, reason: `the live chain does not verify: ${chain.reason}` };
  }
  const signed = input.signer.sign({
    scope: input.scope,
    seq: head.rowId,
    headHash: head.rowHash,
    anchoredAt: input.now().toISOString(),
    rebase: { supersededSeq: latest.anchor.seq, supersededHeadHash: latest.anchor.headHash, reason, acceptedBy: input.acceptedBy },
  });
  await input.sink.append(signed);
  return { accepted: true, anchor: signed, superseded: latest.anchor };
}
