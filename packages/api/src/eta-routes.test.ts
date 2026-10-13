import { describe, it, expect, afterEach } from "vitest";
import {
  EtaService,
  createItem,
  createItemUnit,
  createBranch,
  createTaxRate,
  buildEtaPayload,
  ETA_ACTIVITY_CODES,
  ETA_UNIT_CODES,
  EtaOfflineError,
  type EtaTransmitPort,
  type EtaTransmitResult,
  type EtaDocumentInput,
} from "@mezan/domain";
import {
  createSqliteEtaStore,
  createSqliteItemStore,
  createSqliteItemCatalogStore,
  createSqliteBranchStore,
  createSqliteTaxRateRepository,
  type SqliteEtaStoreHandle,
} from "@mezan/persistence";
import { createEtaRoutes, type EtaRoutesDeps } from "./eta-routes.js";
import type { EtaReceiptUuidPort } from "@mezan/domain";

import { insecureHeaderAuthContextResolver } from "./permission-gate.js";
const handles: SqliteEtaStoreHandle[] = [];
const otherHandles: Array<{ close(): void }> = [];
afterEach(() => {
  for (const h of handles.splice(0)) h.close();
  for (const h of otherHandles.splice(0)) h.close();
});

function req(path: string, init: RequestInit & { permissions?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.permissions !== undefined) headers.set("x-permissions", init.permissions);
  if (init.body) headers.set("content-type", "application/json");
  return new Request(`http://local${path}`, { ...init, headers });
}

const accepting: EtaTransmitPort = { async transmit() { return { ok: true, etaUuid: "U-1" }; } };

const fakeSigner = { async sign() { return "CADES-SIGNATURE"; } };

function newApp(transmit?: EtaTransmitPort) {
  const store = createSqliteEtaStore();
  handles.push(store);
  const service = new EtaService({ config: store.config, submissions: store.submissions, transmit, signer: fakeSigner, now: () => "2026-08-22T10:00:00.000Z", newId: () => "sub-1" });
  const app = createEtaRoutes({ service, setClientSecret: (s) => store.config.setClientSecret(s) }, insecureHeaderAuthContextResolver);
  return { app, service, store };
}

/** Wires every optional master-data port, each backed by a real SQLite repository. */
async function fullDeps(transmit?: EtaTransmitPort) {
  const store = createSqliteEtaStore();
  const items = createSqliteItemStore();
  const catalog = createSqliteItemCatalogStore();
  const branches = createSqliteBranchStore();
  const taxRates = createSqliteTaxRateRepository();
  handles.push(store);
  otherHandles.push(items, catalog, branches, taxRates);

  const service = new EtaService({
    config: store.config,
    submissions: store.submissions,
    transmit,
    now: () => "2026-08-22T10:00:00.000Z",
    newId: () => "sub-1",
  });
  const deps: EtaRoutesDeps = {
    service,
    setClientSecret: (s) => store.config.setClientSecret(s),
    items,
    units: catalog.units,
    branches,
    taxRates,
    branchCodes: store.branchCodes,
    unitMappings: store.unitMappings,
  };
  const app = createEtaRoutes(deps, insecureHeaderAuthContextResolver);
  return {
    app,
    service,
    store,
    items,
    units: catalog.units,
    branches,
    taxRates,
    deps,
    branchCodes: store.branchCodes,
    unitMappings: store.unitMappings,
  };
}

const VIEW = "accounting.eta.view";
const SUBMIT = "accounting.eta.view,accounting.eta.submit";
const CANCEL = "accounting.eta.view,accounting.eta.cancel";

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
      receiver: { registrationNumber: null, name: "عميل", type: "P" }, branchCode: null,
      lines: [{ description: "منتج", itemCode: "EG-1", quantity: "1", unitType: "EA", unitPrice: "100", netTotal: "100", taxSubType: "V009", taxRate: "14", taxAmount: "14" }],
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

function newAppSeq(transmit?: EtaTransmitPort) {
  const store = createSqliteEtaStore();
  handles.push(store);
  let n = 0;
  const service = new EtaService({
    config: store.config,
    submissions: store.submissions,
    transmit,
    now: () => "2026-08-22T10:00:00.000Z",
    newId: () => `sub-${++n}`,
  });
  const app = createEtaRoutes({ service, setClientSecret: (s) => store.config.setClientSecret(s) }, insecureHeaderAuthContextResolver);
  return { app, service, store };
}

const invoiceInput: EtaDocumentInput = {
  internalId: "INV-000014",
  documentType: "invoice",
  issueDateTime: "2026-08-22T09:00:00Z",
  receiver: { registrationNumber: "123456789", name: "شركة العميل", type: "B" },
  branchCode: "BR-01",
  lines: [
    { description: "منتج أ", itemCode: "EG-1", quantity: "3", unitType: "EA", unitPrice: "100", netTotal: "300", taxSubType: "V009", taxRate: "14", taxAmount: "42" },
  ],
  totalNet: "300",
  totalTax: "42",
  totalAmount: "342",
};

