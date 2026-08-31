import { describe, it, expect, afterEach } from "vitest";
import type { AuditEvent } from "@mezan/domain";
import { createSqliteAuditSink } from "@mezan/persistence";
import { createAuditRoutes } from "./audit-routes.js";

const closers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of closers.splice(0)) h.close();
});

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    stream: "sensitive",
    module: "sales",
    entityType: "SALES_INVOICE",
    entityId: "si-1",
    action: "CONFIRM",
    actor: "user-1",
    branchId: "MAIN",
    timestamp: "2026-08-20T10:00:00.000Z",
    severity: "INFO",
    details: null,
    ...overrides,
  };
}

async function newApp(events: AuditEvent[] = []) {
  const sink = createSqliteAuditSink();
  closers.push(sink);
  for (const e of events) await sink.append(e);
  return { app: createAuditRoutes(sink), sink };
}

type App = Awaited<ReturnType<typeof newApp>>["app"];

function req(path: string, permissions = "*") {
  const headers = new Headers();
  headers.set("x-permissions", permissions);
  return new Request(`http://local${path}`, { headers });
}

async function query<T>(app: App, path: string, permissions?: string): Promise<T> {
  return (await (await app.fetch(req(path, permissions))).json()) as T;
}

interface Result {
  events: Array<{ module: string; action: string; entityId: string | null; branchId: string | null }>;
  total: number;
}

const seed = [
  event(),
  event({ entityId: "si-2", action: "VOID", severity: "WARNING", timestamp: "2026-08-21T10:00:00.000Z" }),
  event({
    stream: "security",
    module: "auth",
    entityType: "AUTH_USER",
    entityId: "user-9",
    action: "ACCOUNT_LOCKED",
    actor: "system",
    branchId: null,
    severity: "CRITICAL",
    timestamp: "2026-08-22T10:00:00.000Z",
    details: { attempts: 5 },
  }),
  event({ branchId: "BR2", entityId: "si-3", timestamp: "2026-08-23T10:00:00.000Z" }),
];

describe("audit routes", () => {
  it("403s a caller without audit.logs.view", async () => {
    const { app } = await newApp();
    expect((await app.fetch(req("/", "sales.invoice.view"))).status).toBe(403);
  });

  it("returns every event, newest first, with a total beside them", async () => {
    const { app } = await newApp(seed);
    const result = await query<Result>(app, "/");
    expect(result.total).toBe(4);
    expect(result.events).toHaveLength(4);
    expect(result.events[0]?.entityId).toBe("si-3");
  });

  it("narrows by stream, module, action, actor, entity and severity", async () => {
    const { app } = await newApp(seed);
    expect((await query<Result>(app, "/?stream=security")).total).toBe(1);
    expect((await query<Result>(app, "/?module=sales")).total).toBe(3);
    expect((await query<Result>(app, "/?action=VOID")).total).toBe(1);
    expect((await query<Result>(app, "/?actor=system")).total).toBe(1);
    expect((await query<Result>(app, "/?entityType=AUTH_USER")).total).toBe(1);
    expect((await query<Result>(app, "/?entityId=si-2")).total).toBe(1);
    expect((await query<Result>(app, "/?severity=CRITICAL")).total).toBe(1);
  });

  it("bounds the window by from and to, inclusively", async () => {
    const { app } = await newApp(seed);
    expect((await query<Result>(app, "/?from=2026-08-22T00:00:00.000Z")).total).toBe(2);
    expect((await query<Result>(app, "/?to=2026-08-21T10:00:00.000Z")).total).toBe(2);
    expect(
      (await query<Result>(app, "/?from=2026-08-21T00:00:00.000Z&to=2026-08-22T23:59:59.999Z")).total,
    ).toBe(2);
  });

  it("never lets a branch filter match a row that has no branch — unknown is not every branch", async () => {
    const { app } = await newApp(seed);
    const result = await query<Result>(app, "/?branchId=MAIN");
    expect(result.total).toBe(2);
    expect(result.events.every((e) => e.branchId === "MAIN")).toBe(true);
  });

  it("pages with limit and offset while reporting the unpaged total", async () => {
    const { app } = await newApp(seed);
    const page1 = await query<Result>(app, "/?limit=2");
    expect(page1.events).toHaveLength(2);
    expect(page1.total).toBe(4);

    const page2 = await query<Result>(app, "/?limit=2&offset=2");
    expect(page2.events).toHaveLength(2);
    expect(page2.events[0]?.entityId).not.toBe(page1.events[0]?.entityId);
  });

  it("400s a query the contract refuses rather than silently ignoring it", async () => {
    const { app } = await newApp(seed);
    for (const q of ["/?stream=gossip", "/?severity=MEH", "/?limit=0", "/?limit=500", "/?offset=-1", "/?limit=two"]) {
      const res = await app.fetch(req(q));
      expect(res.status, q).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
    }
  });

  it("returns an empty page rather than an error when nothing matches", async () => {
    const { app } = await newApp(seed);
    expect(await query<Result>(app, "/?module=manufacturing")).toEqual({ events: [], total: 0 });
  });

  it("carries the details object back as an object, not a string", async () => {
    const { app } = await newApp(seed);
    const result = await query<{ events: Array<{ details: Record<string, unknown> | null }> }>(
      app,
      "/?stream=security",
    );
    expect(result.events[0]?.details).toEqual({ attempts: 5 });
  });
});
