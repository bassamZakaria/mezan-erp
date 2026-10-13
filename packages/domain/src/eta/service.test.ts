import { describe, it, expect, vi } from "vitest";
import { DEFAULT_ETA_CONFIG, computeEtaReadiness, type EtaConfig, type EtaConfigRepository } from "./config.js";
import type { EtaSubmission, EtaSubmissionRepository, EtaSubmissionStatus } from "./submission.js";
import { EtaService, stubOnlineTransmitPort, type EtaTransmitPort, type EtaEnqueueInput } from "./service.js";
import type { EtaSignerPort } from "./signer.js";
import { EtaPrevalidationSeverity, type EtaPrevalidationFinding } from "./prevalidate.js";
import {
  DuplicateEtaSubmissionError,
  EtaExclusionReasonRequiredError,
  EtaOfflineError,
  InvalidEtaTransitionError,
} from "./errors.js";

class MemConfig implements EtaConfigRepository {
  private cfg: EtaConfig;
  constructor(cfg: EtaConfig) {
    this.cfg = cfg;
  }
  async get() {
    return this.cfg;
  }
  async save(cfg: EtaConfig) {
    this.cfg = cfg;
  }
}

class MemSubmissions implements EtaSubmissionRepository {
  readonly rows = new Map<string, EtaSubmission>();
  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findByInternalId(internalId: string) {
    for (const s of this.rows.values()) if (s.internalId === internalId) return s;
    return null;
  }
  async list(status?: EtaSubmissionStatus) {
    return [...this.rows.values()].filter((s) => (status ? s.status === status : true));
  }
  async statusByEtaUuid(etaUuid: string) {
    for (const s of this.rows.values()) if (s.documentType === "receipt" && s.etaUuid === etaUuid) return s.status;
    return null;
  }
  async create(s: EtaSubmission) {
    this.rows.set(s.id, s);
  }
  async update(s: EtaSubmission) {
    this.rows.set(s.id, s);
  }
}

let counter = 0;
function service(configOverrides: Partial<EtaConfig> = {}, transmit?: EtaTransmitPort, signer?: EtaSignerPort) {
  const config = new MemConfig({ ...DEFAULT_ETA_CONFIG, ...configOverrides });
  const submissions = new MemSubmissions();
  const svc = new EtaService({ config, submissions, transmit, signer, now: () => "2026-08-22T10:00:00.000Z", newId: () => `eta-${++counter}` });
  return { svc, submissions };
}

const fakeSigner: EtaSignerPort = { async sign() { return "CADES-SIGNATURE"; } };

const doc: EtaEnqueueInput = {
  internalId: "INV-000014",
  documentType: "invoice",
  issueDateTime: "2026-08-22T09:00:00Z",
  receiver: { registrationNumber: null, name: "شركة الأمل", type: "P" },
  branchCode: null,
  lines: [{ description: "منتج", itemCode: "EG-123", quantity: "1", unitType: "EA", unitPrice: "100", netTotal: "100", taxSubType: "V009", taxRate: "14", taxAmount: "14" }],
  totalNet: "100",
  totalTax: "14",
  totalAmount: "114",
};

const acceptingPort: EtaTransmitPort = { async transmit() { return { ok: true, etaUuid: "UUID-1" }; } };
const rejectingPort: EtaTransmitPort = { async transmit() { return { ok: false, errors: ["رقم تسجيل غير صالح"] }; } };

describe("EtaService — queue + payload", () => {
  it("enqueues a confirmed document as جاهز with a built payload", async () => {
    const { svc } = service();
    const s = await svc.enqueue(doc);
    expect(s.status).toBe("ready");
    expect(s.internalId).toBe("INV-000014");
    const payload = s.payload as { totalAmount: string; invoiceLines: unknown[] };
    expect(payload.totalAmount).toBe("114");
    expect(payload.invoiceLines).toHaveLength(1);
  });

  it("rejects a duplicate document", async () => {
    const { svc } = service();
    await svc.enqueue(doc);
    await expect(svc.enqueue(doc)).rejects.toThrow(DuplicateEtaSubmissionError);
  });
});