describe("eta router — the payload built for a real document", () => {
  it("buildEtaPayload derives every field from the posted invoice and the saved config, and GET /submissions never returns it", async () => {
    const { app, service } = newApp();
    await app.fetch(
      req("/config", {
        method: "PUT",
        permissions: SUBMIT,
        body: JSON.stringify({
          activityCode: "4610",
          taxRegistrationNumber: "TRN-1",
          documentVersion: "0.9",
          address: { governorate: "القاهرة", city: "مدينة نصر", street: "شارع النصر", buildingNumber: "10", postalCode: "11371" },
        }),
      }),
    );
    const config = await service.getConfig();
    const submission = await service.enqueue(invoiceInput);

    expect(submission.payload).toEqual(buildEtaPayload(invoiceInput, config));

    // Field-by-field against the invoice actually posted above, hand-derived
    // rather than copied off the response.
    const payload = submission.payload as {
      documentType: string;
      documentTypeVersion: string;
      internalId: string;
      issuer: { id: string | null; address: { branchId: string | null } | null };
      receiver: { id: string | null; name: string };
      invoiceLines: { itemCode: string; quantity: string; unitValue: unknown; taxableItems: unknown }[];
      totalSalesAmount: string;
      totalTaxAmount: string;
      totalAmount: string;
    };
    expect(payload.documentType).toBe("I");
    expect(payload.documentTypeVersion).toBe("0.9");
    expect(payload.internalId).toBe("INV-000014");
    expect(payload.issuer.id).toBe("TRN-1");
    expect(payload.issuer.address?.branchId).toBe("BR-01");
    expect(payload.receiver.id).toBe("123456789");
    expect(payload.receiver.name).toBe("شركة العميل");
    expect(payload.invoiceLines).toHaveLength(1);
    expect(payload.invoiceLines[0]?.itemCode).toBe("EG-1");
    expect(payload.invoiceLines[0]?.quantity).toBe("3");
    expect(payload.invoiceLines[0]?.unitValue).toEqual({ currencySold: "EGP", amountEGP: "100" });
    expect(payload.invoiceLines[0]?.taxableItems).toEqual([{ taxType: "T1", subType: "V009", rate: "14", amount: "42" }]);
    expect(payload.totalSalesAmount).toBe("300");
    expect(payload.totalTaxAmount).toBe("42");
    expect(payload.totalAmount).toBe("342");

    // GET /submissions keeps the payload OFF the list — it is large and the
    // queue screen does not need it — but GET /submissions/:id returns it, so
    // a screen or an auditor can inspect exactly what will be filed with the
    // authority before it goes (D121).
    const list = (await (await app.fetch(req("/submissions", { permissions: VIEW }))).json()) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!)).not.toContain("payload");

    const one = await app.fetch(req(`/submissions/${submission.id}`, { permissions: VIEW }));
    expect(one.status).toBe(200);
    const body = (await one.json()) as Record<string, unknown>;
    expect(body.id).toBe(submission.id);
    expect(body.payload).toEqual(buildEtaPayload(invoiceInput, config));
  });

  it("GET /submissions/:id is gated and 404s an unknown id (D121)", async () => {
    const { app, service } = newApp();
    const submission = await service.enqueue(invoiceInput);

    // A payload that is about to be filed with the tax authority is not
    // public: the read needs the same permission the queue does.
    const denied = await app.fetch(req(`/submissions/${submission.id}`, { permissions: "sales.invoice.view" }));
    expect(denied.status).toBe(403);
    expect(Object.keys((await denied.json()) as Record<string, unknown>)).not.toContain("payload");

    expect((await app.fetch(req("/submissions/NOPE", { permissions: VIEW }))).status).toBe(404);
  });
});

describe("eta router — what reaches the queue and what does not (D77)", () => {
  it("the queue and this router fully carry a credit_note once fed directly — D77's gap is the missing PRODUCER wiring, not the queue or this router", async () => {
    const { app, service } = newApp();
    await service.enqueue({ ...invoiceInput, internalId: "CN-000001", documentType: "credit_note" });
    const list = (await (await app.fetch(req("/submissions", { permissions: VIEW }))).json()) as { documentType: string; internalId: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]?.documentType).toBe("credit_note");
    expect(list[0]?.internalId).toBe("CN-000001");
    // docs/ROADMAP.md D77: a confirmed sales/purchase return is never turned
    // into an ETA submission at all — the DOCUMENT_CONFIRMED event bridge that
    // calls `EtaService.enqueue` (packages/backend/src/create-backend.ts,
    // createEtaEnqueueBridge) only reacts to `docType === "SALES_INVOICE"`.
    // This test proves the row above CAN exist and lists correctly once
    // something calls enqueue for a return — the defect is entirely upstream
    // of eta-routes.ts, in that bridge's producer wiring.
  });
});

describe("eta router — submission not-found and invalid-transition refusals", () => {
  it("404s submitting an id that does not exist", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/submissions/GHOST/submit", { method: "POST", permissions: SUBMIT }));
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe("ETA_SUBMISSION_NOT_FOUND");
  });

  it("422s re-submitting an already-accepted submission, naming the transition error", async () => {
    const { app, service } = newApp(accepting);
    await service.enqueue(invoiceInput);
    await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    await app.fetch(req("/submissions/sub-1/accept", { method: "POST", permissions: SUBMIT, body: JSON.stringify({ etaUuid: "U-9" }) }));
    const res = await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    expect(res.status).toBe(422);
    expect((await res.json() as { error: string }).error).toBe("ETA_INVALID_TRANSITION");
  });

  it("404s accepting an id that does not exist", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/submissions/GHOST/accept", { method: "POST", permissions: SUBMIT, body: JSON.stringify({ etaUuid: "U-1" }) }));
    expect(res.status).toBe(404);
  });

  it("400s accept with no etaUuid, and with an unparsable body", async () => {
    const { app, service } = newApp(accepting);
    await service.enqueue(invoiceInput);
    await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));

    const missing = await app.fetch(req("/submissions/sub-1/accept", { method: "POST", permissions: SUBMIT, body: JSON.stringify({}) }));
    expect(missing.status).toBe(400);

    const garbage = await app.fetch(req("/submissions/sub-1/accept", { method: "POST", permissions: SUBMIT, body: "not json" }));
    expect(garbage.status).toBe(400);
  });

  it("422s accepting a submission that was never submitted", async () => {
    const { app, service } = newApp(accepting);
    await service.enqueue(invoiceInput);
    const res = await app.fetch(req("/submissions/sub-1/accept", { method: "POST", permissions: SUBMIT, body: JSON.stringify({ etaUuid: "U-1" }) }));
    expect(res.status).toBe(422);
  });

  it("404s excluding an id that does not exist", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/submissions/GHOST/exclude", { method: "POST", permissions: CANCEL, body: JSON.stringify({ reason: "x" }) }));
    expect(res.status).toBe(404);
  });

  it("400s a zod-rejected exclude with no reason field at all, and creates no state change", async () => {
    const { app, service } = newApp();
    await service.enqueue(invoiceInput);
    const res = await app.fetch(req("/submissions/sub-1/exclude", { method: "POST", permissions: CANCEL, body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("VALIDATION_ERROR");
    const list = (await (await app.fetch(req("/submissions", { permissions: VIEW }))).json()) as { status: string }[];
    expect(list[0]?.status).toBe("ready");
  });

  it("400s a whitespace-only exclude reason — it passes zod's min(1) but fails the domain rule", async () => {
    const { app, service } = newApp();
    await service.enqueue(invoiceInput);
    const res = await app.fetch(req("/submissions/sub-1/exclude", { method: "POST", permissions: CANCEL, body: JSON.stringify({ reason: "   " }) }));
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe("ETA_EXCLUSION_REASON_REQUIRED");
  });

  it("422s excluding an already-submitted document", async () => {
    const { app, service } = newApp(accepting);
    await service.enqueue(invoiceInput);
    await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    const res = await app.fetch(req("/submissions/sub-1/exclude", { method: "POST", permissions: CANCEL, body: JSON.stringify({ reason: "تجاوز الحد" }) }));
    expect(res.status).toBe(422);
  });
});

/**
 * The e-seal seam, after both branches' fixes for the same defect were merged.
 *
 * One branch parked an unsealed v1.0 document behind an unavailable signing
 * port; the other shelled out to the taxpayer's own CAdES program. The merged
 * service keeps the first's PORT and behaviour and uses the second as its
 * implementation, so there are exactly two states worth asserting:
 *
 *   - no signing agent on the machine → the document PARKS at بانتظار التوقيع
 *     and is never transmitted, however many times إرسال is pressed;
 *   - an agent configured → one submit seals and transmits.
 *
 * The invariant both branches were protecting is the same either way: an
 * unsigned v1.0 document must never reach the authority.
 */
describe("eta router — the e-seal hold before transmit", () => {
  /** A service with NO signing agent — the shape of an install that has not bought a token yet. */
  function newAppWithoutSigner(transmit?: EtaTransmitPort) {
    const store = createSqliteEtaStore();
    handles.push(store);
    const service = new EtaService({ config: store.config, submissions: store.submissions, transmit, now: () => "2026-08-22T10:00:00.000Z", newId: () => "sub-1" });
    const app = createEtaRoutes({ service, setClientSecret: (x) => store.config.setClientSecret(x) }, insecureHeaderAuthContextResolver);
    return { app, service };
  }

  it("parks a ready submission at بانتظار التوقيع with no signing agent, without ever calling transmit", async () => {
    const failIfCalled: EtaTransmitPort = {
      async transmit(): Promise<EtaTransmitResult> {
        throw new Error("transmit must not be called while awaiting the e-seal");
      },
    };
    const { app, service } = newAppWithoutSigner(failIfCalled);
    await app.fetch(req("/config", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ signingMethod: "eseal" }) }));
    await service.enqueue(invoiceInput);

    const res = await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; submittedAt: string | null };
    expect(body.status).toBe("pending_signature");
    expect(body.submittedAt).toBeNull();
  });

  it("with a signing agent configured, one submit seals the document and transmits it", async () => {
    const { app, service } = newApp(accepting);
    await app.fetch(req("/config", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ signingMethod: "eseal" }) }));
    await service.enqueue(invoiceInput);

    const res = await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    const body = (await res.json()) as { status: string; signed: boolean };
    expect(body.status).toBe("submitted");
    expect(body.signed).toBe(true);
  });

  // guards P-1 — an unsigned v1.0 document stays بانتظار التوقيع rather than
  // being transmitted for the authority to reject, however often إرسال runs.
  it("keeps parking, and never transmits, while no signing agent is configured", async () => {
    const store = createSqliteEtaStore();
    handles.push(store);
    const failIfCalled: EtaTransmitPort = {
      async transmit(): Promise<EtaTransmitResult> {
        throw new Error("an unsigned document must never be transmitted");
      },
    };
    const service = new EtaService({ config: store.config, submissions: store.submissions, transmit: failIfCalled, now: () => "2026-08-22T10:00:00.000Z", newId: () => "sub-1" });
    const app = createEtaRoutes({ service, setClientSecret: (x) => store.config.setClientSecret(x) }, insecureHeaderAuthContextResolver);

    await app.fetch(req("/config", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ signingMethod: "eseal" }) }));
    await service.enqueue(invoiceInput);
    await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));

    const res = await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; submittedAt: string | null };
    expect(body.status).toBe("pending_signature");
    expect(body.submittedAt).toBeNull();
    // The point of the test: the transmit port above throws if it is ever
    // reached, so a second إرسال re-parking rather than 500ing IS the guarantee.
    expect((await service.findById("sub-1"))!.status).toBe("pending_signature");
  });
});

