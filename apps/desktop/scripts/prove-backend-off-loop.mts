import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { BACKEND_BRIDGE_PROTOCOL, type BackendBootPayload } from "../src/main/backend-bridge.js";

/**
 * THE MEASUREMENT BEHIND Q-1 (docs/artifacts/audit-2026-09-07.md §4.4), run
 * both ways.
 *
 *     pnpm --filter desktop prove:off-loop [--mb 88]
 *
 * The audit measured a `VACUUM INTO` on an 88 MB database at 1,129 ms with ZERO
 * event-loop ticks in the Electron main process — the loop that also draws the
 * window, answers the LAN socket, runs the updater and drives the backup
 * schedule. One slow report froze the host UI and every till at once.
 *
 * This reproduces that number (phase 1), then runs the SAME call behind the
 * bridge that now carries every backend request (phase 2) and counts the ticks
 * the calling process got while it ran. Phase 3 boots the REAL backend worker
 * — the shipped one, `src/main/backend-worker.ts` — over the same protocol and
 * measures the loop while it serves a burst of real requests, so the proof is
 * not merely of a mechanism but of the thing that ships.
 *
 * The worker is forked as a plain Node child rather than as an Electron
 * `utilityProcess`; it speaks the same protocol over either transport
 * (src/main/backend-bridge.ts), which is what makes this runnable at all.
 */

const HERE = fileURLToPath(import.meta.url);
const WORKER = path.join(path.dirname(HERE), "..", "src", "main", "backend-worker.ts");

/* ------------------------------------------------------------------ child */

if (process.argv.includes("--vacuum-child")) {
  process.on("message", (job: { readonly id: number; readonly from: string; readonly to: string }) => {
    const db = new Database(job.from, { readonly: true });
    try {
      db.exec(`VACUUM INTO '${job.to.replace(/'/gu, "''")}'`);
      process.send?.({ id: job.id, ok: true });
    } catch (err) {
      process.send?.({ id: job.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      db.close();
    }
  });
} else {
  await main();
}

/* ----------------------------------------------------------------- parent */

interface Measurement {
  readonly label: string;
  readonly ms: number;
  readonly ticks: number;
}

/**
 * Counts how many times a 1 ms timer actually fired while `work` ran.
 *
 * This is the audit's own instrument: a synchronously blocked loop cannot run a
 * timer at all, so the tick count is zero no matter how long the block lasted.
 */
async function measure(label: string, work: () => Promise<void> | void): Promise<Measurement> {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
  }, 1);
  const started = process.hrtime.bigint();
  await work();
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  clearInterval(timer);
  return { label, ms: Math.round(ms), ticks };
}

function report(m: Measurement): void {
  console.log(
    `  ${m.label.padEnd(52)} ${String(m.ms).padStart(6)} ms   ` +
      `${String(m.ticks).padStart(6)} event-loop ticks`,
  );
}

function buildDatabase(file: string, megabytes: number): void {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE bulk (id INTEGER PRIMARY KEY, payload BLOB NOT NULL)");
  const insert = db.prepare("INSERT INTO bulk (payload) VALUES (?)");
  const chunk = Buffer.alloc(64 * 1024, 7);
  const rows = Math.ceil((megabytes * 1024 * 1024) / chunk.byteLength);
  const fill = db.transaction(() => {
    for (let i = 0; i < rows; i += 1) insert.run(chunk);
  });
  fill();
  db.close();
}

function callChild(child: ChildProcess, message: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (reply: Record<string, unknown>): void => {
      child.off("message", onMessage);
      if (reply["ok"] === false) reject(new Error(String(reply["error"] ?? "worker failed")));
      else resolve(reply);
    };
    child.on("message", onMessage);
    child.send(message as never);
  });
}

