import { createServer, type Server } from "node:https";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { syncBackupToRemote, uploadBackup } from "./remote-backup.js";
import { remoteBackupConfigSchema } from "./remote-config.js";
import { loadOrCreateLanTlsIdentity } from "../main/lan-tls.js";

/**
 * A real HTTPS server standing in for the bucket, because the parts most likely
 * to be wrong are the ones a mocked `https.request` cannot show: whether the
 * signed headers actually go out, whether the body arrives byte-for-byte, and
 * whether a failed upload leaves the remote copies alone.
 */
const dirs: string[] = [];
const servers: Server[] = [];

afterAll(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mezan-remote-"));
  dirs.push(dir);
  return dir;
}

interface Seen {
  readonly puts: { key: string; body: Buffer; auth: string }[];
  readonly deletes: string[];
}

async function bucket(options: { putStatus?: number; keys?: string[] } = {}) {
  const dir = await scratch();
  const tls = await loadOrCreateLanTlsIdentity(path.join(dir, "mezan.db"));
  const seen: Seen = { puts: [], deletes: [] };

  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const url = req.url ?? "";
      if (req.method === "PUT") {
        seen.puts.push({
          key: url,
          body: Buffer.concat(chunks),
          auth: String(req.headers["authorization"] ?? ""),
        });
        res.writeHead(options.putStatus ?? 200).end();
        return;
      }
      if (req.method === "GET") {
        const body =
          `<ListBucketResult>` +
          (options.keys ?? []).map((k) => `<Contents><Key>${k}</Key></Contents>`).join("") +
          `</ListBucketResult>`;
        res.writeHead(200, { "content-type": "application/xml" }).end(body);
        return;
      }
      if (req.method === "DELETE") {
        seen.deletes.push(url);
        res.writeHead(204).end();
        return;
      }
      res.writeHead(400).end();
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;

  const config = remoteBackupConfigSchema.parse({
    endpoint: `https://127.0.0.1:${port}`,
    region: "eu-central-1",
    bucket: "mezan-shop",
    prefix: "cyag",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    keep: 2,
  });
  return { config, seen, dir };
}

async function archive(dir: string, name: string, contents = "ENCRYPTED-ARCHIVE-BYTES"): Promise<string> {
  const file = path.join(dir, name);
  await writeFile(file, contents);
  return file;
}

describe("online backup", () => {
  // Self-signed cert, and this is a test server we minted ourselves.
  const original = process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";
  afterAll(() => {
    if (original === undefined) delete process.env["NODE_TLS_REJECT_UNAUTHORIZED"];
    else process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = original;
  });

  it("uploads the archive's exact bytes to the prefixed key, signed", async () => {
    const { config, seen, dir } = await bucket();
    const file = await archive(dir, "mezan-backup-2026-09-05T04-42-45-714Z.mezanbak");

    const result = await uploadBackup(config, file);

    expect(result.ok).toBe(true);
    expect(seen.puts).toHaveLength(1);
    expect(seen.puts[0]!.key).toBe(
      "/mezan-shop/cyag/mezan-backup-2026-09-05T04-42-45-714Z.mezanbak",
    );
    expect(seen.puts[0]!.body.toString()).toBe("ENCRYPTED-ARCHIVE-BYTES");
    expect(seen.puts[0]!.auth).toContain("AWS4-HMAC-SHA256 Credential=AK/");
  });

  it("reports a refusal instead of throwing, so the local backup still stands", async () => {
    const { config, dir } = await bucket({ putStatus: 403 });
    const file = await archive(dir, "a.mezanbak");

    const result = await uploadBackup(config, file);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  it("never throws when the destination is unreachable", async () => {
    const { config, dir } = await bucket();
    const file = await archive(dir, "a.mezanbak");
    const dead = { ...config, endpoint: "https://127.0.0.1:1" };

    const result = await uploadBackup(dead, file);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  /**
   * The rule that keeps a bad network from destroying history: retention is a
   * consequence of a NEW copy arriving, never of a failed attempt.
   */
  it("prunes the oldest remote copies only after the upload succeeded", async () => {
    const { config, seen, dir } = await bucket({
      keys: ["cyag/a.mezanbak", "cyag/b.mezanbak", "cyag/c.mezanbak", "cyag/d.mezanbak"],
    });
    const file = await archive(dir, "e.mezanbak");

    const outcome = await syncBackupToRemote(config, file);

    expect(outcome.uploaded.ok).toBe(true);
    // keep = 2, four listed → the two oldest go.
    expect(outcome.pruned).toEqual(["cyag/a.mezanbak", "cyag/b.mezanbak"]);
    expect(seen.deletes).toHaveLength(2);
  });

  it("deletes nothing when the upload failed", async () => {
    const { config, seen, dir } = await bucket({
      putStatus: 500,
      keys: ["cyag/a.mezanbak", "cyag/b.mezanbak", "cyag/c.mezanbak"],
    });
    const file = await archive(dir, "e.mezanbak");

    const outcome = await syncBackupToRemote(config, file);

    expect(outcome.uploaded.ok).toBe(false);
    expect(outcome.pruned).toEqual([]);
    expect(seen.deletes).toEqual([]);
  });
});