// guards P-1 — the queue driver a scheduler calls, and the status poll.
describe("eta router — POST /submissions/process", () => {
  it("submits everything pending and then records the authority's clearance", async () => {
    const polling: EtaTransmitPort = {
      async transmit() { return { ok: true, etaUuid: "UUID-1", submissionId: "SUB-1" }; },
      async fetchStatus() { return { state: "accepted" as const, errors: [] }; },
    };
    const { app, service } = newApp(polling);
    await service.enqueue(invoiceInput);

    const res = await app.fetch(req("/submissions/process", { method: "POST", permissions: SUBMIT }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { submitted: unknown[]; accepted: { id: string }[]; queued: string[]; unsigned: string[] };
    expect(body.submitted).toHaveLength(1);
    expect(body.accepted.map((s) => s.id)).toEqual(["sub-1"]);
    expect((await service.findById("sub-1"))!.status).toBe("accepted");
  });

  it("leaves an unconfigured install's documents queued rather than failing", async () => {
    const { app, service } = newApp();
    await service.enqueue(invoiceInput);
    const res = await app.fetch(req("/submissions/process", { method: "POST", permissions: SUBMIT }));
    const body = (await res.json()) as { queued: string[] };
    expect(body.queued).toEqual(["sub-1"]);
    expect((await service.findById("sub-1"))!.status).toBe("ready");
  });

  it("refresh-status records a rejection with the authority's own reasons", async () => {
    const polling: EtaTransmitPort = {
      async transmit() { return { ok: true, etaUuid: "UUID-1" }; },
      async fetchStatus() { return { state: "rejected" as const, errors: ["Signature could not be verified"] }; },
    };
    const { app, service } = newApp(polling);
    await service.enqueue(invoiceInput);
    await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));

    const res = await app.fetch(req("/submissions/sub-1/refresh-status", { method: "POST", permissions: SUBMIT }));
    const body = (await res.json()) as { status: string; errors: string[] };
    expect(body.status).toBe("error");
    expect(body.errors).toEqual(["Signature could not be verified"]);
  });
});

describe("eta router — a rejected (not offline) transmission lands in أخطاء with the authority's own reasons", () => {
  it("carries the rejection reasons on the submission, and a later submit retries it", async () => {
    const rejecting: EtaTransmitPort = { async transmit() { return { ok: false, errors: ["الرقم الضريبي غير صحيح"] }; } };
    const { app, service } = newApp(rejecting);
    await service.enqueue(invoiceInput);
    const res = await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    const body = (await res.json()) as { status: string; errors: string[] };
    expect(body.status).toBe("error");
    expect(body.errors).toEqual(["الرقم الضريبي غير صحيح"]);

    const retry = await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    expect(retry.status).toBe(200);
  });
});

