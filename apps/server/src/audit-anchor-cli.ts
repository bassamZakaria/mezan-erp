import { existsSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openAuditChainFile } from "@mezan/persistence";
import {
  acceptRestore,
  AnchorVerdict,
  createAuditAnchorSigner,
  createFileAuditAnchorSink,
  verifyAgainstAnchors,
  type AnchorVerification,
  type AuditAnchorSink,
} from "./audit-anchor.js";
import { createS3AuditAnchorSink } from "./audit-anchor-s3.js";
import { parseAuditAnchor } from "./env.js";

export enum VerifyExit {
  Verified = 0,
  Failure = 1,
  Tampering = 2,
}

const ANCHORS_CHECKED = 200;

const USAGE = `usage: tsx apps/server/src/audit-anchor-cli.ts verify --db <database file> --scope <tenant id | platform> [--public-key <hex>] [--skip-chain]
       tsx apps/server/src/audit-anchor-cli.ts accept-restore --db <database file> --scope <tenant id | platform> --reason "<why this snapshot was restored>" --actor <who accepts it>

accept-restore signs a REBASE anchor after a legitimate restore of an older snapshot: the anchor job then resumes, and
verify keeps reporting the superseded history (SUPERSEDED_BY_RESTORE) beside the restored chain. It refuses unless
the job is refusing that chain as a rollback or rewrite, and the live chain verifies. Needs MEZAN_AUDIT_ANCHOR_SIGNING_KEY.
Run it against the restored database itself, with the server stopped, so the head it signs is the head that will be served.

Run it against a COPY of the database made with \`sqlite3 <live file> ".backup copy.db"\`
or \`VACUUM INTO 'copy.db'\` (or with the server stopped). Copying only the .sqlite file of a
database in WAL mode drops the newest rows and reports a false ROLLED_BACK; the tool refuses a
database with a non-empty -wal file beside it. Reads MEZAN_AUDIT_ANCHOR_* from the environment to
find the anchor store. Needs the chain key (MEZAN_AUDIT_CHAIN_KEY or the
original audit-chain.key beside the file).
Exit: 0 verified / accepted, 1 could not run or refused, 2 tampering found (rollback, rewrite, broken chain, forged anchors).`;

const WAL_REFUSAL =
  "قاعدة البيانات لها ملف -wal غير فارغ بجانبها: نسخ ملف .sqlite وحده يُسقط أحدث الصفوف ويُظهر ROLLED_BACK كاذبًا. أنشئ نسخة بالأمر sqlite3 .backup أو VACUUM INTO ثم أعد التشغيل.\n" +
  "The database has a non-empty -wal file beside it: copying only the .sqlite file loses the newest rows and reports a false ROLLED_BACK. Make the copy with sqlite3 .backup or VACUUM INTO and run again.";

export function hasPendingWal(db: string): boolean {
  const wal = `${db}-wal`;
  return existsSync(wal) && statSync(wal).size > 0;
}

