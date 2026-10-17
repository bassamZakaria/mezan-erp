import { createHash, createHmac } from "node:crypto";
import { parseSignedAnchor, assertSafeScope, type AuditAnchorSink, type SignedAuditAnchor } from "./audit-anchor.js";

const SEQ_DIGITS = 12;
const LATEST_POINTER = "latest.json";
const ANCHOR_KEY = /\/\d{12}\.json$/;
const LIST_PAGE_KEYS = 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const ECS_CREDENTIALS_HOST = "http://169.254.170.2";

export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

export type S3CredentialSource = () => Promise<S3Credentials>;

export interface S3AuditAnchorSinkOptions {
  readonly bucket: string;
  readonly region: string;
  readonly prefix?: string;
  /** Path-style endpoint override for S3-compatible stores and tests. */
  readonly endpoint?: string;
  readonly credentials?: S3CredentialSource;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export function envCredentialSource(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): S3CredentialSource {
  let cached: { creds: S3Credentials; expiresAt: number } | null = null;
  return async () => {
    const accessKeyId = env["AWS_ACCESS_KEY_ID"];
    const secretAccessKey = env["AWS_SECRET_ACCESS_KEY"];
    if (accessKeyId && secretAccessKey) {
      return { accessKeyId, secretAccessKey, ...(env["AWS_SESSION_TOKEN"] ? { sessionToken: env["AWS_SESSION_TOKEN"] } : {}) };
    }
    const relative = env["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"];
    if (!relative) throw new Error("no AWS credentials: set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY or run under an ECS task role");
    if (cached && cached.expiresAt - Date.now() > 60_000) return cached.creds;
    const res = await fetchImpl(`${ECS_CREDENTIALS_HOST}${relative}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`the ECS credentials endpoint answered ${res.status}`);
    const body = (await res.json()) as { AccessKeyId: string; SecretAccessKey: string; Token?: string; Expiration?: string };
    const creds: S3Credentials = { accessKeyId: body.AccessKeyId, secretAccessKey: body.SecretAccessKey, ...(body.Token ? { sessionToken: body.Token } : {}) };
    cached = { creds, expiresAt: body.Expiration ? Date.parse(body.Expiration) : Date.now() + 5 * 60_000 };
    return creds;
  };
}

const sha256Hex = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data, "utf8").digest();
const encodeSegment = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export function anchorObjectKey(prefix: string, scope: string, seq: number): string {
  assertSafeScope(scope);
  return `${prefix}/${scope}/${String(seq).padStart(SEQ_DIGITS, "0")}.json`;
}

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
  const endpoint = options.endpoint?.replace(/\/+$/, "");
  const host = endpoint ? new URL(endpoint).host : `${options.bucket}.s3.${options.region}.amazonaws.com`;
  const origin = endpoint ?? `https://${host}`;
  const pathPrefix = endpoint ? `/${options.bucket}` : "";

  async function signedFetch(method: string, objectKey: string, query: Record<string, string>, body: Buffer | null, extra: Record<string, string> = {}): Promise<Response> {
    const creds = await credentials();
    const stamp = now().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = stamp.slice(0, 8);
    const payloadHash = sha256Hex(body ?? "");
    const headers: Record<string, string> = { host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp, ...extra };
    if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;
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

  // The pointer only names a sequence; the anchor object it names stays the authority, so a stale,
  // forged or missing pointer can cost a full listing but never change what is believed.
  async function pointTo(scope: string, seq: number): Promise<void> {
    const res = await signedFetch("PUT", `${prefix}/${scope}/${LATEST_POINTER}`, {}, Buffer.from(JSON.stringify({ seq }), "utf8"), { "content-type": "application/json" });
    if (!res.ok) throw new Error(`S3 PutObject of the latest pointer answered ${res.status}`);
  }

  async function newestByListing(scope: string): Promise<SignedAuditAnchor | null> {
    const newest = (await listKeys(scope)).at(-1);
    return newest === undefined ? null : anchorAt(newest);
  }

  return {
    async append(signed: SignedAuditAnchor) {
      const key = anchorObjectKey(prefix, signed.anchor.scope, signed.anchor.seq);
      const res = await signedFetch("PUT", key, {}, Buffer.from(JSON.stringify(signed), "utf8"), {
        "content-type": "application/json",
        "if-none-match": "*",
      });
      if (res.status !== 412 && !res.ok) throw new Error(`S3 PutObject of ${key} answered ${res.status}`);
      await pointTo(signed.anchor.scope, signed.anchor.seq).catch(() => undefined);
    },
    async latest(scope) {
      assertSafeScope(scope);
      const pointer = await signedFetch("GET", `${prefix}/${scope}/${LATEST_POINTER}`, {}, null);
      if (pointer.ok) {
        const seq = ((await pointer.json().catch(() => null)) as { seq?: unknown } | null)?.seq;
        if (typeof seq === "number" && Number.isInteger(seq) && seq >= 0) {
          const named = await anchorAt(anchorObjectKey(prefix, scope, seq));
          if (named) return named;
        }
      } else if (pointer.status !== 404) {
        throw new Error(`S3 GetObject of the latest pointer answered ${pointer.status}`);
      }
      const found = await newestByListing(scope);
      if (found) await pointTo(scope, found.anchor.seq).catch(() => undefined);
      return found;
    },
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
