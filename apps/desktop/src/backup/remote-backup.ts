import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { EMPTY_PAYLOAD_SHA256, sha256Hex, signS3Request } from "./s3-signer.js";
import type { RemoteBackupConfig } from "./remote-config.js";

/**
 * Sending a finished `.mezanbak` off the machine.
 *
 * READ THE HEADER OF remote-config.ts BEFORE CHANGING ANYTHING HERE. These
 * archives carry no key, by decision, so this protects a shop from ransomware,
 * a wiped disk and a fire — and NOT from losing the machine. Nothing here should
 * ever grow a code path that uploads the key.
 *
 * EVERY FAILURE IS NON-FATAL. A shop with no internet, an expired bucket
 * credential or a full bucket must still take its LOCAL backups exactly as
 * before; the online copy is an addition, never a precondition. So this module
 * returns outcomes and logs them, and the one thing it must never do is throw
 * into the backup scheduler and stop the local copy being written.
 */
export interface RemoteUploadResult {
  readonly ok: boolean;
  readonly key: string;
  readonly status?: number;
  readonly error?: string;
}

/** Upload timeout. A slow 4G link is normal here; a hang is not. */
const REQUEST_TIMEOUT_MS = 120_000;

function objectUrl(config: RemoteBackupConfig, key: string): URL {
  const base = config.endpoint.replace(/\/+$/, "");
  return new URL(`${base}/${config.bucket}/${key}`);
}

