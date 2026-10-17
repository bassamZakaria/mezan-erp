import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuditEvent } from "@mezan/domain";
import { createSqliteAuditSink, openAuditChainFile, type SqliteAuditSinkHandle } from "@mezan/persistence";
import {
  anchorHead,
  AnchorOutcome,
  AnchorVerdict,
  createAuditAnchorSigner,
  createFileAuditAnchorSink,
  verifyAgainstAnchors,
  verifyAnchorSignature,
  type AuditAnchorSigner,
  type AuditAnchorSink,
  type AuditChainView,
  type SignedAuditAnchor,
} from "./audit-anchor.js";
import { createS3AuditAnchorSink } from "./audit-anchor-s3.js";

const SEED = "11".repeat(32);
const OTHER_SEED = "22".repeat(32);
const SCOPE = "T-1";
const CHAIN_KEY = "a".repeat(64);
const NOW = new Date("2026-10-17T10:00:00.000Z");

let dir: string;
let signer: AuditAnchorSigner;
let sink: AuditAnchorSink;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "audit-anchor-"));
  signer = createAuditAnchorSigner(SEED);
  sink = createFileAuditAnchorSink(path.join(dir, "anchors"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function appendRows(handle: SqliteAuditSinkHandle, count: number, label: string): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await handle.append(createAuditEvent({ stream: "security", module: "auth", entityType: "AUTH_USER", action: `${label}-${i}`, actor: "u", severity: "INFO" }));
  }
}

async function anchorFile(file: string): Promise<SignedAuditAnchor | undefined> {
  const reader = openAuditChainFile(file, { chainKey: CHAIN_KEY });
  try {
    const [latest = null] = (await sink.list(SCOPE, 1)).slice(-1);
    const result = await anchorHead({ scope: SCOPE, head: reader.head(), rowHashAt: (id) => reader.rowHashAt(id), signer, latest, sink, now: () => NOW });
    return result.anchor;
  } finally {
    reader.close();
  }
}

async function verifyFile(file: string, chain = true) {
  const reader = openAuditChainFile(file, { chainKey: CHAIN_KEY });
  try {
    return await verifyAgainstAnchors({ scope: SCOPE, chain: reader, anchors: await sink.list(SCOPE, 100), publicKeyHex: signer.publicKeyHex, verifyChain: chain });
  } finally {
    reader.close();
  }
}

describe("anchor signatures", () => {
  it("verifies under the signing key and under no other", () => {
    const signed = signer.sign({ scope: SCOPE, seq: 5, headHash: "ab", anchoredAt: NOW.toISOString() });
    expect(verifyAnchorSignature(signed, signer.publicKeyHex)).toBe(true);
    expect(verifyAnchorSignature(signed, createAuditAnchorSigner(OTHER_SEED).publicKeyHex)).toBe(false);
  });

  it("fails when any signed field is altered", () => {
    const signed = signer.sign({ scope: SCOPE, seq: 5, headHash: "ab", anchoredAt: NOW.toISOString() });
    for (const altered of [{ seq: 4 }, { headHash: "ac" }, { scope: "T-2" }, { anchoredAt: "2026-01-01T00:00:00.000Z" }]) {
      expect(verifyAnchorSignature({ ...signed, anchor: { ...signed.anchor, ...altered } }, signer.publicKeyHex)).toBe(false);
    }
  });

  it("refuses a malformed seed", () => {
    expect(() => createAuditAnchorSigner("nope")).toThrow(/64 lowercase hex/);
  });
});

