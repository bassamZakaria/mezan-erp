import { createServer } from "node:http";
import { handleCheckin, handleHealth, type CheckinServiceDeps } from "./service.js";

/**
 * The socket around `service.ts`, on `node:http` and nothing else.
 *
 * It is a dozen routes short of a framework because it is two routes long. The
 * process that holds the vendor signing key should have as little in it as the
 * job allows; a dependency tree here is a supply chain attached to the secret
 * that mints every licence.
 *
 * Run it behind a TLS terminator (Caddy, nginx, a platform router) — this
 * listens on plain HTTP, deliberately, so the certificate is the operator's to
 * manage and never this process's.
 *
 *   MEZAN_LICENSE_PRIVATE_KEY=<hex> \
 *   MEZAN_REVOCATIONS=/var/lib/mezan/revocations.json \
 *   pnpm --filter @mezan/licence-server start
 */

const privateKey = (process.env["MEZAN_LICENSE_PRIVATE_KEY"] ?? "").trim();
const deps: CheckinServiceDeps = {
  privateKey,
  revocationsPath: process.env["MEZAN_REVOCATIONS"] ?? "revocations.json",
};

if (privateKey.length !== 64) {
  console.error(
    "MEZAN_LICENSE_PRIVATE_KEY must be the 32-byte Ed25519 seed as 64 hex characters " +
      "(pnpm licence:keygen). Refusing to start: an unsigned answer is worse than no answer.",
  );
  process.exit(1);
}

const port = Number(process.env["PORT"] ?? 8787);
const host = process.env["HOST"] ?? "127.0.0.1";

function send(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && url.pathname === "/health") {
    const answer = handleHealth(deps);
    send(res, answer.status, answer.body);
    return;
  }
  if (req.method !== "POST" || url.pathname !== "/checkin") {
    send(res, 404, { error: "NOT_FOUND" });
    return;
  }

  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    // A check-in body is two short strings. Anything larger is not one.
    if (size > 4096) {
      send(res, 413, { error: "TOO_LARGE" });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      send(res, 400, { error: "BAD_REQUEST" });
      return;
    }
    handleCheckin(body as never, deps)
      .then((answer) => send(res, answer.status, answer.body))
      .catch(() => send(res, 500, { error: "INTERNAL" }));
  });
}).listen(port, host, () => {
  console.log(`[licence-server] listening on http://${host}:${port} (POST /checkin, GET /health)`);
});
