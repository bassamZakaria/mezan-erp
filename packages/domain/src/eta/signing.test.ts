import { describe, it, expect } from "vitest";
import { DEFAULT_ETA_CONFIG, type EtaConfig, type EtaConfigRepository } from "./config.js";
import type { EtaSubmission, EtaSubmissionRepository, EtaSubmissionStatus } from "./submission.js";
import { EtaService, type EtaTransmitPort } from "./service.js";
import { InvalidEtaTransitionError } from "./errors.js";
import {
  attachEtaSignature,
  etaComplianceNotice,
  etaPayloadIsSigned,
  unavailableEsealSigningPort,
  EtaSigningUnavailableError,
  type EtaSignatureResult,
  type EtaSigningPort,
} from "./signing.js";
import type { EtaEnqueueInput } from "./service.js";

class MemConfig implements EtaConfigRepository {
  constructor(private cfg: EtaConfig) {}
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

/**
 * The test double for a signing agent — exactly the shape a real HSM client
 * would implement. That it needs nothing but this interface is the point of
 * the seam.
 */
function fakeSigningAgent(): EtaSigningPort & { calls: number } {
  const port = {
    calls: 0,
    async sign(): Promise<EtaSignatureResult> {
      port.calls += 1;
      return {
        signatureType: "I",
        value: `SEAL-${port.calls}`,
        signedAt: "2026-08-22T10:00:00.000Z",
        certificateSubject: "CN=Mezan Test Seal",
      };
    },
  };
  return port;
}

const accepting: EtaTransmitPort = { async transmit() { return { ok: true, etaUuid: "UUID-1" }; } };

const doc: EtaEnqueueInput = {
  internalId: "INV-000014",
  documentType: "invoice",
  issueDateTime: "2026-08-22T09:00:00Z",
  receiver: { registrationNumber: null, name: "شركة الأمل", type: "P" },
  branchCode: null,
  lines: [],
  totalNet: "0",
  totalTax: "0",
  totalAmount: "0",
};

let ids = 0;
function service(overrides: { signing?: EtaSigningPort; signingMethod?: EtaConfig["signingMethod"] } = {}) {
  const submissions = new MemSubmissions();
  const svc = new EtaService({
    config: new MemConfig({ ...DEFAULT_ETA_CONFIG, signingMethod: overrides.signingMethod ?? "eseal" }),
    submissions,
    transmit: accepting,
    signing: overrides.signing,
    now: () => "2026-08-22T10:00:00.000Z",
    newId: () => `eta-${++ids}`,
  });
  return { svc, submissions };
}

describe("attachEtaSignature", () => {
  it("puts the seal in the document's own signatures array, where the authority checks it", () => {
    const signed = attachEtaSignature({ internalId: "INV-1" }, {
      signatureType: "I",
      value: "SEAL",
      signedAt: "2026-08-22T10:00:00.000Z",
    }) as { internalId: string; signatures: { signatureType: string; value: string }[] };

    expect(signed.internalId).toBe("INV-1");
    expect(signed.signatures).toEqual([{ signatureType: "I", value: "SEAL" }]);
  });

  it("appends rather than replacing, so a second seal does not erase the first", () => {
    const once = attachEtaSignature({}, { signatureType: "I", value: "A", signedAt: "t" });
    const twice = attachEtaSignature(once, { signatureType: "S", value: "B", signedAt: "t" }) as {
      signatures: unknown[];
    };
    expect(twice.signatures).toHaveLength(2);
  });

  it("tells a signed payload from an unsigned one", () => {
    expect(etaPayloadIsSigned(null)).toBe(false);
    expect(etaPayloadIsSigned({})).toBe(false);
    expect(etaPayloadIsSigned({ signatures: [] })).toBe(false);
    expect(etaPayloadIsSigned({ signatures: [{ value: "A" }] })).toBe(true);
  });
});

describe("the default signing port", () => {
  it("refuses rather than producing a placeholder seal", async () => {
    const submission = { id: "s1" } as EtaSubmission;
    await expect(unavailableEsealSigningPort().sign(submission, DEFAULT_ETA_CONFIG)).rejects.toBeInstanceOf(
      EtaSigningUnavailableError,
    );
  });
});

describe("EtaService.submit under an e-seal config", () => {
  it("parks the document and records why, instead of leaving the row silent", async () => {
    const { svc } = service();
    const s = await svc.enqueue(doc);
    const parked = await svc.submit(s.id);

    expect(parked.status).toBe("pending_signature");
    expect(parked.errors).toHaveLength(1);
    expect(parked.errors[0]).toContain("ختم إلكتروني");
    expect(etaPayloadIsSigned(parked.payload)).toBe(false);
  });

  it("never transmits an unsigned version-1.0 document, however many times إرسال is pressed", async () => {
    const { svc } = service();
    const s = await svc.enqueue(doc);
    for (let i = 0; i < 3; i += 1) {
      expect((await svc.submit(s.id)).status).toBe("pending_signature");
    }
  });

  it("signs and then transmits once an agent is supplied — configuration, not surgery", async () => {
    const agent = fakeSigningAgent();
    const { svc } = service({ signing: agent });
    const s = await svc.enqueue(doc);
    const submitted = await svc.submit(s.id);

    expect(agent.calls).toBe(1);
    expect(submitted.status).toBe("submitted");
    expect(submitted.etaUuid).toBe("UUID-1");
    expect(etaPayloadIsSigned(submitted.payload)).toBe(true);
    expect((submitted.payload as { signatures: { value: string }[] }).signatures[0]?.value).toBe("SEAL-1");
  });

  it("does not seal a document twice when a parked one is retried after the agent arrives", async () => {
    const { svc, submissions } = service();
    const s = await svc.enqueue(doc);
    await svc.submit(s.id);

    const agent = fakeSigningAgent();
    const withAgent = new EtaService({
      config: new MemConfig({ ...DEFAULT_ETA_CONFIG, signingMethod: "eseal" }),
      submissions,
      transmit: accepting,
      signing: agent,
      now: () => "2026-08-22T11:00:00.000Z",
    });

    expect((await withAgent.submit(s.id)).status).toBe("submitted");
    // A transmitted document is not resubmittable, so the seal is produced once.
    await expect(withAgent.submit(s.id)).rejects.toBeInstanceOf(InvalidEtaTransitionError);
    expect(agent.calls).toBe(1);
  });

  it("leaves the unsigned path alone when the config asks for no signature", async () => {
    const agent = fakeSigningAgent();
    const { svc } = service({ signingMethod: "none", signing: agent });
    const s = await svc.enqueue(doc);

    expect((await svc.submit(s.id)).status).toBe("submitted");
    expect(agent.calls).toBe(0);
  });

  it("lets a signing failure that is not an availability problem surface, rather than parking it", async () => {
    const angry: EtaSigningPort = {
      async sign(): Promise<EtaSignatureResult> {
        throw new Error("HSM refused: certificate expired");
      },
    };
    const { svc } = service({ signing: angry });
    const s = await svc.enqueue(doc);
    await expect(svc.submit(s.id)).rejects.toThrow("certificate expired");
  });
});


describe("etaComplianceNotice — what the printed copy must not hide", () => {
  it("says nothing when a production document has been filed normally", () => {
    expect(etaComplianceNotice({ environment: "production", status: "accepted" })).toBeNull();
    expect(etaComplianceNotice({ environment: "production" })).toBeNull();
  });

  it("marks a test-environment document as never filed", () => {
    expect(etaComplianceNotice({ environment: "preproduction", status: "accepted" })).toBe(
      "وضع الاختبار — لم تُقدَّم هذه الوثيقة إلى مصلحة الضرائب",
    );
  });

  it("marks a document parked awaiting the e-seal", () => {
    expect(etaComplianceNotice({ environment: "production", status: "pending_signature" })).toBe(
      "في انتظار الختم الإلكتروني — لم تُرسل بعد",
    );
  });

  it("says both when both are true", () => {
    expect(etaComplianceNotice({ environment: "preproduction", status: "pending_signature" })).toBe(
      "وضع الاختبار — لم تُقدَّم هذه الوثيقة إلى مصلحة الضرائب · في انتظار الختم الإلكتروني — لم تُرسل بعد",
    );
  });
});
