import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PLATFORM_OWNER_EMAIL, PLATFORM_OWNER_PASSWORD, TENANT_DOMAIN, TRUSTED_PROXY_HOPS } from "./env";

export interface ServerHandle {
  stop(): Promise<void>;
}

export interface ApiServerOptions {
  readonly port: number;
  readonly platformDir: string;
  readonly seedDemo: boolean;
  readonly fakeToday?: string;
  readonly bootTimeoutMs?: number;
}

export interface WebServerOptions {
  readonly port: number;
  readonly apiUrl: string;
}

enum Signal {
  Terminate = "SIGTERM",
  Kill = "SIGKILL",
}

export enum RunDir {
  Platform = "mezan-saas-e2e-platform-",
  Clock = "mezan-saas-e2e-clock-",
  Demo = "mezan-saas-e2e-demo-",
}

const RUN_DIR_NAME = new RegExp(`^(?:${Object.values(RunDir).join("|")})[A-Za-z0-9]{6}$`);
const ABANDONED_AFTER_MS = 6 * 60 * 60_000;

export function newRunDir(kind: RunDir): string {
  return mkdtempSync(path.join(tmpdir(), kind));
}

export function removeAbandonedRunDirs(): void {
  for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !RUN_DIR_NAME.test(entry.name)) continue;
    const dir = path.join(tmpdir(), entry.name);
    try {
      if (Date.now() - statSync(dir).mtimeMs > ABANDONED_AFTER_MS) rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== NO_SUCH_ENTRY) throw error;
    }
  }
}

const LOOPBACK = "127.0.0.1";
export const BOOT_TIMEOUT_MS = 300_000;
export const DEMO_BOOT_TIMEOUT_MS = 600_000;
const STOP_TIMEOUT_MS = 10_000;
const PORT_PROBE_TIMEOUT_MS = 1_000;
const POLL_MS = 250;
const NO_SUCH_PROCESS = "ESRCH";
const NO_SUCH_ENTRY = "ENOENT";
const OUTPUT_TAIL_CHARS = 4000;

export const API_SERVER_COMMAND = "pnpm exec tsx apps/server/src/index.ts";

export function apiServerEnv(options: ApiServerOptions): Record<string, string> {
  const env: Record<string, string> = {
    PORT: String(options.port),
    MEZAN_PLATFORM_DIR: options.platformDir,
    MEZAN_PLATFORM_OWNER_EMAIL: PLATFORM_OWNER_EMAIL,
    MEZAN_PLATFORM_OWNER_PASSWORD: PLATFORM_OWNER_PASSWORD,
    MEZAN_SEED_DEMO: options.seedDemo ? "1" : "0",
    MEZAN_PAYMOB_TEST_MODE: "1",
    MEZAN_TENANT_DOMAIN: TENANT_DOMAIN,
    MEZAN_TRUST_PROXY: "1",
    MEZAN_TRUSTED_PROXY_HOPS: String(TRUSTED_PROXY_HOPS),
    MEZAN_BACKUP_INTERVAL_MINUTES: "0",
  };
  if (options.fakeToday) env["MEZAN_FAKE_TODAY"] = options.fakeToday;
  return env;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: LOOPBACK, port });
    const settle = (answers: boolean) => {
      socket.destroy();
      resolve(answers);
    };
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}

async function assertPortFree(port: number): Promise<void> {
  if (await portAnswers(port)) {
    throw new Error(`port ${port} is already answering — refusing to adopt a server this suite did not start`);
  }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function signalOwnGroup(child: ChildProcess, signal: Signal): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== NO_SUCH_PROCESS) throw error;
  }
}

async function portReleased(port: number): Promise<boolean> {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await portAnswers(port))) return true;
    await wait(POLL_MS);
  }
  return false;
}

async function stopChild(child: ChildProcess, port: number): Promise<void> {
  if (child.pid === undefined) return;
  if (!hasExited(child)) {
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    signalOwnGroup(child, Signal.Terminate);
    const stoppedInTime = await Promise.race([exited.then(() => true), wait(STOP_TIMEOUT_MS).then(() => false)]);
    if (!stoppedInTime) {
      signalOwnGroup(child, Signal.Kill);
      await exited;
    }
  }
  if (await portReleased(port)) return;
  signalOwnGroup(child, Signal.Kill);
  if (!(await portReleased(port))) throw new Error(`port ${port} is still answering after its server was stopped`);
}

interface Launched {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly failure: () => Error | null;
}

function launch(command: string, args: readonly string[], cwd: string, env: Record<string, string>): Launched {
  let tail = "";
  const keep = (data: Buffer) => {
    tail = (tail + data.toString()).slice(-OUTPUT_TAIL_CHARS);
  };
  let failure: Error | null = null;
  // detached: the child leads its own process group, which is the only group stopChild ever signals.
  const child = spawn(command, [...args], { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", (error) => {
    failure = error;
  });
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  return { child, output: () => tail, failure: () => failure };
}

async function waitUntilUp(url: string, launched: Launched, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const failure = launched.failure();
    if (failure) throw new Error(`server for ${url} could not be started: ${failure.message}`);
    if (hasExited(launched.child)) {
      throw new Error(`server for ${url} exited with ${launched.child.exitCode ?? launched.child.signalCode}\n${launched.output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await wait(POLL_MS);
      continue;
    }
    await wait(POLL_MS);
  }
  throw new Error(`server for ${url} did not come up in ${timeoutMs}ms\n${launched.output()}`);
}

async function start(port: number, healthUrl: string, launchServer: () => Launched, timeoutMs = BOOT_TIMEOUT_MS): Promise<ServerHandle> {
  await assertPortFree(port);
  const launched = launchServer();
  try {
    await waitUntilUp(healthUrl, launched, timeoutMs);
  } catch (error) {
    await stopChild(launched.child, port);
    throw error;
  }
  return { stop: () => stopChild(launched.child, port) };
}

export function startApiServer(options: ApiServerOptions): Promise<ServerHandle> {
  const [command, ...args] = API_SERVER_COMMAND.split(" ") as [string, ...string[]];
  return start(options.port, `http://${LOOPBACK}:${options.port}/healthz`, () => launch(command, args, process.cwd(), apiServerEnv(options)), options.bootTimeoutMs);
}

export function startWebServer(options: WebServerOptions): Promise<ServerHandle> {
  return start(options.port, `http://${LOOPBACK}:${options.port}/`, () =>
    launch(
      "pnpm",
      ["exec", "vite", "--config", "vite.saas.config.ts", "--port", String(options.port), "--strictPort", "--host", LOOPBACK],
      `${process.cwd()}/apps/web`,
      { MEZAN_API_URL: options.apiUrl },
    ),
  );
}
