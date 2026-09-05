import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, by hand, for exactly the three requests online
 * backup makes: PUT an object, LIST a prefix, DELETE an object.
 *
 * WHY NOT THE SDK. `@aws-sdk/client-s3` is tens of megabytes of transitive
 * dependency for three verbs, and it lands inside a desktop bundle that ships
 * to shop counters. SigV4 is a documented, stable, pure function of
 * (request, key, time); the whole of it is below, it has published test vectors,
 * and it is unit-tested against them (s3-signer.test.ts). That is a better trade
 * here than an SDK nobody in this repo can audit.
 *
 * DELIBERATELY NOT GENERAL. It signs `s3` in one region with a payload whose
 * SHA-256 the caller has already computed, and it does not do chunked or
 * streaming signatures, presigned URLs, or STS session tokens. A general
 * implementation would be a much larger thing to get right and none of it is
 * needed. If a destination ever requires a session token, add `x-amz-security-token`
 * to the signed headers — do not reach for the SDK for one header.
 */
export interface SignInput {
  readonly method: "PUT" | "GET" | "DELETE";
  /** Full URL, already encoded. Its host and path are what get signed. */
  readonly url: URL;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Hex SHA-256 of the exact bytes being sent; `EMPTY_PAYLOAD_SHA256` for GET/DELETE. */
  readonly payloadSha256: string;
  /** Signing time. Injected so the test vectors are reproducible. */
  readonly now: Date;
  /** Extra headers to sign, lower-cased keys. */
  readonly extraHeaders?: Record<string, string>;
}

export const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** `20260905T114233Z` — the format every part of SigV4 agrees on. */
function amzDate(now: Date): string {
  return `${now.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * Canonical URI: each path segment percent-encoded, `/` left alone. S3 signs
 * the encoded form, and a key containing a space or an Arabic character signs
 * differently from the way it is written — which is why this is not just
 * `url.pathname`.
 */
function canonicalUri(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function canonicalQuery(url: URL): string {
  const entries = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export interface SignedRequest {
  readonly headers: Record<string, string>;
}

export function signS3Request(input: SignInput): SignedRequest {
  const stamp = amzDate(input.now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${input.region}/s3/aws4_request`;

  const headers: Record<string, string> = {
    host: input.url.host,
    "x-amz-content-sha256": input.payloadSha256,
    "x-amz-date": stamp,
    ...(input.extraHeaders ?? {}),
  };

  const signedHeaderNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames
    .map((name) => `${name}:${String(headers[name] ?? "").trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    input.method,
    canonicalUri(input.url.pathname),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    input.payloadSha256,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, date), input.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    headers: {
      ...headers,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