describe("eta router — إرسال كل الجاهز (submit-all)", () => {
  it("gates on eta.submit, not eta.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/submissions/submit-all", { method: "POST", permissions: VIEW }));
    expect(res.status).toBe(403);
  });

  it("queues every ready document under the offline stub and submits none", async () => {
    const { app, service } = newAppSeq();
    await service.enqueue(invoiceInput);
    await service.enqueue({ ...invoiceInput, internalId: "INV-000015" });
    const res = await app.fetch(req("/submissions/submit-all", { method: "POST", permissions: SUBMIT }));
    const body = (await res.json()) as { submitted: unknown[]; queued: string[] };
    expect(body.submitted).toEqual([]);
    expect(body.queued.sort()).toEqual(["sub-1", "sub-2"]);
  });

  it("submits every ready document under a live transmit port", async () => {
    const { app, service } = newAppSeq(accepting);
    await service.enqueue(invoiceInput);
    await service.enqueue({ ...invoiceInput, internalId: "INV-000015" });
    const res = await app.fetch(req("/submissions/submit-all", { method: "POST", permissions: SUBMIT }));
    const body = (await res.json()) as { submitted: { status: string }[]; queued: string[] };
    expect(body.queued).toEqual([]);
    expect(body.submitted.map((s) => s.status)).toEqual(["submitted", "submitted"]);
  });

  it("one document failing offline does not abort the rest of the batch", async () => {
    const mixed: EtaTransmitPort = {
      async transmit(submission) {
        if (submission.internalId === "INV-000014") throw new EtaOfflineError();
        return { ok: true, etaUuid: "U-2" };
      },
    };
    const { app, service } = newAppSeq(mixed);
    await service.enqueue(invoiceInput); // INV-000014 → offline
    await service.enqueue({ ...invoiceInput, internalId: "INV-000015" }); // → transmits fine
    const res = await app.fetch(req("/submissions/submit-all", { method: "POST", permissions: SUBMIT }));
    const body = (await res.json()) as { submitted: { internalId: string; status: string }[]; queued: string[] };
    expect(body.queued).toEqual(["sub-1"]);
    expect(body.submitted).toHaveLength(1);
    expect(body.submitted[0]?.internalId).toBe("INV-000015");
    expect(body.submitted[0]?.status).toBe("submitted");
  });
});

describe("eta router — activity code and unit code lookups", () => {
  it("returns the full activity-code list unfiltered, and narrows by code prefix, Arabic label and English label", async () => {
    const { app } = newApp();
    const all = (await (await app.fetch(req("/activity-codes", { permissions: VIEW }))).json()) as { code: string }[];
    expect(all).toHaveLength(ETA_ACTIVITY_CODES.length);

    const byPrefix = (await (await app.fetch(req("/activity-codes?q=46", { permissions: VIEW }))).json()) as { code: string }[];
    expect(byPrefix.map((a) => a.code).sort()).toEqual(["4610", "4630", "4649", "4659"]);

    const byArabic = (await (await app.fetch(req(`/activity-codes?q=${encodeURIComponent("مطاعم")}`, { permissions: VIEW }))).json()) as { code: string }[];
    expect(byArabic.map((a) => a.code)).toEqual(["5610"]);

    const byEnglish = (await (await app.fetch(req("/activity-codes?q=pharma", { permissions: VIEW }))).json()) as { code: string }[];
    expect(byEnglish.map((a) => a.code).sort()).toEqual(["2100", "4772"]);

    const noMatch = (await (await app.fetch(req("/activity-codes?q=zzzzz", { permissions: VIEW }))).json()) as unknown[];
    expect(noMatch).toEqual([]);
  });

  it("gates activity-codes and unit-codes on eta.view", async () => {
    const { app } = newApp();
    expect((await app.fetch(req("/activity-codes"))).status).toBe(403);
    expect((await app.fetch(req("/unit-codes"))).status).toBe(403);
  });

  it("returns the authority's exact unit-code catalog", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/unit-codes", { permissions: VIEW }));
    expect(await res.json()).toEqual(ETA_UNIT_CODES);
  });
});

describe("eta router — test-connection (اختبار الاتصال)", () => {
  // guards P-1 — the check used to answer a hardcoded ok:false. It now makes a
  // real token request, and only once credentials exist.
  it("reports missing_credentials before any clientId/secret is on file, and the gateway's real answer once both are", async () => {
    const checking: EtaTransmitPort = {
      async transmit() { return { ok: true }; },
      async checkCredentials(config) {
        return { ok: true, reason: "connected" as const, detail: null, identityUrl: config.preproductionIdentityUrl, checkedAt: "2026-08-22T10:00:00.000Z" };
      },
    };
    const { app } = newApp(checking);
    const before = await app.fetch(req("/test-connection", { method: "POST", permissions: SUBMIT }));
    const beforeBody = (await before.json()) as { ok: boolean; reason: string };
    expect(beforeBody.ok).toBe(false);
    expect(beforeBody.reason).toBe("missing_credentials");

    await app.fetch(req("/config", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ clientId: "cid", clientSecret: "shh" }) }));
    const after = await app.fetch(req("/test-connection", { method: "POST", permissions: SUBMIT }));
    const afterBody = (await after.json()) as { ok: boolean; reason: string; identityUrl: string };
    expect(afterBody.ok).toBe(true);
    expect(afterBody.reason).toBe("connected");
    expect(afterBody.identityUrl).toBe("https://id.preprod.eta.gov.eg");
  });

  it("gates on eta.submit, not eta.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/test-connection", { method: "POST", permissions: VIEW }));
    expect(res.status).toBe(403);
  });
});

