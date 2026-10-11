import { describe, it, expect } from "vitest";
import { DEFAULT_ETA_CONFIG, computeEtaReadiness, type EtaConfig, type EtaConfigRepository } from "./config.js";
import type { EtaSubmission, EtaSubmissionRepository, EtaSubmissionStatus } from "./submission.js";
import { ETA_UNRECORDED_SUBMISSION_CODE, EtaService, stubOnlineTransmitPort, type EtaTransmitPort, type EtaEnqueueInput } from "./service.js";
import { ConnectionTurnLostError } from "../audit/audit-event.js";
import type { EtaSignerPort } from "./signer.js";
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

describe("EtaService — one sender per document", () => {
  function slowPort() {
    let answer!: (result: { ok: true; etaUuid: string }) => void;
    let calls = 0;
    const port: EtaTransmitPort = {
      transmit: () =>
        new Promise((resolve) => {
          calls += 1;
          answer = resolve;
        }),
    };
    return { port, answer: () => answer({ ok: true, etaUuid: "UUID-1" }), calls: () => calls };
  }

  it("refuses a second submit while the first is with the authority, and transmits once", async () => {
    const slow = slowPort();
    const { svc } = service({}, slow.port);
    const queued = await svc.enqueue(doc);
    const first = svc.submit(queued.id);
    await new Promise((resolve) => setImmediate(resolve));

    await expect(svc.submit(queued.id)).rejects.toMatchObject({ code: "ETA_SUBMISSION_IN_PROGRESS" });

    slow.answer();
    expect((await first).status).toBe("submitted");
    expect(slow.calls()).toBe(1);
  });

  it("refuses to exclude a document in flight, so the outcome about to be written cannot overwrite the exclusion", async () => {
    const slow = slowPort();
    const { svc } = service({}, slow.port);
    const queued = await svc.enqueue(doc);
    const first = svc.submit(queued.id);
    await new Promise((resolve) => setImmediate(resolve));

    await expect(svc.exclude(queued.id, "أُدخل بالخطأ")).rejects.toMatchObject({ code: "ETA_SUBMISSION_IN_PROGRESS" });

    slow.answer();
    expect((await first).status).toBe("submitted");
  });

  it("leaves a document in flight queued in a batch run rather than failing the run", async () => {
    const slow = slowPort();
    const { svc } = service({}, slow.port);
    const queued = await svc.enqueue(doc);
    const first = svc.submit(queued.id);
    await new Promise((resolve) => setImmediate(resolve));

    expect(await svc.submitAllReady()).toEqual({ submitted: [], queued: [queued.id] });

    slow.answer();
    await first;
  });

  it("frees the document once the attempt fails, so the next press is answered rather than told it is still being sent", async () => {
    let attempts = 0;
    const port: EtaTransmitPort = {
      async transmit() {
        attempts += 1;
        throw new Error("socket hang up");
      },
    };
    const { svc } = service({}, port);
    const queued = await svc.enqueue(doc);
    await expect(svc.submit(queued.id)).rejects.toThrow("socket hang up");

    const next = await svc.submit(queued.id);
    expect(next.status).toBe("error");
    expect(next.rejectionCodes).toEqual([ETA_UNRECORDED_SUBMISSION_CODE]);
    expect(attempts).toBe(1);
  });
});

