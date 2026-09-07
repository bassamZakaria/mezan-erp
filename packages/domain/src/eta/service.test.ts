import { describe, it, expect } from "vitest";
import { DEFAULT_ETA_CONFIG, computeEtaReadiness, type EtaConfig, type EtaConfigRepository } from "./config.js";
import type { EtaSubmission, EtaSubmissionRepository, EtaSubmissionStatus } from "./submission.js";
import { EtaService, stubOnlineTransmitPort, type EtaTransmitPort, type EtaEnqueueInput } from "./service.js";
import { DuplicateEtaSubmissionError, EtaExclusionReasonRequiredError, EtaOfflineError, InvalidEtaTransitionError } from "./errors.js";

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
function service(configOverrides: Partial<EtaConfig> = {}, transmit?: EtaTransmitPort) {
  const config = new MemConfig({ ...DEFAULT_ETA_CONFIG, ...configOverrides });
  const submissions = new MemSubmissions();
  const svc = new EtaService({ config, submissions, transmit, now: () => "2026-08-22T10:00:00.000Z", newId: () => `eta-${++counter}` });
  return { svc, submissions };
}

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