describe("eta router — config readiness counts the master-data prerequisites, not just its own fields", () => {
  it("computes readiness from real item/unit/branch/tax-rate rows, matching computeEtaReadiness by hand", async () => {
    const { app, items, units, branches, taxRates, unitMappings, branchCodes } = await fullDeps();

    // Two active items: one coded, one not. A service item is never counted
    // (itemNeedsCode excludes type "service" regardless of its code fields).
    await createItem({ id: "i1", code: "ITM-1", nameAr: "صنف مسجل", type: "stock", baseUnitCode: "PCS", etaItemCode: "EG-1", etaCodeType: "EGS" }, items);
    await createItem({ id: "i2", code: "ITM-2", nameAr: "صنف غير مسجل", type: "stock", baseUnitCode: "PCS" }, items);
    await createItem({ id: "i3", code: "ITM-3", nameAr: "خدمة", type: "service", baseUnitCode: "PCS" }, items);

    // Two active units: one mapped, one not.
    await createItemUnit({ code: "PCS", nameAr: "قطعة" }, units);
    await createItemUnit({ code: "KG", nameAr: "كيلوجرام" }, units);
    await unitMappings.save({ unitCode: "PCS", etaUnitCode: "EA" });

    // Two active branches: one coded, one not.
    await branches.save(createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" }));
    await branches.save(createBranch({ id: "b2", code: "BR2", name: "فرع ثانٍ" }));
    await branchCodes.save({ branchId: "b1", etaBranchCode: "1", deviceSerialNumber: null, posClientId: null, hasPosClientSecret: false });

    // Two active tax rates: one resolved, one left "auto".
    await createTaxRate({ id: "t1", code: "T1", name: "ضريبة أساسية", rate: 14, etaSubType: "V009" }, taxRates);
    await createTaxRate({ id: "t2", code: "T2", name: "ضريبة أخرى", rate: 5 }, taxRates); // defaults to "auto"

    const res = await app.fetch(req("/config", { permissions: VIEW }));
    const body = (await res.json()) as { readiness: { items: { key: string; labelAr: string; complete: boolean; missing: number }[]; percent: number } };
    const byKey = Object.fromEntries(body.readiness.items.map((i) => [i.key, i]));

    expect(byKey.itemCodes).toEqual({ key: "itemCodes", labelAr: "أكواد الأصناف", complete: false, missing: 1 });
    expect(byKey.unitMappings).toEqual({ key: "unitMappings", labelAr: "ربط الوحدات", complete: false, missing: 1 });
    expect(byKey.branchCodes).toEqual({ key: "branchCodes", labelAr: "أكواد الفروع لدى المصلحة", complete: false, missing: 1 });
    expect(byKey.taxSubTypes).toEqual({ key: "taxSubTypes", labelAr: "أنواع الضريبة الفرعية", complete: false, missing: 1 });

    // 9 checklist items total: 3 own-config fields (all unset) + the 4
    // master-data rows above + clientId + clientSecret — none complete → 0%.
    expect(body.readiness.items).toHaveLength(9);
    expect(body.readiness.percent).toBe(0);
  });
});

describe("eta router — branch codes", () => {
  it("GET returns [] when the masters are not wired", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/branch-codes", { permissions: VIEW }));
    expect((await res.json()) as unknown[]).toEqual([]);
  });

  it("gates GET on eta.view", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/branch-codes"));
    expect(res.status).toBe(403);
  });

  it("lists only ACTIVE branches, etaBranchCode null until registered, then reflects a PUT (trimmed)", async () => {
    const { app, branches } = await fullDeps();
    await branches.save(createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" }));
    await branches.save(createBranch({ id: "b2", code: "OLD", name: "فرع مغلق", active: false }));

    const before = (await (await app.fetch(req("/branch-codes", { permissions: VIEW }))).json()) as { branchId: string; etaBranchCode: string | null }[];
    expect(before).toEqual([
      {
        branchId: "b1",
        branchCode: "MAIN",
        branchName: "الفرع الرئيسي",
        etaBranchCode: null,
        deviceSerialNumber: null,
        posClientId: null,
        hasPosClientSecret: false,
        posOsVersion: null,
        posModelFramework: null,
        hasPosPresharedKey: false,
      },
    ]);

    const put = await app.fetch(req("/branch-codes/b1", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaBranchCode: " 001 " }) }));
    expect(put.status).toBe(200);
    expect((await put.json()) as { etaBranchCode: string }).toMatchObject({ etaBranchCode: "001" });

    const after = (await (await app.fetch(req("/branch-codes", { permissions: VIEW }))).json()) as { etaBranchCode: string | null }[];
    expect(after[0]?.etaBranchCode).toBe("001");
  });

  it("404s PUT for an unknown branch, and 404s the whole PUT route when the masters are not wired", async () => {
    const { app: bare } = newApp();
    const bareRes = await bare.fetch(req("/branch-codes/b1", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaBranchCode: "1" }) }));
    expect(bareRes.status).toBe(404);
    expect((await bareRes.json() as { error: string }).error).toBe("NOT_CONFIGURED");

    const { app } = await fullDeps();
    const res = await app.fetch(req("/branch-codes/GHOST", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaBranchCode: "1" }) }));
    expect(res.status).toBe(404);
    expect((await res.json() as { error: string }).error).toBe("BRANCH_NOT_FOUND");
  });

  it("400s an empty etaBranchCode", async () => {
    const { app, branches } = await fullDeps();
    await branches.save(createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" }));
    const res = await app.fetch(req("/branch-codes/b1", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaBranchCode: "" }) }));
    expect(res.status).toBe(400);
  });

  it("gates the PUT on eta.submit, not eta.view", async () => {
    const { app, branches } = await fullDeps();
    await branches.save(createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" }));
    const res = await app.fetch(req("/branch-codes/b1", { method: "PUT", permissions: VIEW, body: JSON.stringify({ etaBranchCode: "1" }) }));
    expect(res.status).toBe(403);
  });

  it("registers the POS device on the branch and never returns its secret", async () => {
    const { app, branches } = await fullDeps();
    await branches.save(createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" }));

    const put = await app.fetch(
      req("/branch-codes/b1", {
        method: "PUT",
        permissions: SUBMIT,
        body: JSON.stringify({
          etaBranchCode: "1",
          deviceSerialNumber: " POS-0001 ",
          posClientId: "pos-client",
          posClientSecret: "s3cr3t",
        }),
      }),
    );
    expect(put.status).toBe(200);

    const rows = (await (await app.fetch(req("/branch-codes", { permissions: VIEW }))).json()) as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ deviceSerialNumber: "POS-0001", posClientId: "pos-client", hasPosClientSecret: true });
    expect(JSON.stringify(rows)).not.toContain("s3cr3t");
  });

  it("registers the device's pososversion/posmodelframework and seals its pre-shared key (D284)", async () => {
    const { app, branches } = await fullDeps();
    await branches.save(createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" }));
    const put = await app.fetch(
      req("/branch-codes/b1", {
        method: "PUT",
        permissions: SUBMIT,
        body: JSON.stringify({
          etaBranchCode: "1",
          deviceSerialNumber: "POS-0001",
          posOsVersion: "windows",
          posModelFramework: "1",
          posPresharedKey: "psk-never-returned",
        }),
      }),
    );
    expect(put.status).toBe(200);
    const rows = (await (await app.fetch(req("/branch-codes", { permissions: VIEW }))).json()) as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ posOsVersion: "windows", posModelFramework: "1", hasPosPresharedKey: true });
    expect(JSON.stringify(rows)).not.toContain("psk-never-returned");
  });

  it("keeps the registered device when a later PUT only changes the branch code", async () => {
    const { app, branches } = await fullDeps();
    await branches.save(createBranch({ id: "b1", code: "MAIN", name: "الفرع الرئيسي" }));
    await app.fetch(
      req("/branch-codes/b1", {
        method: "PUT",
        permissions: SUBMIT,
        body: JSON.stringify({ etaBranchCode: "1", deviceSerialNumber: "POS-0001" }),
      }),
    );
    await app.fetch(
      req("/branch-codes/b1", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaBranchCode: "2" }) }),
    );

    const rows = (await (await app.fetch(req("/branch-codes", { permissions: VIEW }))).json()) as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ etaBranchCode: "2", deviceSerialNumber: "POS-0001" });
  });
});

