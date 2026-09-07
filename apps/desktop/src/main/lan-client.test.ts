import { createServer, type Server } from "node:https";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { connectBudgetMs, createLanClient, LanClientError, MAX_RESPONSE_BYTES } from "./lan-client.js";
import { loadOrCreateLanTlsIdentity, type LanTlsIdentity } from "./lan-tls.js";
import type { ClientConfig } from "./client-config.js";

/**
 * The client's pin, tested against a REAL TLS server presenting a REAL
 * self-signed certificate — because the whole of this defence is one comparison
 * against a value that only exists once a handshake has happened, and a test
 * that stubbed the socket would assert the comparison and not the thing it
 * protects.
 *
 * The case that matters most is the second one: a client pointed at the wrong
 * machine must send NOTHING. Every request this transport carries has either a
 * PIN in its body (`/auth/login`) or a bearer token in its headers, so a pin
 * check that ran after the write would hand the shop's credentials to whoever
 * answered before deciding it was the wrong machine.
 */
const scratchDirs: string[] = [];
const servers: Server[] = [];

async function identityIn(name: string): Promise<LanTlsIdentity> {
  const dir = await mkdtemp(path.join(tmpdir(), `mezan-pin-${name}-`));
  scratchDirs.push(dir);
  return loadOrCreateLanTlsIdentity(path.join(dir, "mezan.db"));
}

