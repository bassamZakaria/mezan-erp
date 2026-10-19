import path from "node:path";
import { createAuditAnchorSigner, createFileAuditAnchorSink, type AuditAnchorSigner, type AuditAnchorSink } from "./audit-anchor.js";
import { createS3AuditAnchorSink } from "./audit-anchor-s3.js";
import type { AuditAnchorEnv } from "./env.js";

export enum AnchorSinkKind {
  S3 = "s3",
  LocalFile = "local-file",
}

export interface AuditAnchorService {
  readonly signer: AuditAnchorSigner;
  readonly sink: AuditAnchorSink;
  readonly sinkKind: AnchorSinkKind;
  readonly intervalMs: number;
  /** The folder of the local anchor files; null when anchors are kept off the server. */
  readonly localDir: string | null;
}

export function createAuditAnchorService(config: AuditAnchorEnv | undefined, platformDir: string): AuditAnchorService | null {
  if (config === undefined || config.intervalMinutes === 0 || config.signingKey === undefined) return null;
  const signer = createAuditAnchorSigner(config.signingKey, config.trustedPublicKeys);
  const intervalMs = config.intervalMinutes * 60_000;
  if (config.s3) {
    return {
      signer,
      intervalMs,
      sinkKind: AnchorSinkKind.S3,
      localDir: null,
      sink: createS3AuditAnchorSink({ bucket: config.s3.bucket, region: config.s3.region, prefix: config.s3.prefix, endpoint: config.s3.endpoint }),
    };
  }
  const localDir = config.dir ?? path.join(platformDir, "audit-anchors");
  return { signer, intervalMs, sinkKind: AnchorSinkKind.LocalFile, localDir, sink: createFileAuditAnchorSink(localDir) };
}