describe("EtaService — lifecycle", () => {
  it("stubbed online transmit is refused offline and leaves the document queued (جاهز)", async () => {
    const { svc } = service({}, stubOnlineTransmitPort());
    const s = await svc.enqueue(doc);
    await expect(svc.submit(s.id)).rejects.toThrow(EtaOfflineError);
    const still = await svc.list("ready");
    expect(still).toHaveLength(1);
  });

  it("drives جاهز → مرسل → مقبول with a live transmit port", async () => {
    const { svc } = service({}, acceptingPort);
    const s = await svc.enqueue(doc);
    const submitted = await svc.submit(s.id);
    expect(submitted.status).toBe("submitted");
    expect(submitted.submittedAt).toBe("2026-08-22T10:00:00.000Z");
    const accepted = await svc.markAccepted(s.id, "UUID-1");
    expect(accepted.status).toBe("accepted");
    expect(accepted.etaUuid).toBe("UUID-1");
  });

  it("moves to أخطاء on a rejection and can be resubmitted", async () => {
    const { svc } = service({}, rejectingPort);
    const s = await svc.enqueue(doc);
    const errored = await svc.submit(s.id);
    expect(errored.status).toBe("error");
    expect(errored.errors[0]).toContain("غير صالح");
  });

  it("signs a v1.0 e-seal document with the external signer, then transmits it", async () => {
    const { svc } = service({ signingMethod: "eseal" }, acceptingPort, fakeSigner);
    const s = await svc.enqueue(doc);
    const submitted = await svc.submit(s.id);
    expect(submitted.status).toBe("submitted");
    expect(submitted.signature).toBe("CADES-SIGNATURE");
  });

  it("routes a v1.0 e-seal document to بانتظار التوقيع before transmission", async () => {
    const { svc } = service({ signingMethod: "eseal" }, acceptingPort);
    const s = await svc.enqueue(doc);
    const pending = await svc.submit(s.id);
    expect(pending.status).toBe("pending_signature");
    // No signing agent is wired, so the row says why it is parked...
    expect(pending.errors[0]).toContain("ختم إلكتروني");
    // ...and pressing إرسال again parks it again rather than transmitting an
    // unsigned version-1.0 document, which is what it used to do.
    const again = await svc.submit(s.id);
    expect(again.status).toBe("pending_signature");
  });

  // guards P-1 — an unsigned v1.0 document must not be transmitted; the row it
  // leaves behind stays بانتظار التوقيع and the reason on it is Arabic.
  it("refuses to transmit a v1.0 document when no signing program is configured", async () => {
    const { svc, submissions } = service({ signingMethod: "eseal" }, acceptingPort);
    const s = await svc.enqueue(doc);
    await svc.submit(s.id);
    await svc.submit(s.id);
    const after = submissions.rows.get(s.id)!;
    expect(after.status).toBe("pending_signature");
    expect(after.errors[0]).toContain("ختم إلكتروني");
  });

  // guards P-1 — the queue driver a scheduler calls.
  it("processQueue signs and transmits everything pending, then polls what was already sent", async () => {
    const polling: EtaTransmitPort = {
      async transmit() { return { ok: true, etaUuid: "UUID-1", submissionId: "SUB-1" }; },
      async fetchStatus() { return { state: "accepted" as const, errors: [] }; },
    };
    const { svc } = service({ signingMethod: "eseal" }, polling, fakeSigner);
    const s = await svc.enqueue(doc);

    const result = await svc.processQueue();
    expect(result.submitted.map((x) => x.id)).toEqual([s.id]);
    expect(result.accepted.map((x) => x.id)).toEqual([s.id]);
    expect((await svc.findById(s.id))!.status).toBe("accepted");
  });

  it("a queue pass holds a document back on its stored findings without attempting it, every pass, until it is rebuilt without them", async () => {
    let transmitted = 0;
    const counting: EtaTransmitPort = { async transmit() { transmitted++; return { ok: true, etaUuid: "UUID-B" }; } };
    const { svc } = service({}, counting);
    const blocking: EtaPrevalidationFinding = {
      code: "BUYER_TIN_MISSING" as EtaPrevalidationFinding["code"],
      severity: EtaPrevalidationSeverity.Blocking,
      messageAr: "الرقم الضريبي للعميل ناقص",
      messageEn: "The buyer's tax registration number is missing",
      fixHintAr: "سجّله على بطاقة العميل",
      fixHintEn: "Record it on the customer card",
      fixScreen: "customer" as EtaPrevalidationFinding["fixScreen"],
    };
    const held = await svc.enqueue(doc, [blocking]);
    const attempts = vi.spyOn(svc, "submit");

    for (const pass of [1, 2]) {
      const result = await svc.processQueue();
      expect([pass, result.blocked, result.submitted.length]).toEqual([pass, [held.id], 0]);
      expect((await svc.submitAllReady()).blocked).toEqual([held.id]);
    }
    expect(attempts).not.toHaveBeenCalled();
    const untouched = (await svc.findById(held.id))!;
    expect([transmitted, untouched.status, untouched.updatedAt, untouched.transmitLog.length]).toEqual([0, "ready", held.updatedAt, 0]);

    await svc.requeue(held.id, { payload: untouched.payload, prevalidation: [] });
    const cleared = await svc.processQueue();
    expect([cleared.blocked, cleared.submitted.map((x) => x.id), transmitted]).toEqual([[], [held.id], 1]);
    expect(attempts.mock.calls).toEqual([[held.id]]);
  });

  // guards P-1 — an install with no credentials opens no socket and loses nothing.
  it("processQueue leaves an offline document queued and names it", async () => {
    const { svc } = service({}, stubOnlineTransmitPort());
    const s = await svc.enqueue(doc);
    const result = await svc.processQueue();
    expect(result.queued).toEqual([s.id]);
    expect((await svc.findById(s.id))!.status).toBe("ready");
  });

  // guards P-1 — the transmit evidence lands on the submission record.
  it("records every request and response of a transmit attempt on the submission", async () => {
    const logging: EtaTransmitPort = {
      async transmit() {
        return {
          ok: true,
          etaUuid: "UUID-1",
          submissionId: "SUB-1",
          log: [{ at: "2026-08-22T10:00:00.000Z", attempt: 1, method: "POST", url: "https://eta/documentsubmissions", requestBody: "{}", status: 200, responseBody: "{}", error: null }],
        };
      },
    };
    const { svc } = service({}, logging);
    const s = await svc.enqueue(doc);
    const submitted = await svc.submit(s.id);
    expect(submitted.transmitLog).toHaveLength(1);
    expect(submitted.gatewaySubmissionId).toBe("SUB-1");
  });

  // guards P-1 — اختبار الاتصال must report what actually happened, not a fixed answer.
  it("testConnection reports missing credentials without touching the port, and the port's answer once set", async () => {
    let called = 0;
    const checking: EtaTransmitPort = {
      async transmit() { return { ok: true }; },
      async checkCredentials() {
        called += 1;
        return { ok: true, reason: "connected" as const, detail: null, identityUrl: "https://id.preprod.eta.gov.eg", checkedAt: "2026-08-22T10:00:00.000Z" };
      },
    };
    const unset = service({}, checking);
    await expect(unset.svc.testConnection()).resolves.toMatchObject({ ok: false, reason: "missing_credentials" });
    expect(called).toBe(0);

    const set = service({ clientId: "cid", hasClientSecret: true }, checking);
    await expect(set.svc.testConnection()).resolves.toMatchObject({ ok: true, reason: "connected" });
    expect(called).toBe(1);
  });

  it("requires a reason to exclude and blocks excluding an accepted document", async () => {
    const { svc } = service({}, acceptingPort);
    const s = await svc.enqueue(doc);
    await expect(svc.exclude(s.id, "  ")).rejects.toThrow(EtaExclusionReasonRequiredError);
    const excluded = await svc.exclude(s.id, "مستند تجريبي");
    expect(excluded.status).toBe("excluded");
    expect(excluded.exclusionReason).toBe("مستند تجريبي");

    const s2 = await svc.enqueue({ ...doc, internalId: "INV-000015" });
    await svc.submit(s2.id);
    await svc.markAccepted(s2.id, "UUID-2");
    await expect(svc.exclude(s2.id, "x")).rejects.toThrow(InvalidEtaTransitionError);
  });

  it("submitAllReady collects offline-queued documents rather than throwing", async () => {
    const { svc } = service({}, stubOnlineTransmitPort());
    await svc.enqueue(doc);
    await svc.enqueue({ ...doc, internalId: "INV-000015" });
    const result = await svc.submitAllReady();
    expect(result.submitted).toHaveLength(0);
    expect(result.queued).toHaveLength(2);
  });
});

describe("computeEtaReadiness", () => {
  it("is 0% for the default (unconfigured) config and 100% when fully set", () => {
    expect(computeEtaReadiness(DEFAULT_ETA_CONFIG).percent).toBe(0);
    const full: EtaConfig = {
      ...DEFAULT_ETA_CONFIG,
      taxRegistrationNumber: "123456789",
      activityCode: "4610",
      address: { governorate: "القاهرة", city: "مدينة نصر", street: "شارع", buildingNumber: "1", postalCode: null },
      clientId: "cid",
      hasClientSecret: true,
    };
    expect(computeEtaReadiness(full).percent).toBe(100);
  });
});