describe("eta router — item mappings", () => {
  it("GET returns an empty summary when items are not wired", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/item-mappings", { permissions: VIEW }));
    expect(await res.json()).toEqual({ rows: [], total: 0, unmapped: 0 });
  });

  it("lists only active items, counts unmapped independent of the q/unmapped filters, and q matches code, Arabic name or English name", async () => {
    const { app, items } = await fullDeps();
    await createItem({ id: "i1", code: "AAA-1", nameAr: "قلم رصاص", nameEn: "Pencil", type: "stock", baseUnitCode: "PCS", etaItemCode: "EG-1", etaCodeType: "EGS" }, items);
    await createItem({ id: "i2", code: "BBB-1", nameAr: "دفتر", nameEn: "Notebook", type: "stock", baseUnitCode: "PCS" }, items);
    const inactive = await createItem({ id: "i3", code: "CCC-1", nameAr: "غير نشط", type: "stock", baseUnitCode: "PCS" }, items);
    await items.update({ ...inactive, status: "inactive" });

    const all = (await (await app.fetch(req("/item-mappings", { permissions: VIEW }))).json()) as { rows: { itemId: string }[]; total: number; unmapped: number };
    expect(all.rows.map((r) => r.itemId).sort()).toEqual(["i1", "i2"]);
    expect(all.total).toBe(2);
    expect(all.unmapped).toBe(1);

    const unmappedOnly = (await (await app.fetch(req("/item-mappings?unmapped=1", { permissions: VIEW }))).json()) as { rows: { itemId: string }[]; total: number };
    expect(unmappedOnly.rows.map((r) => r.itemId)).toEqual(["i2"]);
    expect(unmappedOnly.total).toBe(1);

    const byCode = (await (await app.fetch(req("/item-mappings?q=aaa", { permissions: VIEW }))).json()) as { rows: { itemId: string }[] };
    expect(byCode.rows.map((r) => r.itemId)).toEqual(["i1"]);

    const byArabicName = (await (await app.fetch(req(`/item-mappings?q=${encodeURIComponent("دفتر")}`, { permissions: VIEW }))).json()) as { rows: { itemId: string }[] };
    expect(byArabicName.rows.map((r) => r.itemId)).toEqual(["i2"]);

    const byEnglishName = (await (await app.fetch(req("/item-mappings?q=notebook", { permissions: VIEW }))).json()) as { rows: { itemId: string }[] };
    expect(byEnglishName.rows.map((r) => r.itemId)).toEqual(["i2"]);

    const noMatch = (await (await app.fetch(req("/item-mappings?q=zzz", { permissions: VIEW }))).json()) as { rows: unknown[] };
    expect(noMatch.rows).toEqual([]);
  });

  it("PUT sets/clears the mapping (trimming a blank code to null) and leaves an omitted field untouched", async () => {
    const { app, items } = await fullDeps();
    await createItem({ id: "i1", code: "AAA-1", nameAr: "قلم رصاص", type: "stock", baseUnitCode: "PCS" }, items);

    const set = await app.fetch(req("/item-mappings/i1", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaCodeType: "EGS", etaItemCode: " EG-9 " }) }));
    expect(set.status).toBe(200);
    const setBody = (await set.json()) as { etaCodeType: string | null; etaItemCode: string | null; gpcCode: string | null };
    expect(setBody.etaCodeType).toBe("EGS");
    expect(setBody.etaItemCode).toBe("EG-9");
    expect(setBody.gpcCode).toBeNull();

    const clear = await app.fetch(req("/item-mappings/i1", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaItemCode: "   " }) }));
    const clearBody = (await clear.json()) as { etaCodeType: string | null; etaItemCode: string | null };
    expect(clearBody.etaItemCode).toBeNull();
    expect(clearBody.etaCodeType).toBe("EGS"); // omitted from this patch, must survive
  });

  it("404s an unknown item, 404s when items are not wired, and 400s an invalid etaCodeType", async () => {
    const { app: bare } = newApp();
    expect((await bare.fetch(req("/item-mappings/i1", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaCodeType: "EGS" }) }))).status).toBe(404);

    const { app, items } = await fullDeps();
    expect((await app.fetch(req("/item-mappings/GHOST", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaCodeType: "EGS" }) }))).status).toBe(404);

    await createItem({ id: "i1", code: "AAA-1", nameAr: "قلم", type: "stock", baseUnitCode: "PCS" }, items);
    const res = await app.fetch(req("/item-mappings/i1", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaCodeType: "NOT_A_TYPE" }) }));
    expect(res.status).toBe(400);
  });
});

describe("eta router — unit mappings", () => {
  it("GET returns [] when the masters are not wired", async () => {
    const { app } = newApp();
    expect(await (await app.fetch(req("/unit-mappings", { permissions: VIEW }))).json()).toEqual([]);
  });

  it("lists active units with a suggestion, null etaUnitCode until saved, then reflects the mapping", async () => {
    const { app, units, unitMappings } = await fullDeps();
    await createItemUnit({ code: "PCS", nameAr: "قطعة" }, units);
    await createItemUnit({ code: "XYZ", nameAr: "شيء عجيب" }, units);

    const before = (await (await app.fetch(req("/unit-mappings", { permissions: VIEW }))).json()) as { unitCode: string; nameAr: string; nameEn: string | null; etaUnitCode: string | null; suggestion: string | null }[];
    const byCode = Object.fromEntries(before.map((u) => [u.unitCode, u]));
    expect(byCode.PCS).toEqual({ unitCode: "PCS", nameAr: "قطعة", nameEn: null, etaUnitCode: null, suggestion: "EA" });
    expect(byCode.XYZ?.suggestion).toBeNull();

    await unitMappings.save({ unitCode: "PCS", etaUnitCode: "EA" });
    const after = (await (await app.fetch(req("/unit-mappings", { permissions: VIEW }))).json()) as { unitCode: string; etaUnitCode: string | null }[];
    expect(after.find((u) => u.unitCode === "PCS")?.etaUnitCode).toBe("EA");
  });

  it("PUT normalises to uppercase, 400s an authority code the catalog doesn't know, and 404s an unknown unit", async () => {
    const { app, units } = await fullDeps();
    await createItemUnit({ code: "PCS", nameAr: "قطعة" }, units);

    const bad = await app.fetch(req("/unit-mappings/PCS", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaUnitCode: "NOTREAL" }) }));
    expect(bad.status).toBe(400);
    expect((await bad.json() as { error: string }).error).toBe("UNKNOWN_ETA_UNIT_CODE");

    const good = await app.fetch(req("/unit-mappings/PCS", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaUnitCode: " ea " }) }));
    expect(good.status).toBe(200);
    expect((await good.json() as { etaUnitCode: string }).etaUnitCode).toBe("EA");

    const missing = await app.fetch(req("/unit-mappings/GHOST", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaUnitCode: "EA" }) }));
    expect(missing.status).toBe(404);
  });

  it("404s the whole PUT route when masters are not wired", async () => {
    const { app } = newApp();
    const res = await app.fetch(req("/unit-mappings/PCS", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ etaUnitCode: "EA" }) }));
    expect(res.status).toBe(404);
  });
});

