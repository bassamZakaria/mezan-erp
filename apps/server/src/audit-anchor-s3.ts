import { createHash, createHmac } from "node:crypto";
import { parseSignedAnchor, assertSafeScope, type AuditAnchorSink, type SignedAuditAnchor } from "./audit-anchor.js";

const SEQ_DIGITS = 12;
const LATEST_POINTER = "latest.json";
const ANCHOR_KEY = /\/(?:r\d{13}\/)?\d{12}\.json$/;
const EPOCH_DIGITS = 13;
const EPOCH_OF_KEY = /\/(r\d{13})\/\d{12}\.json$/;
const LIST_PAGE_KEYS = 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export type S3CredentialSource = () => Promise<S3Credentials>;

export interface S3AuditAnchorSinkOptions {
  readonly bucket: string;
  readonly region: string;
  readonly prefix?: string;
  readonly endpoint: string;
  readonly credentials?: S3CredentialSource;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

const ACCESS_KEY_VAR = "MEZAN_AUDIT_ANCHOR_S3_ACCESS_KEY_ID";
const SECRET_KEY_VAR = "MEZAN_AUDIT_ANCHOR_S3_SECRET_ACCESS_KEY";

export function envCredentialSource(env: Record<string, string | undefined> = process.env): S3CredentialSource {
  return async () => {
    const accessKeyId = env[ACCESS_KEY_VAR] || env["AWS_ACCESS_KEY_ID"];
    const secretAccessKey = env[SECRET_KEY_VAR] || env["AWS_SECRET_ACCESS_KEY"];
    if (!accessKeyId || !secretAccessKey) throw new Error(`no object-storage credentials: set ${ACCESS_KEY_VAR} and ${SECRET_KEY_VAR}`);
    return { accessKeyId, secretAccessKey };
  };
}

const sha256Hex = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest();
const encodeSegment = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// EXTERNAL CONTRACT: anchors before any accepted restore live at <scope>/<seq>.json; an accepted restore opens an epoch
// <scope>/r<13-digit ms>/ holding the rebase and every anchor after it. Keys sort lexically into the order they were written.
export function anchorObjectKey(prefix: string, scope: string, seq: number, epoch: string | null = null): string {
  assertSafeScope(scope);
  return `${prefix}/${scope}/${epoch ? `${epoch}/` : ""}${String(seq).padStart(SEQ_DIGITS, "0")}.json`;
}

export function rebaseEpochOf(anchoredAt: string): string {
  return `r${String(Date.parse(anchoredAt)).padStart(EPOCH_DIGITS, "0")}`;
}

const epochOfKey = (key: string): string | null => EPOCH_OF_KEY.exec(key)?.[1] ?? null;

/**
 * One immutable object per anchor, written with `If-None-Match: *` so an
 * existing key is never replaced even when the bucket has no Object Lock. Works
 * unchanged with or without Object Lock; with it (compliance mode, a default
 * retention) the same PUT is also undeletable by the account that wrote it.
 */
export function createS3AuditAnchorSink(options: S3AuditAnchorSinkOptions): AuditAnchorSink {
  const prefix = (options.prefix ?? "audit-anchors").replace(/^\/+|\/+$/g, "");
  const credentials = options.credentials ?? envCredentialSource();
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const endpoint = options.endpoint.replace(/\/+$/, "");
  const host = new URL(endpoint).host;
  const origin = endpoint;
  const pathPrefix = `/${options.bucket}`;

  async function signedFetch(method: string, objectKey: string, query: Record<string, string>, body: Buffer | null, extra: Record<string, string> = {}): Promise<Response> {
    const creds = await credentials();
    const stamp = now().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = stamp.slice(0, 8);
    const payloadHash = sha256Hex(body ?? "");
    const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp, ...extra };
    const names = Object.keys(headers).sort();
    const canonicalPath = `${pathPrefix}/${objectKey.split("/").map(encodeSegment).join("/")}`.replace(/\/$/, "") || "/";
    const canonicalQuery = Object.keys(query)
      .sort()
      .map((k) => `${encodeSegment(k)}=${encodeSegment(query[k] as string)}`)
      .join("&");
    const canonicalRequest = [
      method,
      canonicalPath,
      canonicalQuery,
      names.map((n) => `${n}:${headers[n]!.trim()}\n`).join(""),
      names.join(";"),
      payloadHash,
    ].join("\n");
    const scope = `${date}/${options.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, date), options.region), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(toSign, "utf8").digest("hex");
    const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
    const { host: _host, ...sendable } = headers;
    return doFetch(`${origin}${canonicalPath}${canonicalQuery ? `?${canonicalQuery}` : ""}`, {
      method,
      headers: { ...sendable, authorization },
      ...(body ? { body: new Uint8Array(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async function listKeys(scope: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const res = await signedFetch(
        "GET",
        "",
        {
          "list-type": "2",
          prefix: `${prefix}/${scope}/`,
          "max-keys": String(LIST_PAGE_KEYS),
          ...(token ? { "continuation-token": token } : {}),
        },
        null,
      );
      if (!res.ok) throw new Error(`S3 ListObjectsV2 answered ${res.status}`);
      const xml = await res.text();
      for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) if (ANCHOR_KEY.test(match[1] as string)) keys.push(match[1] as string);
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] : undefined;
    } while (token);
    return keys.sort();
  }

  async function anchorAt(key: string): Promise<SignedAuditAnchor | null> {
    const res = await signedFetch("GET", key, {}, null);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 GetObject of ${key} answered ${res.status}`);
    return parseSignedAnchor((await res.json()) as unknown);
  }

  // The pointer only names a sequence (and its epoch); the anchor object it names stays the authority, so a
  // missing pointer costs a full listing, and a stale one names an older anchor — which makes the job refuse
  // loudly, never anchor something it should not.
  async function pointTo(scope: string, seq: number, epoch: string | null): Promise<void> {
    const body = epoch ? { seq, epoch } : { seq };
    const res = await signedFetch("PUT", `${prefix}/${scope}/${LATEST_POINTER}`, {}, Buffer.from(JSON.stringify(body), "utf8"), { "content-type": "application/json" });
    if (!res.ok) throw new Error(`S3 PutObject of the latest pointer answered ${res.status}`);
  }

  const epochs = new Map<string, string | null>();

  async function newestByListing(scope: string): Promise<SignedAuditAnchor | null> {
    const newest = (await listKeys(scope)).at(-1);
    if (newest === undefined) return null;
    const found = await anchorAt(newest);
    if (found) epochs.set(scope, epochOfKey(newest));
    return found;
  }

  async function latestOf(scope: string): Promise<SignedAuditAnchor | null> {
    assertSafeScope(scope);
    const pointer = await signedFetch("GET", `${prefix}/${scope}/${LATEST_POINTER}`, {}, null);
    if (pointer.ok) {
      const named = (await pointer.json().catch(() => null)) as { seq?: unknown; epoch?: unknown } | null;
      const seq = named?.seq;
      const epoch = typeof named?.epoch === "string" && /^r\d{13}$/.test(named.epoch) ? named.epoch : null;
      if (typeof seq === "number" && Number.isInteger(seq) && seq >= 0) {
        const anchor = await anchorAt(anchorObjectKey(prefix, scope, seq, epoch));
        if (anchor) {
          epochs.set(scope, epoch);
          return anchor;
        }
      }
    } else if (pointer.status !== 404) {
      throw new Error(`S3 GetObject of the latest pointer answered ${pointer.status}`);
    }
    const found = await newestByListing(scope);
    if (found) await pointTo(scope, found.anchor.seq, epochs.get(scope) ?? null).catch(() => undefined);
    return found;
  }

  return {
    async append(signed: SignedAuditAnchor) {
      const scope = signed.anchor.scope;
      if (!signed.anchor.rebase && !epochs.has(scope)) await latestOf(scope);
      const epoch = signed.anchor.rebase ? rebaseEpochOf(signed.anchor.anchoredAt) : (epochs.get(scope) ?? null);
      const key = anchorObjectKey(prefix, scope, signed.anchor.seq, epoch);
      const res = await signedFetch("PUT", key, {}, Buffer.from(JSON.stringify(signed), "utf8"), {
        "content-type": "application/json",
        "if-none-match": "*",
      });
      if (res.status !== 412 && !res.ok) throw new Error(`S3 PutObject of ${key} answered ${res.status}`);
      epochs.set(scope, epoch);
      await pointTo(scope, signed.anchor.seq, epoch).catch(() => undefined);
    },
    latest: latestOf,
    async list(scope, limit) {
      assertSafeScope(scope);
      const keys = (await listKeys(scope)).slice(-limit);
      const anchors: SignedAuditAnchor[] = [];
      for (const key of keys) {
        const res = await signedFetch("GET", key, {}, null);
        if (!res.ok) throw new Error(`S3 GetObject of ${key} answered ${res.status}`);
        const parsed = parseSignedAnchor((await res.json()) as unknown);
        if (parsed) anchors.push(parsed);
      }
      return anchors;
    },
  };
}