function argOf(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function trustedKeysFrom(env: Record<string, string | undefined>): readonly string[] {
  return parseAuditAnchor(env).trustedPublicKeys ?? [];
}

function publicKeyHexFrom(env: Record<string, string | undefined>, explicit: string | undefined): string {
  const given = explicit ?? env["MEZAN_AUDIT_ANCHOR_PUBLIC_KEY"]?.trim();
  if (given) return given.toLowerCase();
  const seed = env["MEZAN_AUDIT_ANCHOR_SIGNING_KEY"]?.trim();
  if (seed) return createAuditAnchorSigner(seed).publicKeyHex;
  throw new Error("set MEZAN_AUDIT_ANCHOR_PUBLIC_KEY (or pass --public-key): anchors cannot be checked without it");
}

function sinkFrom(env: Record<string, string | undefined>): AuditAnchorSink {
  const config = parseAuditAnchor(env);
  if (config.s3) return createS3AuditAnchorSink(config.s3);
  if (config.dir) return createFileAuditAnchorSink(config.dir);
  throw new Error("set MEZAN_AUDIT_ANCHOR_S3_BUCKET (or MEZAN_AUDIT_ANCHOR_DIR for the local file store)");
}

export function renderVerification(result: AnchorVerification): string {
  const lines = [
    `scope ${result.scope}: ${result.ok ? "VERIFIED" : "NOT VERIFIED"}`,
    `  anchors checked: ${result.anchorsChecked}, latest anchored seq: ${result.latestAnchoredSeq ?? "none"}, live head seq: ${result.liveHeadSeq ?? "none"}`,
    ...result.findings.map((f) => `  ${f.verdict}: ${f.detail}`),
  ];
  return lines.join("\n");
}

export function exitCodeOf(result: AnchorVerification): VerifyExit {
  if (result.ok) return VerifyExit.Verified;
  const onlyMissing = result.findings.every((f) => f.verdict === AnchorVerdict.NoAnchors);
  return onlyMissing ? VerifyExit.Failure : VerifyExit.Tampering;
}

async function acceptRestoreCommand(db: string, scope: string, args: readonly string[], env: Record<string, string | undefined>): Promise<VerifyExit> {
  const reason = argOf(args, "--reason");
  const actor = argOf(args, "--actor");
  if (!reason || !actor) {
    console.error(USAGE);
    return VerifyExit.Failure;
  }
  if (hasPendingWal(db)) {
    console.error(WAL_REFUSAL);
    return VerifyExit.Failure;
  }
  const seed = env["MEZAN_AUDIT_ANCHOR_SIGNING_KEY"]?.trim();
  if (!seed) {
    console.error("accept-restore signs an anchor: set MEZAN_AUDIT_ANCHOR_SIGNING_KEY");
    return VerifyExit.Failure;
  }
  const signer = createAuditAnchorSigner(seed, trustedKeysFrom(env));
  const sink = sinkFrom(env);
  const reader = openAuditChainFile(db);
  try {
    const result = await acceptRestore({
      scope,
      head: reader.head(),
      rowHashAt: (rowId) => reader.rowHashAt(rowId),
      signer,
      latest: await sink.latest(scope),
      sink,
      now: () => new Date(),
      reason,
      acceptedBy: `cli:${actor}`,
      verifyChain: () => reader.verify(),
    });
    if (!result.accepted) {
      console.error(`scope ${scope}: restore NOT accepted — ${result.refusal}: ${result.reason}`);
      return VerifyExit.Failure;
    }
    console.log(
      `scope ${scope}: restore accepted — rebase anchor at seq ${result.anchor.anchor.seq} supersedes seq ${result.superseded.seq} (${result.superseded.headHash}), anchored at ${result.anchor.anchor.anchoredAt}`,
    );
    return VerifyExit.Verified;
  } finally {
    reader.close();
  }
}

export async function main(args: readonly string[], env: Record<string, string | undefined> = process.env): Promise<VerifyExit> {
  const db = argOf(args, "--db");
  const scope = argOf(args, "--scope");
  if (args[0] === "accept-restore" && db && scope) return acceptRestoreCommand(db, scope, args, env);
  if (args[0] !== "verify" || !db || !scope) {
    console.error(USAGE);
    return VerifyExit.Failure;
  }
  if (hasPendingWal(db)) {
    console.error(WAL_REFUSAL);
    return VerifyExit.Failure;
  }
  const reader = openAuditChainFile(db);
  try {
    const publicKeyHex = publicKeyHexFrom(env, argOf(args, "--public-key"));
    if (!/^[0-9a-f]{64}$/.test(publicKeyHex)) throw new Error("the public key must be 64 hex characters");
    const anchors = await sinkFrom(env).list(scope, ANCHORS_CHECKED);
    const result = await verifyAgainstAnchors({ scope, chain: reader, anchors, publicKeyHex, trustedPublicKeys: trustedKeysFrom(env), verifyChain: !args.includes("--skip-chain") });
    console.log(renderVerification(result));
    return exitCodeOf(result);
  } finally {
    reader.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(VerifyExit.Failure);
    },
  );
}