afterAll(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((r) => server.close(() => r()));
  for (const dir of scratchDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Seen {
  readonly bodies: string[];
  readonly paths: string[];
}

async function startServer(tls: LanTlsIdentity): Promise<{ port: number; seen: Seen }> {
  const bodies: string[] = [];
  const paths: string[] = [];
  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      bodies.push(body);
      paths.push(req.url ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, saw: req.url }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { port, seen: { bodies, paths } };
}

function configFor(port: number, fingerprintSha256: string): ClientConfig {
  return {
    hostUrl: `https://127.0.0.1:${port}`,
    fingerprintSha256,
    deviceId: "DEVICE-TEST",
    deviceLabel: "جهاز اختبار",
  };
}

describe("the client only talks to the machine it was paired with", () => {
  it("forwards the request when the certificate is the pinned one", async () => {
    const tls = await identityIn("good");
    const { port, seen } = await startServer(tls);
    const forward = createLanClient({ config: configFor(port, tls.fingerprintSha256) });

    const res = await forward("/sales-invoices?page=2", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, saw: "/sales-invoices?page=2" });
    // The query string travels. It carries every list filter the shell sets.
    expect(seen.paths).toEqual(["/sales-invoices?page=2"]);
    expect(seen.bodies).toEqual([JSON.stringify({ hello: "world" })]);
  });

  it("sends NOTHING to a machine whose certificate is not the pinned one", async () => {
    const real = await identityIn("real");
    const impostor = await identityIn("impostor");
    // The impostor answers on the address the client was told to dial. It has a
    // perfectly valid certificate; it is simply not the one a human compared.
    const { port, seen } = await startServer(impostor);
    const forward = createLanClient({ config: configFor(port, real.fingerprintSha256) });

    const failure = await forward("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "owner@shop.example", pin: "481923" }),
    }).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(LanClientError);
    expect((failure as LanClientError).code).toBe("PIN_MISMATCH");
    // THE ASSERTION THIS FILE EXISTS FOR: the owner's PIN never left the machine.
    expect(seen.bodies).toEqual([]);
    expect(seen.paths).toEqual([]);
  });

  it("says the host is unreachable rather than hanging when nothing is listening", async () => {
    const tls = await identityIn("closed");
    const { port } = await startServer(tls);
    await new Promise<void>((r) => servers.pop()!.close(() => r()));

    const forward = createLanClient({ config: configFor(port, tls.fingerprintSha256) });
    const failure = await forward("/health", {}).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(LanClientError);
    expect((failure as LanClientError).code).toBe("UNREACHABLE");
  });

  // guards N-3: the renderer renders `code`, keyed into the Arabic catalog with
  // `{host}` — not the English sentence, which names a millisecond count.
  it("carries the code and the host on every failure, and the presented certificate on a mismatch", async () => {
    const real = await identityIn("codes-real");
    const impostor = await identityIn("codes-impostor");
    const { port } = await startServer(impostor);
    const forward = createLanClient({ config: configFor(port, real.fingerprintSha256) });

    const failure = (await forward("/health", {}).catch((err: unknown) => err)) as LanClientError;

    expect(failure.code).toBe("PIN_MISMATCH");
    expect(failure.host).toBe(`https://127.0.0.1:${port}`);
    // The value a human has to compare against the host's own screen. Without
    // it the re-pair screen can only show one of the two fingerprints.
    expect(failure.presentedFingerprint).toBe(impostor.fingerprintSha256);
    expect(failure.presentedFingerprint).not.toBe(real.fingerprintSha256);
  });

  // guards N-10: one handshake per CONNECTION, not per request. Ten requests
  // used to be ten RSA handshakes on the host's single-threaded main process.
  it("reuses one TLS connection across requests", async () => {
    const tls = await identityIn("keepalive");
    let handshakes = 0;
    const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ saw: req.url }));
    });
    server.on("secureConnection", () => {
      handshakes += 1;
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const forward = createLanClient({ config: configFor(port, tls.fingerprintSha256) });
    for (let i = 0; i < 5; i += 1) {
      const res = await forward(`/health?n=${i}`, {});
      expect(res.status).toBe(200);
    }

    expect(handshakes).toBe(1);
  });

  // guards N-3: a person in front of a login screen must be told something in
  // seconds. Thirty seconds of a frozen button reads as a crashed app, and it
  // is the one moment when "the host is off" is both the likeliest answer and
  // the easiest to act on.
  //
  // Asserted on the RULE rather than on a stopwatch: Node's `socket.setTimeout`
  // does not fire in this repo's vitest environment, so a test that waited on a
  // stalled handshake would be asserting the environment.
  it("gives the sign-in path a far shorter budget than a data request", () => {
    expect(connectBudgetMs("/auth/login")).toBe(5_000);
    // The two reads the login screen makes before anybody has signed in.
    expect(connectBudgetMs("/tenant")).toBe(5_000);
    expect(connectBudgetMs("/health")).toBe(5_000);
    // A report the host is genuinely computing must not be abandoned because
    // it took six seconds.
    expect(connectBudgetMs("/reports/trial-balance")).toBe(30_000);
    expect(connectBudgetMs("/sales-invoices")).toBe(30_000);
  });

  // guards Q-7 — a 37–51 MB response used to be buffered whole, decoded to a
  // JS string and copied again crossing IPC. The host answering here writes
  // MORE than the 8 MB limit; the client must stop pulling bytes off the
  // socket and refuse rather than build that string.
  it("refuses a response over the 8 MB limit instead of buffering and forwarding it", async () => {
    const tls = await identityIn("oversized");
    const chunk = "a".repeat(1024 * 1024);
    const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const bytesToSend = MAX_RESPONSE_BYTES + chunk.length;
      let sent = 0;
      const pump = (): void => {
        while (sent < bytesToSend) {
          if (!res.write(chunk)) {
            res.once("drain", pump);
            return;
          }
          sent += chunk.length;
        }
        res.end();
      };
      pump();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const forward = createLanClient({ config: configFor(port, tls.fingerprintSha256) });
    const response = await forward("/inventory/ledger", {});

    expect(response.status).toBe(413);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body["error"]).toBe("RESPONSE_TOO_LARGE");
    expect(body["message"]).toBe(
      "النتيجة كبيرة جداً على النقل. ضيّق نطاق التاريخ أو الفلتر ثم أعد المحاولة.",
    );
  });
});
