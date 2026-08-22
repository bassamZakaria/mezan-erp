import { describe, it, expect, afterEach } from "vitest";
import { EtaService, type EtaTransmitPort } from "@mezan/domain";
import { createSqliteEtaStore, type SqliteEtaStoreHandle } from "@mezan/persistence";
import { createEtaRoutes } from "./eta-routes.js";

const handles: SqliteEtaStoreHandle[] = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
});

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  return new Request(`http://local${path}`, { ...init, headers });
}

const accepting: EtaTransmitPort = { async transmit() { return { ok: true, etaUuid: "U-1" }; } };

function newApp(transmit?: EtaTransmitPort) {
  const store = createSqliteEtaStore();
  handles.push(store);
  const service = new EtaService({ config: store.config, submissions: store.submissions, transmit, now: () => "2026-08-22T10:00:00.000Z", newId: () => "sub-1" });
  const app = createEtaRoutes({ service, setClientSecret: (s) => store.config.setClientSecret(s) });
  return { app, service, store };
}

const VIEW = "accounting.eta.view";
const SUBMIT = "accounting.eta.view,accounting.eta.submit";

describe("eta router — config", () => {
  it("returns default config + readiness, gated behind eta.view", async () => {
    const { app } = newApp();
    expect((await app.fetch(req("/config"))).status).toBe(403);
    const res = await app.fetch(req("/config", { permissions: VIEW }));
    const body = await res.json() as { config: { hasClientSecret: boolean }; readiness: { percent: number } };
    expect(body.config.hasClientSecret).toBe(false);
    expect(body.readiness.percent).toBe(0);
  });

  it("updates config and stores the client secret without ever returning it", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/config", { method: "PUT", permissions: SUBMIT, headers: { "content-type": "application/json" }, body: JSON.stringify({ activityCode: "4610", clientId: "cid", clientSecret: "shh" }) }));
    const body = await res.json() as { config: { activityCode: string | null; hasClientSecret: boolean } };
    expect(body.config.activityCode).toBe("4610");
    expect(body.config.hasClientSecret).toBe(true);
    expect(JSON.stringify(body)).not.toContain("shh");
  });
});

describe("eta router — submission lifecycle", () => {
  async function enqueue(service: EtaService) {
    await service.enqueue({
      internalId: "INV-000014", documentType: "invoice", issueDateTime: "2026-08-22T09:00:00Z",
      receiver: { registrationNumber: null, name: "عميل", type: "P" },
      lines: [{ description: "منتج", itemCode: "EG-1", quantity: "1", unitPrice: "100", netTotal: "100", taxSubType: "V009", taxRate: "14", taxAmount: "14" }],
      totalNet: "100", totalTax: "14", totalAmount: "114",
    });
  }

  it("lists the queue and submits → accepts a document with a live transmit port", async () => {
    const { app, service } = newApp(accepting);
    await enqueue(service);
    const list = await (await app.fetch(req("/submissions?status=ready", { permissions: VIEW }))).json() as unknown[];
    expect(list).toHaveLength(1);
    const submitted = await (await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }))).json() as { status: string };
    expect(submitted.status).toBe("submitted");
    const accepted = await (await app.fetch(req("/submissions/sub-1/accept", { method: "POST", permissions: SUBMIT, headers: { "content-type": "application/json" }, body: JSON.stringify({ etaUuid: "U-1" }) }))).json() as { status: string; etaUuid: string };
    expect(accepted.status).toBe("accepted");
    expect(accepted.etaUuid).toBe("U-1");
  });

  it("returns 202 (queued) when the stubbed online transmit refuses offline", async () => {
    const { app, service } = newApp(); // default stub transmit
    await enqueue(service);
    const res = await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    expect(res.status).toBe(202);
    expect((await res.json() as { error: string }).error).toBe("ETA_OFFLINE");
  });

  it("excludes a document with a reason (requires eta.cancel)", async () => {
    const { app, service } = newApp(accepting);
    await enqueue(service);
    expect((await app.fetch(req("/submissions/sub-1/exclude", { method: "POST", permissions: SUBMIT, headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "تجريبي" }) }))).status).toBe(403);
    const res = await app.fetch(req("/submissions/sub-1/exclude", { method: "POST", permissions: `${VIEW},accounting.eta.cancel`, headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "تجريبي" }) }));
    expect((await res.json() as { status: string }).status).toBe("excluded");
  });
});