describe("against a real audit chain", () => {
  let file: string;
  let handle: SqliteAuditSinkHandle;

  beforeEach(() => {
    file = path.join(dir, "tenant.db");
    handle = createSqliteAuditSink(file, { chainKey: CHAIN_KEY });
  });
  afterEach(() => handle.close());

  it("anchors the head, then verifies after the chain legitimately grows", async () => {
    await appendRows(handle, 3, "a");
    const first = await anchorFile(file);
    expect(first?.anchor.seq).toBe(3);

    await appendRows(handle, 2, "b");
    const second = await anchorFile(file);
    expect(second?.anchor.seq).toBe(5);

    const result = await verifyFile(file);
    expect(result).toMatchObject({ ok: true, anchorsChecked: 2, latestAnchoredSeq: 5, liveHeadSeq: 5 });
  });

  it("does not re-anchor an unchanged head", async () => {
    await appendRows(handle, 2, "a");
    await anchorFile(file);
    expect(await anchorFile(file)).toBeUndefined();
    expect(await sink.list(SCOPE, 10)).toHaveLength(1);
  });

  it("reports a restored older backup as ROLLED_BACK, and refuses to anchor it", async () => {
    await appendRows(handle, 3, "a");
    handle.db.pragma("wal_checkpoint(TRUNCATE)");
    const backup = path.join(dir, "old.db");
    copyFileSync(file, backup);
    await appendRows(handle, 3, "b");
    await anchorFile(file);
    handle.close();

    copyFileSync(backup, file);
    const result = await verifyFile(file);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.verdict)).toContain(AnchorVerdict.RolledBack);
    expect(result.liveHeadSeq).toBe(3);

    const reader = openAuditChainFile(file, { chainKey: CHAIN_KEY });
    const [latest = null] = (await sink.list(SCOPE, 1)).slice(-1);
    const refused = await anchorHead({ scope: SCOPE, head: reader.head(), rowHashAt: (id) => reader.rowHashAt(id), signer, latest, sink, now: () => NOW });
    reader.close();
    expect(refused.outcome).toBe(AnchorOutcome.Refused);
    expect(refused.reason).toMatch(/rollback/);
  });

  it("reports a rewritten row as REWRITTEN and a broken live chain", async () => {
    await appendRows(handle, 4, "a");
    await anchorFile(file);
    handle.db.exec("DROP TRIGGER audit_event_no_update");
    handle.db.prepare("UPDATE audit_event SET action = 'FORGED' WHERE id = 2").run();
    handle.db.pragma("wal_checkpoint(TRUNCATE)");
    handle.close();

    const result = await verifyFile(file);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.verdict)).toContain(AnchorVerdict.ChainBroken);
  });

  it("verifies a clean chain even when the chain-key file is the only secret", async () => {
    await appendRows(handle, 2, "a");
    await anchorFile(file);
    const keyed = await verifyFile(file, false);
    expect(keyed.ok).toBe(true);
  });
});

describe("verifyAgainstAnchors on a chain the attacker re-hashed with the key", () => {
  const chainOf = (hashes: Record<number, string>, headSeq: number): AuditChainView => ({
    head: () => ({ rowId: headSeq, rowHash: hashes[headSeq] as string }),
    rowHashAt: (id) => hashes[id] ?? null,
    verify: async () => ({ ok: true, checked: headSeq, unchained: 0, brokenRowId: null, reason: "OK" }),
  });

  it("reports REWRITTEN though the chain itself verifies", async () => {
    const anchored = signer.sign({ scope: SCOPE, seq: 2, headHash: "h2", anchoredAt: NOW.toISOString() });
    const result = await verifyAgainstAnchors({ scope: SCOPE, chain: chainOf({ 1: "h1", 2: "FORGED", 3: "h3" }, 3), anchors: [anchored], publicKeyHex: signer.publicKeyHex, verifyChain: true });
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.verdict)).toEqual([AnchorVerdict.Rewritten]);
  });

  it("reports an anchor signed with another key as ANCHORS_FORGED", async () => {
    const forged = createAuditAnchorSigner(OTHER_SEED).sign({ scope: SCOPE, seq: 1, headHash: "h1", anchoredAt: NOW.toISOString() });
    const result = await verifyAgainstAnchors({ scope: SCOPE, chain: chainOf({ 1: "h1" }, 1), anchors: [forged], publicKeyHex: signer.publicKeyHex, verifyChain: true });
    expect(result.findings.map((f) => f.verdict)).toContain(AnchorVerdict.AnchorsForged);
    expect(result.ok).toBe(false);
  });

  it("reports anchors whose sequence went backwards", async () => {
    const a = signer.sign({ scope: SCOPE, seq: 5, headHash: "h5", anchoredAt: NOW.toISOString() });
    const b = signer.sign({ scope: SCOPE, seq: 3, headHash: "h3", anchoredAt: NOW.toISOString() });
    const result = await verifyAgainstAnchors({ scope: SCOPE, chain: chainOf({ 3: "h3", 5: "h5" }, 5), anchors: [a, b], publicKeyHex: signer.publicKeyHex, verifyChain: false });
    expect(result.findings.map((f) => f.verdict)).toContain(AnchorVerdict.AnchorsRegressed);
  });

  it("is not ok without any anchor", async () => {
    const result = await verifyAgainstAnchors({ scope: SCOPE, chain: chainOf({ 1: "h1" }, 1), anchors: [], publicKeyHex: signer.publicKeyHex, verifyChain: true });
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.verdict)).toEqual([AnchorVerdict.NoAnchors]);
  });
});

