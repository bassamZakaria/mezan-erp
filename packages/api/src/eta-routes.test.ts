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

function newApp(transmit?: EtaTransmitPort) {
  const store = createSqliteEtaStore();
  handles.push(store);
  const service = new EtaService({ config: store.config, submissions: store.submissions, transmit, now: () => "2026-08-22T10:00:00.000Z", newId: () => "sub-1" });
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

    // GET /submissions serializes the queue row without the payload the queue
    // itself holds — nothing reachable from this router ever surfaces it, so
    // there is no way for a caller (screen or API consumer) to inspect what
    // will actually be filed.
    const list = (await (await app.fetch(req("/submissions", { permissions: VIEW }))).json()) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]!)).not.toContain("payload");
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

describe("eta router — the e-seal hold before transmit", () => {
  it("a ready submission moves to بانتظار التوقيع under eseal signing, without ever calling transmit", async () => {
    const failIfCalled: EtaTransmitPort = {
      async transmit(): Promise<EtaTransmitResult> {
        throw new Error("transmit must not be called while awaiting the e-seal");
      },
    };
    const { app, service } = newApp(failIfCalled);
    await app.fetch(req("/config", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ signingMethod: "eseal" }) }));
    await service.enqueue(invoiceInput);

    const res = await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; submittedAt: string | null };
    expect(body.status).toBe("pending_signature");
    expect(body.submittedAt).toBeNull();
  });

  it("a second submit call on a pending_signature document DOES transmit, moving it on to submitted", async () => {
    const { app, service } = newApp(accepting);
    await app.fetch(req("/config", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ signingMethod: "eseal" }) }));
    await service.enqueue(invoiceInput);
    await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));

    const res = await app.fetch(req("/submissions/sub-1/submit", { method: "POST", permissions: SUBMIT }));
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("submitted");
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
  it("reports missing_credentials before any clientId/secret is on file, and offline once both are — it never fakes a handshake", async () => {
    const { app } = newApp();
    const before = await app.fetch(req("/test-connection", { method: "POST", permissions: SUBMIT }));
    const beforeBody = (await before.json()) as { ok: boolean; reason: string };
    expect(beforeBody.ok).toBe(false);
    expect(beforeBody.reason).toBe("missing_credentials");

    await app.fetch(req("/config", { method: "PUT", permissions: SUBMIT, body: JSON.stringify({ clientId: "cid", clientSecret: "shh" }) }));
    const after = await app.fetch(req("/test-connection", { method: "POST", permissions: SUBMIT }));
    const afterBody = (await after.json()) as { ok: boolean; reason: string };
    expect(afterBody.ok).toBe(false);
    expect(afterBody.reason).toBe("offline");
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
    await branchCodes.save({ branchId: "b1", etaBranchCode: "1" });

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
    expect(before).toEqual([{ branchId: "b1", branchCode: "MAIN", branchName: "الفرع الرئيسي", etaBranchCode: null }]);

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
