import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuditEvent } from "@mezan/domain";
import { createSqliteAuditSink, openAuditChainFile, type SqliteAuditSinkHandle } from "@mezan/persistence";
import {
  acceptRestore,
  AcceptRestoreRefusal,
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

  async function acceptOnFile(reason: string, at = NOW) {
    const reader = openAuditChainFile(file, { chainKey: CHAIN_KEY });
    try {
      const latest = await sink.latest(SCOPE);
      return await acceptRestore({ scope: SCOPE, head: reader.head(), rowHashAt: (id) => reader.rowHashAt(id), signer, latest, sink, now: () => at, reason, acceptedBy: "owner-1", verifyChain: () => reader.verify() });
    } finally {
      reader.close();
    }
  }

  it("an accepted restore records a signed rebase: the verifier reports the superseded history but passes, and anchoring resumes", async () => {
    await appendRows(handle, 3, "a");
    handle.db.pragma("wal_checkpoint(TRUNCATE)");
    const backup = path.join(dir, "old.db");
    copyFileSync(file, backup);
    await appendRows(handle, 3, "b");
    const before = await anchorFile(file);
    handle.close();
    copyFileSync(backup, file);

    const accepted = await acceptOnFile("restored the 09:00 snapshot after the disk failed");
    expect(accepted.accepted).toBe(true);
    if (!accepted.accepted) return;
    expect(accepted.anchor.anchor).toMatchObject({ seq: 3, rebase: { supersededSeq: 6, supersededHeadHash: before?.anchor.headHash, acceptedBy: "owner-1" } });
    expect(verifyAnchorSignature(accepted.anchor, signer.publicKeyHex)).toBe(true);
    expect(verifyAnchorSignature({ ...accepted.anchor, anchor: { ...accepted.anchor.anchor, rebase: { ...accepted.anchor.anchor.rebase!, reason: "something else" } } }, signer.publicKeyHex)).toBe(false);

    const verified = await verifyFile(file);
    expect(verified.ok).toBe(true);
    const superseded = verified.findings.find((f) => f.verdict === AnchorVerdict.Superseded);
    expect(superseded?.detail).toContain("seq 6");
    expect(superseded?.detail).toContain("restored the 09:00 snapshot");

    handle = createSqliteAuditSink(file, { chainKey: CHAIN_KEY });
    await appendRows(handle, 2, "c");
    expect((await anchorFile(file))?.anchor.seq).toBe(5);
    expect((await verifyFile(file)).ok).toBe(true);
  });

  it("refuses to accept anything that is not a restore, or without a reason", async () => {
    await appendRows(handle, 3, "a");
    expect(await acceptOnFile("restored the 09:00 snapshot")).toMatchObject({ accepted: false, refusal: AcceptRestoreRefusal.NothingAnchored });
    await anchorFile(file);
    await appendRows(handle, 1, "b");
    expect(await acceptOnFile("restored the 09:00 snapshot")).toMatchObject({ accepted: false, refusal: AcceptRestoreRefusal.NothingToAccept });
    expect(await acceptOnFile("short")).toMatchObject({ accepted: false, refusal: AcceptRestoreRefusal.ReasonTooShort });
    expect(await sink.list(SCOPE, 10)).toHaveLength(1);
  });

  it("refuses to accept a restore over a live chain that does not verify", async () => {
    await appendRows(handle, 4, "a");
    await anchorFile(file);
    handle.db.exec("DROP TRIGGER audit_event_no_update");
    handle.db.prepare("UPDATE audit_event SET action = 'FORGED' WHERE id = 4").run();
    handle.db.pragma("wal_checkpoint(TRUNCATE)");
    handle.close();
    const result = await acceptOnFile("restored the 09:00 snapshot after the disk failed");
    expect(result.accepted).toBe(false);
    expect(await sink.list(SCOPE, 10)).toHaveLength(1);
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
      endpoint: "https://s3.test",
      credentials: async () => ({ accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" }),
      now: () => NOW,
      fetch: (async (url: string, init: RequestInit) => {
        if (init.method === "GET") return new URL(url).searchParams.get("list-type") ? new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>") : new Response("", { status: 404 });
        calls.push({ method: String(init.method), url, headers: init.headers as Record<string, string>, body: init.body ? Buffer.from(init.body as Uint8Array).toString("utf8") : undefined });
        return new Response("", { status: 200 });
      }) as unknown as typeof fetch,
    });
    const signed = signer.sign({ scope: SCOPE, seq: 42, headHash: "h42", anchoredAt: NOW.toISOString() });
    await s3.append(signed);
    calls.splice(0, calls.length, ...calls.filter((call) => call.method === "PUT"));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe("https://s3.test/backups/audit-anchors/T-1/latest.json");
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual({ seq: 42 });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe("https://s3.test/backups/audit-anchors/T-1/000000000042.json");
    expect(calls[0]?.headers["if-none-match"]).toBe("*");
    expect(calls[0]?.headers["authorization"]).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261017\/eu-south-1\/s3\/aws4_request, SignedHeaders=.*content-type.*host.*if-none-match.*, Signature=[0-9a-f]{64}$/);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual(signed);
  });

  it("treats a 412 (the object already exists) as already anchored but surfaces other failures", async () => {
    const answer = (status: number) =>
      createS3AuditAnchorSink({
        bucket: "b",
        region: "r",
      endpoint: "https://s3.test",
        credentials: async () => ({ accessKeyId: "k", secretAccessKey: "s" }),
        fetch: (async (_url: string, init: RequestInit) => init.method === "PUT" ? new Response("", { status }) : new URL(_url).searchParams.get("list-type") ? new Response("<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>") : new Response("", { status: 404 })) as unknown as typeof fetch,
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
      endpoint: "https://s3.test",
      credentials: async () => ({ accessKeyId: "k", secretAccessKey: "s" }),
      fetch: (async (url: string) => {
        const parsed = new URL(url);
        if (parsed.searchParams.get("list-type")) {
          return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${[...stored.keys()].map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`);
        }
        return new Response(stored.get(parsed.pathname.slice(3)) ?? "", { status: stored.has(parsed.pathname.slice(3)) ? 200 : 404 });
      }) as unknown as typeof fetch,
    });
    expect((await s3.list(SCOPE, 2)).map((s) => s.anchor.seq)).toEqual([2, 3]);
  });
});

describe("the newest anchor without reading the whole history", () => {
  function fakeS3(stored: Map<string, string>, requests: string[]) {
    return createS3AuditAnchorSink({
      bucket: "b",
      region: "r",
      endpoint: "https://s3.test",
      credentials: async () => ({ accessKeyId: "k", secretAccessKey: "s" }),
      fetch: (async (url: string, init: RequestInit) => {
        const parsed = new URL(url);
        const key = decodeURIComponent(parsed.pathname.slice(3));
        requests.push(`${init.method} ${parsed.searchParams.get("list-type") ? "LIST" : key}`);
        if (init.method === "PUT") {
          if (init.headers && (init.headers as Record<string, string>)["if-none-match"] && stored.has(key)) return new Response("", { status: 412 });
          stored.set(key, Buffer.from(init.body as Uint8Array).toString("utf8"));
          return new Response("", { status: 200 });
        }
        if (parsed.searchParams.get("list-type")) {
          const listed = [...stored.keys()].filter((k) => k.startsWith(parsed.searchParams.get("prefix") ?? ""));
          return new Response(`<ListBucketResult><IsTruncated>false</IsTruncated>${listed.map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`);
        }
        return new Response(stored.get(key) ?? "", { status: stored.has(key) ? 200 : 404 });
      }) as unknown as typeof fetch,
    });
  }
  const signedAt = (seq: number) => signer.sign({ scope: SCOPE, seq, headHash: `h${seq}`, anchoredAt: NOW.toISOString() });

  it("S3: reads the pointer and the one anchor it names, never listing the scope", async () => {
    const stored = new Map<string, string>();
    const s3 = fakeS3(stored, []);
    for (let seq = 1; seq <= 300; seq += 1) await s3.append(signedAt(seq));
    const requests: string[] = [];
    const reader = fakeS3(stored, requests);

    const latest = await reader.latest(SCOPE);

    expect(latest?.anchor.seq).toBe(300);
    expect(requests).toEqual(["GET audit-anchors/T-1/latest.json", "GET audit-anchors/T-1/000000000300.json"]);
  });

  it("S3: without a pointer lists once, finds the real newest anchor past the pointer object, and writes the pointer", async () => {
    const stored = new Map<string, string>();
    for (const seq of [1, 2, 3]) stored.set(`audit-anchors/T-1/${String(seq).padStart(12, "0")}.json`, JSON.stringify(signedAt(seq)));
    const requests: string[] = [];
    const s3 = fakeS3(stored, requests);

    expect((await s3.latest(SCOPE))?.anchor.seq).toBe(3);
    expect(JSON.parse(stored.get("audit-anchors/T-1/latest.json") ?? "")).toEqual({ seq: 3 });
    requests.length = 0;
    expect((await s3.latest(SCOPE))?.anchor.seq).toBe(3);
    expect(requests).not.toContain("GET LIST");
    expect(requests.some((r) => r.includes("LIST"))).toBe(false);
    expect((await s3.list(SCOPE, 10)).map((a) => a.anchor.seq)).toEqual([1, 2, 3]);
  });

  it("S3: a pointer naming an anchor that does not exist falls back to the listing instead of believing it", async () => {
    const stored = new Map<string, string>();
    for (const seq of [1, 2]) stored.set(`audit-anchors/T-1/${String(seq).padStart(12, "0")}.json`, JSON.stringify(signedAt(seq)));
    stored.set("audit-anchors/T-1/latest.json", JSON.stringify({ seq: 99 }));

    expect((await fakeS3(stored, []).latest(SCOPE))?.anchor.seq).toBe(2);
  });

  it("S3: no anchors at all is null", async () => {
    expect(await fakeS3(new Map(), []).latest(SCOPE)).toBeNull();
  });

  it("S3: an accepted restore opens an epoch, so the rebase and the anchors after it never collide with the superseded sequence numbers", async () => {
    const stored = new Map<string, string>();
    const s3 = fakeS3(stored, []);
    for (const seq of [2, 4, 6]) await s3.append(signedAt(seq));
    const rebaseAt = "2026-10-18T08:00:00.000Z";
    await s3.append(signer.sign({ scope: SCOPE, seq: 3, headHash: "restored-3", anchoredAt: rebaseAt, rebase: { supersededSeq: 6, supersededHeadHash: "h6", reason: "restored the 09:00 snapshot", acceptedBy: "owner-1" } }));
    expect((await s3.latest(SCOPE))?.anchor.seq).toBe(3);
    await s3.append(signer.sign({ scope: SCOPE, seq: 4, headHash: "restored-4", anchoredAt: NOW.toISOString() }));

    const epoch = `r${String(Date.parse(rebaseAt)).padStart(13, "0")}`;
    expect(stored.has(`audit-anchors/T-1/${epoch}/000000000003.json`)).toBe(true);
    expect(JSON.parse(stored.get(`audit-anchors/T-1/${epoch}/000000000004.json`) ?? "{}").anchor.headHash).toBe("restored-4");
    expect(JSON.parse(stored.get("audit-anchors/T-1/000000000004.json") ?? "{}").anchor.headHash).toBe("h4");

    const fresh = fakeS3(stored, []);
    expect((await fresh.latest(SCOPE))?.anchor.headHash).toBe("restored-4");
    stored.delete("audit-anchors/T-1/latest.json");
    expect((await fakeS3(stored, []).latest(SCOPE))?.anchor.headHash).toBe("restored-4");
    expect((await fresh.list(SCOPE, 10)).map((a) => a.anchor.headHash)).toEqual(["h2", "h4", "h6", "restored-3", "restored-4"]);
  });

  it("file: reads the tail of a long file, skipping a torn last line", async () => {
    for (let seq = 1; seq <= 120; seq += 1) await sink.append(signedAt(seq));
    writeFileSync(path.join(dir, "anchors", `${SCOPE}.jsonl`), "{not json\n", { flag: "a" });

    expect((await sink.latest(SCOPE))?.anchor.seq).toBe(120);
    expect(await sink.latest("T-none")).toBeNull();
  });
});

describe("signing key rotation", () => {
  const retired = createAuditAnchorSigner(OTHER_SEED);

  it("a retired key's anchors still verify when it is trusted, and are forged when it is not", async () => {
    const old = retired.sign({ scope: SCOPE, seq: 3, headHash: "h3", anchoredAt: NOW.toISOString() });
    const chain = { head: () => ({ rowId: 3, rowHash: "h3" }), rowHashAt: (id: number) => `h${id}` };

    const trusted = await verifyAgainstAnchors({ scope: SCOPE, chain, anchors: [old], publicKeyHex: signer.publicKeyHex, trustedPublicKeys: [retired.publicKeyHex], verifyChain: false });
    const untrusted = await verifyAgainstAnchors({ scope: SCOPE, chain, anchors: [old], publicKeyHex: signer.publicKeyHex, verifyChain: false });

    expect(trusted.ok).toBe(true);
    expect(untrusted.findings.map((f) => f.verdict)).toContain(AnchorVerdict.AnchorsForged);
  });

  it("the new key extends a chain whose newest anchor the retired key signed, but only while the retired key is trusted", async () => {
    const old = retired.sign({ scope: SCOPE, seq: 1, headHash: "h1", anchoredAt: NOW.toISOString() });
    const input = { scope: SCOPE, head: { rowId: 2, rowHash: "h2" }, rowHashAt: (id: number) => `h${id}`, latest: old, sink, now: () => NOW };

    const refused = await anchorHead({ ...input, signer });
    const extended = await anchorHead({ ...input, signer: createAuditAnchorSigner(SEED, [retired.publicKeyHex]) });

    expect(refused.outcome).toBe(AnchorOutcome.Refused);
    expect(extended.outcome).toBe(AnchorOutcome.Anchored);
    expect(extended.anchor?.anchor.keyId).toBe(signer.keyId);
  });
});
