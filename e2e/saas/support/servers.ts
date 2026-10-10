import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import { PLATFORM_OWNER_EMAIL, PLATFORM_OWNER_PASSWORD, TENANT_DOMAIN } from "./env";

export interface ServerHandle {
  stop(): Promise<void>;
}

export interface ApiServerOptions {
  readonly port: number;
  readonly platformDir: string;
  readonly seedDemo: boolean;
  readonly fakeToday?: string;
}

export interface WebServerOptions {
  readonly port: number;
  readonly apiUrl: string;
}

enum Signal {
  Terminate = "SIGTERM",
  Kill = "SIGKILL",
}

const LOOPBACK = "127.0.0.1";
const BOOT_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 10_000;
const PORT_PROBE_TIMEOUT_MS = 1_000;
const POLL_MS = 250;
const NO_SUCH_PROCESS = "ESRCH";

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

async function stopChild(child: ChildProcess): Promise<void> {
  if (hasExited(child) || child.pid === undefined) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  signalOwnGroup(child, Signal.Terminate);
  const stoppedInTime = await Promise.race([exited.then(() => true), wait(STOP_TIMEOUT_MS).then(() => false)]);
  if (stoppedInTime) return;
  signalOwnGroup(child, Signal.Kill);
  await exited;
}

interface Launched {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly failure: () => Error | null;
}

function launch(command: string, args: readonly string[], cwd: string, env: Record<string, string>): Launched {
  const chunks: string[] = [];
  let failure: Error | null = null;
  // detached: the child leads its own process group, which is the only group stopChild ever signals.
  const child = spawn(command, [...args], { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", (error) => {
    failure = error;
  });
  child.stdout?.on("data", (data: Buffer) => chunks.push(data.toString()));
  child.stderr?.on("data", (data: Buffer) => chunks.push(data.toString()));
  return { child, output: () => chunks.join("").slice(-4000), failure: () => failure };
}

async function waitUntilUp(url: string, launched: Launched): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
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
  throw new Error(`server for ${url} did not come up in ${BOOT_TIMEOUT_MS}ms\n${launched.output()}`);
}

async function start(port: number, healthUrl: string, launchServer: () => Launched): Promise<ServerHandle> {
  await assertPortFree(port);
  const launched = launchServer();
  try {
    await waitUntilUp(healthUrl, launched);
  } catch (error) {
    await stopChild(launched.child);
    throw error;
  }
  return { stop: () => stopChild(launched.child) };
}

export function startApiServer(options: ApiServerOptions): Promise<ServerHandle> {
  const [command, ...args] = API_SERVER_COMMAND.split(" ") as [string, ...string[]];
  return start(options.port, `http://${LOOPBACK}:${options.port}/healthz`, () => launch(command, args, process.cwd(), apiServerEnv(options)));
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
