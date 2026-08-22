import { describe, it, expect, afterEach } from "vitest";
import { createSqliteExchangeRateRepository, type SqliteExchangeRateRepositoryHandle } from "@mezan/persistence";
import { createExchangeRatesRoutes } from "./exchange-rates-routes.js";

const handles: SqliteExchangeRateRepositoryHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function newApp() {
  const repo = createSqliteExchangeRateRepository();
  handles.push(repo);
  return { app: createExchangeRatesRoutes(repo), repo };
}

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const body = { id: "r1", currency: "USD", rate: "50.25", effectiveDate: "2026-08-01" };

describe("exchange-rates router", () => {
  it("gates the list behind accounting.exchange_rate.manage", async () => {
    const { app } = newApp();
    expect((await app.fetch(req("/"))).status).toBe(403);
  });

  it("creates a rate (pending) and lists it", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/", { method: "POST", permissions: "accounting.exchange_rate.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(res.status).toBe(201);
    expect((await res.json() as { status: string }).status).toBe("pending");
    const list = await (await app.fetch(req("/", { permissions: "accounting.exchange_rate.manage" }))).json() as unknown[];
    expect(list).toHaveLength(1);
  });

  it("approves a rate (requires approve permission)", async () => {
    const { app } = newApp();
    await app.fetch(req("/", { method: "POST", permissions: "accounting.exchange_rate.manage", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect((await app.fetch(req("/r1/approve", { method: "POST", permissions: "accounting.exchange_rate.manage" }))).status).toBe(403);
    const res = await app.fetch(req("/r1/approve", { method: "POST", permissions: "accounting.exchange_rate.manage,accounting.exchange_rate.approve" }));
    expect((await res.json() as { status: string }).status).toBe("approved");
  });
});