describe("EtaService — a document handed to the authority whose answer was never recorded", () => {
  const lostTurn = () => new ConnectionTurnLostError(10_000, { completed: { value: { status: 200, body: "{}" } } });

  function lossyPort(overrides: Partial<EtaTransmitPort> = {}) {
    const calls = { transmit: 0, fetchStatus: 0 };
    let lose = true;
    const port: EtaTransmitPort = {
      async transmit() {
        calls.transmit += 1;
        if (lose) throw lostTurn();
        return { ok: true, etaUuid: "UUID-AFTER" };
      },
      ...overrides,
    };
    return { port, calls, stopLosing: () => (lose = false) };
  }

  it("is marked as sent before the call, so a lost turn leaves a trace and the next drive does not send it again", async () => {
    const { port, calls } = lossyPort();
    const { svc, submissions } = service({}, port);
    const queued = await svc.enqueue(doc);

    await expect(svc.submit(queued.id)).rejects.toBeInstanceOf(ConnectionTurnLostError);
    const afterLoss = submissions.rows.get(queued.id)!;
    expect(afterLoss.status).toBe("ready");
    expect(afterLoss.transmitStartedAt).toBe("2026-08-22T10:00:00.000Z");

    const second = await svc.submit(queued.id);
    expect(calls.transmit).toBe(1);
    expect(second.status).toBe("error");
    expect(second.rejectionCodes).toEqual([ETA_UNRECORDED_SUBMISSION_CODE]);
    expect(second.errors[0]).toContain("لم يُسجَّل ردّها");

    await svc.processQueue();
    expect(calls.transmit).toBe(1);
  });

  it("asks the authority what it holds when the document's UUID is known, and records that instead of sending again", async () => {
    const { port, calls } = lossyPort({
      async fetchStatus() {
        calls.fetchStatus += 1;
        return { state: "accepted", errors: [] };
      },
    });
    const { svc, submissions } = service({}, port);
    const queued = await svc.enqueue(doc);
    await expect(svc.submit(queued.id)).rejects.toBeInstanceOf(ConnectionTurnLostError);
    submissions.rows.set(queued.id, { ...submissions.rows.get(queued.id)!, etaUuid: "UUID-KNOWN" });

    const reconciled = await svc.submit(queued.id);

    expect(calls).toEqual({ transmit: 1, fetchStatus: 1 });
    expect(reconciled.status).toBe("accepted");
    expect(reconciled.transmitStartedAt).toBeNull();
  });

  it("sends again only when the authority says it has never seen the document", async () => {
    const { port, calls, stopLosing } = lossyPort({
      async fetchStatus() {
        calls.fetchStatus += 1;
        return {
          state: "unknown",
          errors: ["404"],
          log: [{ at: "t", attempt: 1, method: "GET", url: "u", requestBody: null, status: 404, responseBody: "", error: null }],
        };
      },
    });
    const { svc, submissions } = service({}, port);
    const queued = await svc.enqueue(doc);
    await expect(svc.submit(queued.id)).rejects.toBeInstanceOf(ConnectionTurnLostError);
    submissions.rows.set(queued.id, { ...submissions.rows.get(queued.id)!, etaUuid: "UUID-KNOWN" });
    stopLosing();

    const resent = await svc.submit(queued.id);

    expect(calls.transmit).toBe(2);
    expect(resent.status).toBe("submitted");
    expect(resent.transmitStartedAt).toBeNull();
  });

  it("clears the mark when the answer is recorded, and when the authority was never reached", async () => {
    const accepted = service({}, acceptingPort);
    const a = await accepted.svc.enqueue(doc);
    expect((await accepted.svc.submit(a.id)).transmitStartedAt).toBeNull();

    const offline = service({}, { async transmit() { throw new EtaOfflineError(); } });
    const b = await offline.svc.enqueue(doc);
    await expect(offline.svc.submit(b.id)).rejects.toBeInstanceOf(EtaOfflineError);
    expect(offline.submissions.rows.get(b.id)!.transmitStartedAt).toBeNull();
    expect(offline.submissions.rows.get(b.id)!.status).toBe("ready");
  });

  it("lets a person settle it: record the authority's UUID, or queue it again to send", async () => {
    const first = lossyPort();
    const one = service({}, first.port);
    const a = await one.svc.enqueue(doc);
    await expect(one.svc.submit(a.id)).rejects.toBeInstanceOf(ConnectionTurnLostError);
    await one.svc.submit(a.id);
    const marked = await one.svc.markAccepted(a.id, "UUID-FROM-PORTAL");
    expect(marked.status).toBe("accepted");
    expect(marked.transmitStartedAt).toBeNull();

    const second = lossyPort();
    const two = service({}, second.port);
    const b = await two.svc.enqueue(doc);
    await expect(two.svc.submit(b.id)).rejects.toBeInstanceOf(ConnectionTurnLostError);
    await two.svc.submit(b.id);
    const requeued = await two.svc.requeue(b.id, { payload: b.payload, prevalidation: [] });
    expect(requeued.transmitStartedAt).toBeNull();
    second.stopLosing();
    expect((await two.svc.submit(b.id)).status).toBe("submitted");
    expect(second.calls.transmit).toBe(2);
  });
});