describe("eta router — apply-suggestions (تطبيق الاقتراحات)", () => {
  it("maps every unmapped unit it can suggest a code for, skips an already-mapped one, and lists the rest as unresolved", async () => {
    const { app, units, unitMappings } = await fullDeps();
    await createItemUnit({ code: "PCS", nameAr: "قطعة" }, units); // suggestible → EA, but already mapped
    await createItemUnit({ code: "KG", nameAr: "كيلوجرام" }, units); // suggestible → KGM
    await createItemUnit({ code: "XYZ", nameAr: "شيء عجيب" }, units); // no suggestion
    await unitMappings.save({ unitCode: "PCS", etaUnitCode: "EA" });

    const res = await app.fetch(req("/unit-mappings/apply-suggestions", { method: "POST", permissions: SUBMIT }));
    const body = (await res.json()) as { applied: { unitCode: string; etaUnitCode: string }[]; unresolved: string[] };
    expect(body.applied).toEqual([{ unitCode: "KG", nameAr: "كيلوجرام", nameEn: null, etaUnitCode: "KGM", suggestion: "KGM" }]);
    expect(body.unresolved).toEqual(["XYZ"]);

    const mappings = await unitMappings.list();
    expect(mappings.find((m) => m.unitCode === "KG")?.etaUnitCode).toBe("KGM");
    // PCS's existing mapping is untouched (still EA, not re-written).
    expect(mappings.find((m) => m.unitCode === "PCS")?.etaUnitCode).toBe("EA");
  });

  it("404s when masters are not wired, and gates on eta.submit", async () => {
    const { app: bare } = newApp();
    expect((await bare.fetch(req("/unit-mappings/apply-suggestions", { method: "POST", permissions: SUBMIT }))).status).toBe(404);

    const { app } = await fullDeps();
    expect((await app.fetch(req("/unit-mappings/apply-suggestions", { method: "POST", permissions: VIEW }))).status).toBe(403);
  });
});

describe("eta router — tax sub-types", () => {
  it("returns [] when tax rates are not wired", async () => {
    const { app } = newApp();
    expect(await (await app.fetch(req("/tax-subtypes", { permissions: VIEW }))).json()).toEqual([]);
  });

  it("lists only active rates and marks 'auto' unresolved, everything else resolved", async () => {
    const { app, taxRates } = await fullDeps();
    await createTaxRate({ id: "t1", code: "T1", name: "ضريبة أساسية", rate: 14, etaSubType: "V009" }, taxRates);
    await createTaxRate({ id: "t2", code: "T2", name: "ضريبة تلقائية", rate: 5 }, taxRates);
    const inactive = await createTaxRate({ id: "t3", code: "T3", name: "معطلة", rate: 10 }, taxRates);
    await taxRates.update({ ...inactive, status: "inactive" });

    const res = await app.fetch(req("/tax-subtypes", { permissions: VIEW }));
    const body = (await res.json()) as { taxRateId: string; resolved: boolean; etaSubType: string }[];
    expect(body.map((r) => r.taxRateId).sort()).toEqual(["t1", "t2"]);
    expect(body.find((r) => r.taxRateId === "t1")).toMatchObject({ etaSubType: "V009", resolved: true });
    expect(body.find((r) => r.taxRateId === "t2")).toMatchObject({ etaSubType: "auto", resolved: false });
  });
});


/* ------------------------------------------------------------------ */
/* الإيصال الإلكتروني — the B2C receipt surface                        */
/* ------------------------------------------------------------------ */

function countingUuidPort(): EtaReceiptUuidPort & { calls: number } {
  const port = {
    calls: 0,
    async compute(): Promise<string> {
      port.calls += 1;
      return `uuid-${port.calls}`;
    },
  };
  return port;
}

async function receiptApp(uuid?: EtaReceiptUuidPort, deviceSerialNumber: string | null = "POS-0001") {
  const store = createSqliteEtaStore();
  handles.push(store);
  let seq = 0;
  const service = new EtaService({
    config: store.config,
    submissions: store.submissions,
    receiptUuid: uuid,
    now: () => "2026-09-01T10:00:00.000Z",
    newId: () => `sub-${++seq}`,
  });
  await store.branchCodes.save({
    branchId: "b1",
    etaBranchCode: "1",
    deviceSerialNumber,
    posClientId: null,
    hasPosClientSecret: false,
  });
  await store.config.save({
    ...(await store.config.get()),
    taxRegistrationNumber: "123456789",
    activityCode: "4711",
    address: { governorate: "القاهرة", city: "مدينة نصر", street: "شارع", buildingNumber: "1", postalCode: null },
  });
  return {
    app: createEtaRoutes(
      { service, branchCodes: store.branchCodes, companyTradeName: async () => "متجر الاختبار" },
      insecureHeaderAuthContextResolver,
    ),
    service,
    store,
  };
}

const receiptBody = {
  internalId: "RCP-000001",
  issueDateTime: "2026-09-01T10:00:00.000Z",
  receiptType: "sale",
  previousUuid: null,
  seller: { branchId: "b1" },
  buyer: { type: "P", id: null, name: null },
  paymentMethod: "cash",
  lines: [
    {
      internalCode: "SKU-1",
      description: "شاي",
      itemType: "EGS",
      itemCode: "EG-1",
      unitType: "EA",
      quantity: "2",
      unitPrice: "25.00",
      totalSale: "50.00",
      netSale: "50.00",
      total: "57.00",
      taxSubType: "V009",
      taxRate: "14",
      taxAmount: "7.00",
    },
  ],
  totalSales: "50.00",
  netAmount: "50.00",
  totalAmount: "57.00",
  taxTotals: [{ taxType: "T1", amount: "7.00" }],
};

function issue(body: unknown = receiptBody, permissions = "accounting.eta.submit") {
  return req("/receipts", { method: "POST", permissions, body: JSON.stringify(body) });
}

