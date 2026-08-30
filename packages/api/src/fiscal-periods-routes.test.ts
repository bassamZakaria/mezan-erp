import { describe, it, expect, afterEach } from "vitest";
import { createSqliteFiscalPeriodRepository, type SqliteFiscalPeriodRepositoryHandle } from "@mezan/persistence";
import { createFiscalPeriodsRoutes } from "./fiscal-periods-routes.js";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteFiscalPeriodRepositoryHandle[] = [];

afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteFiscalPeriodRepository();
  handles.push(repo);
  const app = createFiscalPeriodsRoutes(repo, insecureHeaderAuthContextResolver);
  return { app, repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

async function generateYear(app: ReturnType<typeof createFiscalPeriodsRoutes>, year = 2026) {
  return app.fetch(
    req("/generate-year", { method: "POST", permissions: "accounting.period.close", headers: { "content-type": "application/json" }, body: JSON.stringify({ year }) }),
  );
}

describe("fiscal-periods router — permission gate", () => {
  it("rejects a request with no permissions with 403", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; permission: string };
    expect(body.error).toBe("PERMISSION_DENIED");
    expect(body.permission).toBe("accounting.period.view");
  });

  it("rejects /generate-year with only view permission", async () => {
    const { app } = newApp();
    const res = await app.fetch(
      req("/generate-year", { method: "POST", permissions: "accounting.period.view", headers: { "content-type": "application/json" }, body: JSON.stringify({ year: 2026 }) }),
    );
    expect(res.status).toBe(403);
  });
});

describe("fiscal-periods router — generate/list/get", () => {
  it("generates 12 periods for a fiscal year and lists them", async () => {
    const { app } = newApp();
    const genRes = await generateYear(app);
    expect(genRes.status).toBe(201);
    expect(((await genRes.json()) as unknown[]).length).toBe(12);

    const listRes = await app.fetch(req("/?year=2026", { permissions: "accounting.period.view" }));
    expect((await listRes.json()) as unknown[]).toHaveLength(12);
  });

  it("409s generating a year that already exists", async () => {
    const { app } = newApp();
    await generateYear(app);
    const res = await generateYear(app);
    expect(res.status).toBe(409);
  });

  it("404s for an unknown period id", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope", { permissions: "accounting.period.view" }));
    expect(res.status).toBe(404);
  });
});

describe("fiscal-periods router — lifecycle actions", () => {
  it("closes an open period", async () => {
    const { app } = newApp();
    await generateYear(app);
    const res = await app.fetch(req("/fp-2026-01/close", { method: "POST", permissions: "accounting.period.close" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("closed");
  });

  it("422s locking an open period directly (must close first)", async () => {
    const { app } = newApp();
    await generateYear(app);
    const res = await app.fetch(req("/fp-2026-01/lock", { method: "POST", permissions: "accounting.period.close" }));
    expect(res.status).toBe(422);
  });

  it("locks a closed period (reuses accounting.period.close — no dedicated lock permission exists)", async () => {
    const { app } = newApp();
    await generateYear(app);
    await app.fetch(req("/fp-2026-01/close", { method: "POST", permissions: "accounting.period.close" }));
    const res = await app.fetch(req("/fp-2026-01/lock", { method: "POST", permissions: "accounting.period.close" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("locked");
  });

  it("reopens a closed period, gated by accounting.period.reopen", async () => {
    const { app } = newApp();
    await generateYear(app);
    await app.fetch(req("/fp-2026-01/close", { method: "POST", permissions: "accounting.period.close" }));

    const forbidden = await app.fetch(req("/fp-2026-01/reopen", { method: "POST", permissions: "accounting.period.close" }));
    expect(forbidden.status).toBe(403);

    const res = await app.fetch(req("/fp-2026-01/reopen", { method: "POST", permissions: "accounting.period.reopen" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("open");
  });

  it("404s a lifecycle action on an unknown period id", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/nope/close", { method: "POST", permissions: "accounting.period.close" }));
    expect(res.status).toBe(404);
  });
});
