import { spawn, type ChildProcess } from "node:child_process";
import { PLATFORM_OWNER_EMAIL, PLATFORM_OWNER_PASSWORD } from "./env";

export interface ServerHandle {
  stop(): Promise<void>;
}

export interface ApiServerOptions {
  readonly port: number;
  readonly platformDir: string;
  readonly fakeToday?: string;
}

export interface WebServerOptions {
  readonly port: number;
  readonly apiUrl: string;
}

const BOOT_TIMEOUT_MS = 120_000;
const POLL_MS = 250;

async function waitUntilUp(url: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server for ${url} exited with ${child.exitCode}\n${output()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`server for ${url} did not come up in ${BOOT_TIMEOUT_MS}ms\n${output()}`);
}

function launch(command: string, args: readonly string[], cwd: string, env: Record<string, string>): { child: ChildProcess; output: () => string } {
  const chunks: string[] = [];
  const child = spawn(command, [...args], { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (data: Buffer) => chunks.push(data.toString()));
  child.stderr?.on("data", (data: Buffer) => chunks.push(data.toString()));
  return { child, output: () => chunks.join("").slice(-4000) };
}

function handleFor(child: ChildProcess): ServerHandle {
  return {
    async stop() {
      if (child.exitCode !== null || child.pid === undefined) return;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      process.kill(-child.pid, "SIGTERM");
      await exited;
    },
  };
}

export async function startApiServer(options: ApiServerOptions): Promise<ServerHandle> {
  const env: Record<string, string> = {
    PORT: String(options.port),
    MEZAN_PLATFORM_DIR: options.platformDir,
    MEZAN_PLATFORM_OWNER_EMAIL: PLATFORM_OWNER_EMAIL,
    MEZAN_PLATFORM_OWNER_PASSWORD: PLATFORM_OWNER_PASSWORD,
    MEZAN_BACKUP_INTERVAL_MINUTES: "0",
    MEZAN_SEED_DEMO: "0",
  };
  if (options.fakeToday) env["MEZAN_FAKE_TODAY"] = options.fakeToday;
  const { child, output } = launch("pnpm", ["exec", "tsx", "apps/server/src/index.ts"], process.cwd(), env);
  await waitUntilUp(`http://127.0.0.1:${options.port}/healthz`, child, output);
  return handleFor(child);
}

export async function startWebServer(options: WebServerOptions): Promise<ServerHandle> {
  const { child, output } = launch(
    "pnpm",
    ["exec", "vite", "--config", "vite.saas.config.ts", "--port", String(options.port), "--strictPort", "--host", "127.0.0.1"],
    `${process.cwd()}/apps/web`,
    { MEZAN_API_URL: options.apiUrl },
  );
  await waitUntilUp(`http://127.0.0.1:${options.port}/`, child, output);
  return handleFor(child);
}