describe("anchorHead", () => {
  it("does not sign a head whose row is not the one it names", async () => {
    const result = await anchorHead({ scope: SCOPE, head: { rowId: 4, rowHash: "h4" }, rowHashAt: () => "other", signer, latest: null, sink, now: () => NOW });
    expect(result.outcome).toBe(AnchorOutcome.Refused);
    expect(await sink.list(SCOPE, 10)).toEqual([]);
  });

  it("does nothing for a database with no chain", async () => {
    expect((await anchorHead({ scope: SCOPE, head: null, rowHashAt: () => null, signer, latest: null, sink, now: () => NOW })).outcome).toBe(AnchorOutcome.NoChain);
  });

  it("refuses to extend an anchor trail whose newest entry is forged", async () => {
    const forged = createAuditAnchorSigner(OTHER_SEED).sign({ scope: SCOPE, seq: 1, headHash: "h1", anchoredAt: NOW.toISOString() });
    const result = await anchorHead({ scope: SCOPE, head: { rowId: 2, rowHash: "h2" }, rowHashAt: (id) => `h${id}`, signer, latest: forged, sink, now: () => NOW });
    expect(result.outcome).toBe(AnchorOutcome.Refused);
  });
});

describe("file sink", () => {
  it("keeps the newest N, oldest first, and survives a torn line", async () => {
    for (const seq of [1, 2, 3]) await sink.append(signer.sign({ scope: SCOPE, seq, headHash: `h${seq}`, anchoredAt: NOW.toISOString() }));
    writeFileSync(path.join(dir, "anchors", `${SCOPE}.jsonl`), "{not json\n", { flag: "a" });
    expect((await sink.list(SCOPE, 2)).map((s) => s.anchor.seq)).toEqual([2, 3]);
  });

  it("refuses a scope that could escape the directory", async () => {
    await expect(sink.list("../etc", 1)).rejects.toThrow(/not a valid/);
    expect(existsSync(path.join(dir, "etc.jsonl"))).toBe(false);
  });
});

describe("S3 sink", () => {
  it("PUTs one conditional, signed object per anchor under audit-anchors/<scope>/<seq>.json", async () => {
    const calls: { method: string; url: string; headers: Record<string, string>; body?: string }[] = [];
    const s3 = createS3AuditAnchorSink({
      bucket: "backups",
      region: "eu-south-1",
      credentials: async () => ({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" }),
      now: () => NOW,
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ method: String(init.method), url, headers: init.headers as Record<string, string>, body: init.body ? Buffer.from(init.body as Uint8Array).toString("utf8") : undefined });
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
    });
    const signed = signer.sign({ scope: SCOPE, seq: 42, headHash: "h42", anchoredAt: NOW.toISOString() });
    await s3.append(signed);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe("https://backups.s3.eu-south-1.amazonaws.com/audit-anchors/T-1/000000000042.json");
    expect(calls[0]?.headers["if-none-match"]).toBe("*");
    expect(calls[0]?.headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261017\/eu-south-1\/s3\/aws4_request, SignedHeaders=.*content-type.*host.*if-none-match.*, Signature=[0-9a-f]{64}$/);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual(signed);
  });

  it("treats a 412 (the object already exists) as already anchored but surfaces other failures", async () => {
    const answer = (status: number) =>
      createS3AuditAnchorSink({
        bucket: "b",
        region: "r",
        credentials: async () => ({ accessKeyId: "k", secretAccessKey: "s" }),
        fetch: (async () => new Response("", { status })) as unknown as typeof fetch,
      });
    const signed = signer.sign({ scope: SCOPE, seq: 1, headHash: "h", anchoredAt: NOW.toISOString() });
    await expect(answer(412).append(signed)).resolves.toBeUndefined();
    await expect(answer(403).append(signed)).rejects.toThrow(/403/);
  });

  it("lists the newest keys and reads them back in order", async () => {
    const stored = new Map<string, string>();
    for (const seq of [1, 2, 3]) stored.set(`audit-anchors/T-1/${String(seq).padStart(12, "0")}.json`, JSON.stringify(signer.sign({ scope: SCOPE, seq, headHash: `h${seq}`, anchoredAt: NOW.toISOString() })));
    const s3 = createS3AuditAnchorSink({
      bucket: "b",
      region: "r",
      credentials: async () => ({ accessKeyId: "k", secretAccessKey: "s" }),
      fetch: (async (url: string) => {
        const parsed = new URL(url);
        if (parsed.searchParams.get("list-type")) {
          return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${[...stored.keys()].map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`);
        }
        return new Response(stored.get(parsed.pathname.slice(1)) ?? "", { status: stored.has(parsed.pathname.slice(1)) ? 200 : 404 });
      }) as unknown as typeof fetch,
    });
    expect((await s3.list(SCOPE, 2)).map((s) => s.anchor.seq)).toEqual([2, 3]);
  });
});