describe("eta router — receipts", () => {
  it("issues a receipt with its UUID and QR, gated behind eta.submit", async () => {
    const { app } = await receiptApp(countingUuidPort());

    expect((await app.fetch(issue(receiptBody, "accounting.eta.view"))).status).toBe(403);

    const res = await app.fetch(issue());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uuid: string; qrValue: string; submission: { documentType: string; status: string } };
    expect(body.uuid).toBe("uuid-1");
    expect(body.qrValue).toContain("/receipts/search/uuid-1/share/");
    expect(body.submission.documentType).toBe("receipt");
    expect(body.submission.status).toBe("ready");
  });

  it("chains receipts from the device's own chain and ignores a caller-stated previousUuid (D283)", async () => {
    const { app } = await receiptApp(countingUuidPort());
    const first = (await (await app.fetch(issue())).json()) as { uuid: string; receiptNo: string };
    expect(first.receiptNo).toBe("RCP-000001");
    const res = await app.fetch(issue({ ...receiptBody, internalId: "RCP-000002", previousUuid: "forged" }));
    expect(res.status).toBe(200);
    const printed = (await (await app.fetch(req("/receipts/RCP-000002", { permissions: VIEW }))).json()) as {
      submission: { payload: { header: { previousUUID: string } } };
    };
    expect(printed.submission.payload.header.previousUUID).toBe(first.uuid);
  });

  it("refuses a refund receipt that names no sale receipt (D282)", async () => {
    const { app } = await receiptApp(countingUuidPort());
    const res = await app.fetch(issue({ ...receiptBody, receiptType: "refund" }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("ETA_REFUND_REFERENCE_REQUIRED");
  });

  it("reprints the same UUID and QR instead of minting a second submission", async () => {
    const uuid = countingUuidPort();
    const { app } = await receiptApp(uuid);

    type Printed = { uuid: string; qrValue: string; submission: { id: string } };
    const first = (await (await app.fetch(issue())).json()) as Printed;
    const again = (await (await app.fetch(issue())).json()) as Printed;

    expect(again.uuid).toBe(first.uuid);
    expect(again.qrValue).toBe(first.qrValue);
    expect(again.submission.id).toBe(first.submission.id);
    expect(uuid.calls).toBe(1);

    const listed = (await (await app.fetch(req("/submissions", { permissions: "accounting.eta.view" }))).json()) as unknown[];
    expect(listed).toHaveLength(1);
  });

  it("serves the stored receipt for a reprint, payload and all", async () => {
    const { app } = await receiptApp(countingUuidPort());
    await app.fetch(issue());

    const res = await app.fetch(req("/receipts/RCP-000001", { permissions: "accounting.eta.view" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      uuid: string;
      submission: { payload: { header: { uuid: string }; seller: { deviceSerialNumber: string } } };
    };
    expect(body.uuid).toBe("uuid-1");
    expect(body.submission.payload.header.uuid).toBe("uuid-1");
    expect(body.submission.payload.seller.deviceSerialNumber).toBe("POS-0001");
  });

  it("404s a reprint of a receipt that was never issued", async () => {
    const { app } = await receiptApp(countingUuidPort());
    const res = await app.fetch(req("/receipts/RCP-999", { permissions: "accounting.eta.view" }));
    expect(res.status).toBe(404);
  });

  it("refuses money that is not an exact decimal string", async () => {
    const { app } = await receiptApp(countingUuidPort());
    const res = await app.fetch(issue({ ...receiptBody, totalAmount: 57 }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("VALIDATION_ERROR");
  });

  it("refuses a receipt with no lines", async () => {
    const { app } = await receiptApp(countingUuidPort());
    expect((await app.fetch(issue({ ...receiptBody, lines: [] }))).status).toBe(400);
  });

  it("reports 501, not a bad request, when no UUID service is configured", async () => {
    const { app } = await receiptApp();
    const res = await app.fetch(issue());
    expect(res.status).toBe(501);
    expect(((await res.json()) as { error: string }).error).toBe("ETA_RECEIPT_UUID_UNAVAILABLE");
  });

  it("counts what has not been reported and what has aged past the reporting window", async () => {
    const { app, service } = await receiptApp(countingUuidPort());
    await app.fetch(issue());
    await app.fetch(
      issue({ ...receiptBody, internalId: "RCP-000002", issueDateTime: "2026-08-20T10:00:00.000Z" }),
    );

    const res = await app.fetch(req("/receipts/summary", { permissions: "accounting.eta.view" }));
    expect(res.status).toBe(200);
    const summary = (await res.json()) as {
      windowHours: number;
      pending: number;
      overdue: number;
      overdueEntries: { internalId: string }[];
    };
    expect(summary.windowHours).toBe(24);
    expect(summary.pending).toBe(2);
    // "now" is the service clock: 2026-09-01T10:00Z, so the August receipt is long past its window.
    expect(summary.overdue).toBe(1);
    expect(summary.overdueEntries[0]?.internalId).toBe("RCP-000002");
    expect((await service.receiptQueueSummary()).pending).toBe(2);
  });

  it("takes the device serial from the branch registration, not from the caller", async () => {
    const { app } = await receiptApp(countingUuidPort());
    const res = await app.fetch(issue({ ...receiptBody, seller: { branchId: "b1", deviceSerialNumber: "SPOOFED" } }));
    expect(res.status).toBe(200);

    const reprint = (await (
      await app.fetch(req("/receipts/RCP-000001", { permissions: "accounting.eta.view" }))
    ).json()) as { submission: { payload: { seller: { deviceSerialNumber: string; branchCode: string } } } };
    expect(reprint.submission.payload.seller.deviceSerialNumber).toBe("POS-0001");
    expect(reprint.submission.payload.seller.branchCode).toBe("1");
  });

  it("refuses, in Arabic and English, a receipt from a branch with no registered device", async () => {
    const { app } = await receiptApp(countingUuidPort(), null);
    const res = await app.fetch(issue());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string; messageEn: string };
    expect(body.error).toBe("ETA_DEVICE_SERIAL_NOT_REGISTERED");
    expect(body.message).toContain("جهاز نقطة البيع");
    expect(body.message).not.toContain("POS device serial number");
    expect(body.messageEn).toContain("POS device serial number");

    const listed = (await (await app.fetch(req("/submissions", { permissions: "accounting.eta.view" }))).json()) as unknown[];
    expect(listed).toHaveLength(0);
  });

  it("gates the summary behind eta.view", async () => {
    const { app } = await receiptApp(countingUuidPort());
    expect((await app.fetch(req("/receipts/summary"))).status).toBe(403);
  });
});
