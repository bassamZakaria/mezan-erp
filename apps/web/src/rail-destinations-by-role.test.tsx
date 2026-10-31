// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { SHELL_REQUESTS } from "@mezan/domain";
import { AppProviders } from "./data/AppProviders";
import { sessionHolds, type Session } from "./data/session";
import type { Transport } from "./data/transport";
import { NAV_ITEM_ACCESS, navGroupSpecs } from "./nav-config";
import { routes } from "./router/routes";
import { routePathForScreen } from "./routing";

interface SeededWorld {
  readonly backend: { readonly app: { fetch(request: Request): Response | Promise<Response> } };
  request(method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }>;
  close(): void;
}

// The seeded backend is loaded by path at run time: this package does not depend on the server, and its typecheck must not reach into it.
const SEEDED_WORLD = decodeURIComponent(new URL("../../../packages/backend/src/test-helpers/seeded-world.ts", import.meta.url).pathname);

const SEED_PASSWORD = "Cyag@2026";
const REFUSED_FROM = 400;
const QUIET_MS = 120;
const SETTLE_TIMEOUT_MS = 20_000;
const ONLY_USER = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RAIL_WALK_USER;
const SERVED_BY_THE_PLATFORM: ReadonlySet<string> = new Set(Object.values(SHELL_REQUESTS).filter((gate) => !gate.servedByTenant).map((gate) => gate.path));
const EVERY_PERMISSION_PROBE = "rail-walk.a-code-only-an-administrator-holds";

interface SeededUser {
  readonly email: string;
  readonly status: string;
  readonly roleId: string | null;
}

interface Opened {
  readonly refused: string[];
  readonly errorBlocks: string[];
}

let world: SeededWorld;
let users: SeededUser[];

const destinations = navGroupSpecs.flatMap((group) => [...(group.itemKeys ?? []), ...(group.sections ?? []).flatMap((section) => section.itemKeys)]);

beforeAll(async () => {
  const { seededWorld } = (await import(/* @vite-ignore */ SEEDED_WORLD)) as { seededWorld(): Promise<SeededWorld> };
  world = await seededWorld();
  users = (await world.request("GET", "/users")).body as unknown as SeededUser[];
}, 900_000);

afterAll(() => world?.close());

async function signIn(email: string): Promise<Session> {
  const res = await world.backend.app.fetch(new Request("http://local/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: email, password: SEED_PASSWORD }) }));
  expect(res.status, `${email} signs in`).toBe(200);
  return (await res.json()) as Session;
}

function offeredTo(session: Session): string[] {
  return destinations.filter((key) => {
    const permission = NAV_ITEM_ACCESS[key]?.permission;
    return permission === undefined || sessionHolds(session, permission);
  });
}

async function open(session: Session, destination: string): Promise<Opened> {
  const refused: string[] = [];
  let inFlight = 0;
  let lastActivity = Date.now();
  const transport: Transport = async (path, init) => {
    inFlight += 1;
    lastActivity = Date.now();
    try {
      const headers = new Headers(init?.headers);
      if (!headers.has("authorization")) headers.set("authorization", `Bearer ${session.token}`);
      const res = await world.backend.app.fetch(new Request(`http://local${path}`, { method: init?.method ?? "GET", headers, body: init?.body as BodyInit | null | undefined }));
      const text = await res.text();
      if (res.status >= REFUSED_FROM && !SERVED_BY_THE_PLATFORM.has(path.split("?")[0] ?? path)) refused.push(`${res.status} ${init?.method ?? "GET"} ${path.split("?")[0]}`);
      return { status: res.status, ok: res.ok, retryAfterSeconds: null, sessionEnded: null, json: async <T,>() => JSON.parse(text) as T, text: async () => text, header: (name: string) => res.headers.get(name) };
    } finally {
      inFlight -= 1;
      lastActivity = Date.now();
    }
  };
  const router = createMemoryRouter(routes, { initialEntries: [`/${routePathForScreen(destination)}`] });
  const view = render(
    <AppProviders transport={transport} initialSession={session}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline && (inFlight > 0 || Date.now() - lastActivity < QUIET_MS)) await new Promise((resume) => setTimeout(resume, 20));
  const errorBlocks = [...view.container.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "").filter((text) => text.trim() !== "");
  cleanup();
  return { refused, errorBlocks };
}

describe("every destination the rail offers a seeded user opens without a refused request", () => {
  it("the rail has destinations, and the demo tenant has users of many roles to walk them as", () => {
    expect(destinations.length).toBeGreaterThan(150);
    expect(new Set(users.filter((user) => user.status === "active").map((user) => user.roleId)).size).toBeGreaterThan(12);
  });

  it("for every active seeded user, each offered destination draws no refusal from the routes and shows no error block", async () => {
    const problems: string[] = [];
    let opened = 0;
    for (const user of users.filter((candidate) => candidate.status === "active" && (!ONLY_USER || candidate.email.startsWith(ONLY_USER)))) {
      const session = await signIn(user.email);
      if (sessionHolds(session, EVERY_PERMISSION_PROBE)) continue;
      for (const destination of offeredTo(session)) {
        const result = await open(session, destination);
        opened += 1;
        for (const refusal of result.refused) problems.push(`${user.email.split("@")[0]} ${destination}: ${refusal}`);
        for (const block of result.errorBlocks) problems.push(`${user.email.split("@")[0]} ${destination}: «${block.slice(0, 80)}»`);
      }
    }
    expect(opened).toBeGreaterThan(ONLY_USER ? 5 : 400);
    expect(problems).toEqual([]);
  }, 3_000_000);
});
