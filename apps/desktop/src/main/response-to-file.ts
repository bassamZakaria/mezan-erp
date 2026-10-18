import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { BridgeFetchResult } from "./backend-bridge.js";

/**
 * Streams a successful response body to `filePath` and hands back only its
 * status and headers; an error response comes back whole (bounded by
 * `maxErrorBytes`) so the caller can show its message. A partial file is
 * removed when the copy fails.
 */
export async function writeResponseToFile(response: Response, filePath: string, maxErrorBytes: number): Promise<BridgeFetchResult> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  if (!response.ok || response.body === null) {
    const body = new Uint8Array(await response.arrayBuffer());
    return { status: response.status, headers, body: body.byteLength > maxErrorBytes ? new Uint8Array(0) : body };
  }
  try {
    await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), createWriteStream(filePath));
  } catch (err) {
    await unlink(filePath).catch(() => undefined);
    throw err;
  }
  return { status: response.status, headers, body: new Uint8Array(0) };
}