async function main(): Promise<void> {
  const mbFlag = process.argv.indexOf("--mb");
  const megabytes = mbFlag === -1 ? 88 : Number(process.argv[mbFlag + 1] ?? 88);

  const dir = mkdtempSync(path.join(tmpdir(), "mezan-off-loop-"));
  const source = path.join(dir, "source.db");

  try {
    console.log(`\nBuilding a ${megabytes} MB SQLite database in ${dir} …`);
    buildDatabase(source, megabytes);
    const actualMb = (statSync(source).size / (1024 * 1024)).toFixed(1);
    console.log(`Built: ${actualMb} MB\n`);

    console.log("Q-1, before — the synchronous call on the caller's own loop:");
    report(
      await measure("VACUUM INTO, in this process", () => {
        const db = new Database(source, { readonly: true });
        db.exec(`VACUUM INTO '${path.join(dir, "copy-inline.db")}'`);
        db.close();
      }),
    );

    console.log("\nQ-1, after — the same call behind the bridge:");
    const vacuumChild = fork(HERE, ["--vacuum-child"], {
      execArgv: ["--import", "tsx"],
      serialization: "advanced",
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    try {
      report(
        await measure("VACUUM INTO, in the worker process", async () => {
          await callChild(vacuumChild, { id: 1, from: source, to: path.join(dir, "copy-bridged.db") });
        }),
      );
    } finally {
      vacuumChild.kill();
    }

    console.log("\nThe shipped worker — src/main/backend-worker.ts, real requests:");
    const backend = fork(WORKER, [], {
      execArgv: ["--import", "tsx"],
      serialization: "advanced",
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    try {
      const boot: BackendBootPayload = {
        protocol: BACKEND_BRIDGE_PROTOCOL,
        dbPath: ":memory:",
        cipherKey: null,
        entitlements: { plan: "dev", activeModules: [], features: {}, seats: 2, expiresAt: null },
        applyEntitlements: false,
        licence: {
          entitlements: { plan: "dev", activeModules: [], features: {}, seats: 2, expiresAt: null },
          state: { state: "ACTIVE", canWrite: true, usable: true },
          verified: false,
          identity: {
            licenseId: null,
            fingerprint: null,
            notBefore: null,
            expiresAt: null,
            graceDays: null,
          },
        },
        userDataDir: dir,
        installedAt: null,
        env: { MEZAN_PACKAGED: "0", MEZAN_APP_VERSION: "0.0.0-proof", MEZAN_SCHEMA_VERSION: "1" },
      };

      const booted = await measure("createBackend + seed, in the worker process", async () => {
        await new Promise<void>((resolve, reject) => {
          const onMessage = (message: { type?: string; error?: string }): void => {
            if (message.type === "ready") {
              backend.off("message", onMessage);
              resolve();
            } else if (message.type === "boot-error") {
              backend.off("message", onMessage);
              reject(new Error(message.error));
            }
          };
          backend.on("message", onMessage);
          backend.send(boot);
        });
      });
      report(booted);

      let id = 0;
      const pending = new Map<number, (value: unknown) => void>();
      backend.on("message", (message: { id?: number }) => {
        if (typeof message.id === "number") pending.get(message.id)?.(message);
      });
      const request = (url: string): Promise<unknown> => {
        const callId = (id += 1);
        return new Promise((resolve) => {
          pending.set(callId, resolve);
          backend.send({
            id: callId,
            call: { op: "fetch", url, method: "GET", headers: {}, body: null, remoteAddress: null },
          });
        });
      };

      report(
        await measure("500 × GET /accounts, over the bridge", async () => {
          await Promise.all(
            Array.from({ length: 500 }, () => request("http://mezan.local/accounts")),
          );
        }),
      );
    } finally {
      backend.kill();
    }

    console.log(
      "\nA blocked loop cannot run a timer at all, so the first line's tick count is the\n" +
        "finding: the process was unavailable for the whole of it. Every line below it\n" +
        "kept ticking while the same database work happened elsewhere.\n",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