function remoteKey(config: RemoteBackupConfig, fileName: string): string {
  const prefix = config.prefix.replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${fileName}` : fileName;
}

interface RawResponse {
  readonly status: number;
  readonly body: string;
}

function send(
  method: "PUT" | "GET" | "DELETE",
  url: URL,
  headers: Record<string, string>,
  body?: Buffer,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        method,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        headers: body ? { ...headers, "content-length": String(body.byteLength) } : headers,
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`timed out after ${REQUEST_TIMEOUT_MS}ms`));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

export type PresignResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly error: string };

/**
 * Asks the vendor endpoint for a short-lived URL to upload ONE archive to.
 *
 * The endpoint is expected to answer `{ "url": "https://..." }`. It decides the
 * key, the expiry and the bucket — none of which this machine gets a say in,
 * which is the point: a compromised shop PC can ask for an upload URL and
 * nothing else.
 */
export async function requestPresignedUpload(
  config: { presignEndpoint: string; token: string },
  fileName: string,
): Promise<PresignResult> {
  try {
    const url = new URL(config.presignEndpoint);
    const body = Buffer.from(JSON.stringify({ fileName }), "utf8");
    const res = await send(
      "PUT",
      url,
      {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body,
    );
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, error: `presign endpoint answered HTTP ${res.status}: ${res.body.slice(0, 200)}` };
    }
    const parsed = JSON.parse(res.body) as { url?: unknown };
    if (typeof parsed.url !== "string" || !parsed.url.startsWith("https://")) {
      return { ok: false, error: "presign endpoint did not return an https url" };
    }
    return { ok: true, url: parsed.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * PUTs an archive to a URL that was signed somewhere else.
 *
 * THE PREFERRED PATH, and the reason it exists: signing on the machine means a
 * long-lived bucket credential in a file on every shop counter, and one stolen
 * laptop is then the whole bucket — every shop in it. Here the vendor mints a
 * URL scoped to one method, one key and a few minutes; this process holds no
 * secret at all, and a copied URL is worthless once it expires.
 *
 * No signing happens here on purpose. If this function ever needs the secret
 * key, the design has gone backwards.
 */
export async function uploadToPresignedUrl(
  presignedUrl: string,
  filePath: string,
): Promise<RemoteUploadResult> {
  const key = path.basename(filePath);
  try {
    const url = new URL(presignedUrl);
    if (url.protocol !== "https:") {
      return { ok: false, key, error: "presigned URL is not https — refusing to send the books in clear" };
    }
    const body = await readFile(filePath);
    const res = await send("PUT", url, { "content-type": "application/octet-stream" }, body);
    if (res.status >= 200 && res.status < 300) return { ok: true, key, status: res.status };
    return { ok: false, key, status: res.status, error: res.body.slice(0, 400) };
  } catch (err) {
    return { ok: false, key, error: err instanceof Error ? err.message : String(err) };
  }
}

/** PUTs one finished archive. The whole file is read into memory — see the note. */
export async function uploadBackup(
  config: RemoteBackupConfig,
  filePath: string,
  now: Date = new Date(),
): Promise<RemoteUploadResult> {
  const fileName = path.basename(filePath);
  const key = remoteKey(config, fileName);
  try {
    /*
     * Buffered, not streamed, and that is a real limit rather than an
     * oversight: SigV4 needs the payload's SHA-256 up front, and the streaming
     * variant of the signature is a different, chunked protocol this signer
     * deliberately does not implement. A shop's archive is single-digit to low
     * tens of megabytes; if that ever stops being true, add chunked signing —
     * do not quietly stop hashing the payload.
     */
    const body = await readFile(filePath);
    const url = objectUrl(config, key);
    const signed = signS3Request({
      method: "PUT",
      url,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      payloadSha256: sha256Hex(body),
      now,
      extraHeaders: { "content-type": "application/octet-stream" },
    });
    const res = await send("PUT", url, signed.headers, body);
    if (res.status >= 200 && res.status < 300) return { ok: true, key, status: res.status };
    return { ok: false, key, status: res.status, error: res.body.slice(0, 400) };
  } catch (err) {
    return { ok: false, key, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Object keys already in the bucket under this shop's prefix, oldest first. */
export async function listRemoteBackups(
  config: RemoteBackupConfig,
  now: Date = new Date(),
): Promise<string[]> {
  const base = config.endpoint.replace(/\/+$/, "");
  const url = new URL(`${base}/${config.bucket}`);
  url.searchParams.set("list-type", "2");
  const prefix = config.prefix.replace(/^\/+|\/+$/g, "");
  if (prefix) url.searchParams.set("prefix", `${prefix}/`);

  const signed = signS3Request({
    method: "GET",
    url,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    payloadSha256: EMPTY_PAYLOAD_SHA256,
    now,
  });
  const res = await send("GET", url, signed.headers);
  if (res.status < 200 || res.status >= 300) return [];
  // The archive name carries an ISO timestamp, so lexical order IS chronological
  // order — see backup-service.ts `backupFileName`.
  return [...res.body.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!).sort();
}

export async function deleteRemoteBackup(
  config: RemoteBackupConfig,
  key: string,
  now: Date = new Date(),
): Promise<boolean> {
  const url = objectUrl(config, key.replace(new RegExp(`^${config.bucket}/`), ""));
  const signed = signS3Request({
    method: "DELETE",
    url,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    payloadSha256: EMPTY_PAYLOAD_SHA256,
    now,
  });
  const res = await send("DELETE", url, signed.headers);
  return res.status >= 200 && res.status < 300;
}

export interface RemoteSyncOutcome {
  readonly uploaded: RemoteUploadResult;
  readonly pruned: string[];
}

/**
 * Upload one archive, then trim the remote copies to `keep`.
 *
 * RETENTION RUNS ONLY AFTER A SUCCESSFUL UPLOAD, deliberately. Pruning first —
 * or pruning when the upload failed — is how a shop ends up with fewer online
 * backups than it had before, because the network was down. The remote copy
 * count only ever decreases as a consequence of a new one arriving.
 */
export async function syncBackupToRemote(
  config: RemoteBackupConfig,
  filePath: string,
  now: Date = new Date(),
): Promise<RemoteSyncOutcome> {
  const uploaded = await uploadBackup(config, filePath, now);
  if (!uploaded.ok) return { uploaded, pruned: [] };

  const keys = await listRemoteBackups(config, now).catch(() => [] as string[]);
  const excess = keys.slice(0, Math.max(0, keys.length - config.keep));
  const pruned: string[] = [];
  for (const key of excess) {
    if (await deleteRemoteBackup(config, key, now).catch(() => false)) pruned.push(key);
  }
  return { uploaded, pruned };
}
