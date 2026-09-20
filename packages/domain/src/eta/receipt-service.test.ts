import { describe, it, expect } from "vitest";
import { DEFAULT_ETA_CONFIG, type EtaConfig, type EtaConfigRepository } from "./config.js";
import type { EtaSubmission, EtaSubmissionRepository, EtaSubmissionStatus } from "./submission.js";
import { EtaService } from "./service.js";
import { EtaOfflineError, EtaReissueNotRejectedError, EtaReissueSameInternalIdError, EtaReissueWindowExpiredError } from "./errors.js";
import { EtaReceiptUuidUnavailableError, type EtaReceiptInput, type EtaReceiptUuidPort } from "./receipt.js";
import { createInMemoryEtaReceiptChain, type EtaReceiptChainRepository } from "./receipt-chain.js";

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
 * A test double for the SHA-256 port: it is a counter, not a hash, so a second
 * call for the same receipt would produce a visibly different value. That is
 * what makes the idempotence assertions below meaningful.
 */
function countingUuidPort(): CountingPort {
  const port = {
    calls: 0,
    async compute(): Promise<string> {
      port.calls += 1;
      return `uuid-${port.calls}`;
    },
  };
  return port;
}

let ids = 0;

/** A tenant whose registration is complete, so a receipt is not refused as not-ready. */
const READY: EtaConfig = {
  ...DEFAULT_ETA_CONFIG,
  taxRegistrationNumber: "123456789",
  activityCode: "4711",
  address: { governorate: "القاهرة", city: "مدينة نصر", street: "شارع", buildingNumber: "1", postalCode: null },
};
type CountingPort = EtaReceiptUuidPort & { calls: number };

function service(overrides: { config?: Partial<EtaConfig>; uuid?: CountingPort; now?: string } = {}) {
  const submissions = new MemSubmissions();
  const uuid = overrides.uuid ?? countingUuidPort();
  const svc = new EtaService({
    config: new MemConfig({ ...READY, ...overrides.config }),
    submissions,
    receiptUuid: uuid,
    now: () => overrides.now ?? "2026-09-01T10:00:00.000Z",
    newId: () => `eta-${++ids}`,
  });
  return { svc, submissions, uuid };
}

const receipt: EtaReceiptInput = {
  internalId: "RCP-000001",
  issueDateTime: "2026-09-01T10:00:00.000Z",
  receiptType: "sale",
  previousUuid: null,
  seller: { deviceSerialNumber: "POS-0001", branchCode: "1", companyTradeName: "متجر" },
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

describe("enqueueReceipt", () => {
  it("queues the receipt as جاهز with the UUID already assigned", async () => {
    const { svc, submissions } = service();
    const printed = await svc.enqueueReceipt(receipt);

    expect(printed.submission.documentType).toBe("receipt");
    expect(printed.submission.status).toBe("ready");
    expect(printed.uuid).toBe("uuid-1");
    expect(printed.submission.etaUuid).toBe("uuid-1");
    expect(submissions.rows.size).toBe(1);
  });

  it("writes the UUID into the payload header, where the authority reads it", async () => {
    const { svc } = service();
    const printed = await svc.enqueueReceipt(receipt);
    const payload = printed.submission.payload as { header: { uuid: string } };
    expect(payload.header.uuid).toBe("uuid-1");
  });

  it("builds the QR from the assigned UUID, the sale moment, the total and the issuer's RIN", async () => {
    const { svc } = service({ config: { environment: "production", taxRegistrationNumber: "674859545" } });
    const printed = await svc.enqueueReceipt(receipt);
    expect(printed.qrValue).toBe(
      "https://invoicing.eta.gov.eg/receipts/search/uuid-1/share/2026-09-01T10:00:00Z#Total:57.00000,IssuerRIN:674859545",
    );
    expect(printed.receiptNo).toBe("RCP-000001");
  });

  it("refuses when no UUID port is wired rather than printing a QR that resolves to nothing", async () => {
    const submissions = new MemSubmissions();
    const svc = new EtaService({ config: new MemConfig(READY), submissions });
    await expect(svc.enqueueReceipt(receipt)).rejects.toBeInstanceOf(EtaReceiptUuidUnavailableError);
    expect(submissions.rows.size).toBe(0);
  });
});

describe("reprint idempotence — the same paper carries the same identifier", () => {
  it("returns the first submission unchanged instead of minting a second", async () => {
    const { svc, submissions, uuid } = service();
    const first = await svc.enqueueReceipt(receipt);
    const reprint = await svc.enqueueReceipt(receipt);

    expect(reprint.submission.id).toBe(first.submission.id);
    expect(reprint.uuid).toBe(first.uuid);
    expect(reprint.qrValue).toBe(first.qrValue);
    expect(submissions.rows.size).toBe(1);
    expect(uuid.calls).toBe(1);
  });

  it("does not throw the duplicate error the invoice path throws", async () => {
    const { svc } = service();
    await svc.enqueueReceipt(receipt);
    await expect(svc.enqueueReceipt(receipt)).resolves.toBeDefined();
  });

  it("reprints an already-reported receipt with the identifier it was reported under", async () => {
    const { svc, submissions } = service();
    const first = await svc.enqueueReceipt(receipt);
    const stored = submissions.rows.get(first.submission.id) as EtaSubmission;
    submissions.rows.set(stored.id, { ...stored, status: "accepted" });

    const reprint = await svc.receiptForPrint("RCP-000001");
    expect(reprint?.uuid).toBe(first.uuid);
    expect(reprint?.qrValue).toBe(first.qrValue);
    expect(reprint?.submission.status).toBe("accepted");
  });

  it("does not resurrect a receipt as an invoice reprint", async () => {
    const { svc } = service();
    await svc.enqueue({
      internalId: "INV-1",
      documentType: "invoice",
      issueDateTime: "2026-09-01T10:00:00.000Z",
      receiver: { registrationNumber: null, name: "عميل", type: "P" },
      branchCode: null,
      lines: [],
      totalNet: "0",
      totalTax: "0",
      totalAmount: "0",
    });
    expect(await svc.receiptForPrint("INV-1")).toBeNull();
    expect(await svc.receiptForPrint("nothing")).toBeNull();
  });
});

describe("receiptQueueSummary — the pending count a shop can see", () => {
  it("reports what has not reached the authority and what has aged past the window", async () => {
    const { svc, submissions } = service();
    await svc.enqueueReceipt(receipt);
    await svc.enqueueReceipt({ ...receipt, internalId: "RCP-000002", issueDateTime: "2026-09-04T09:00:00.000Z" });

    const summary = await svc.receiptQueueSummary("2026-09-05T10:00:00.000Z");
    expect(summary.pending).toBe(2);
    expect(summary.overdue).toBe(2);
    expect(summary.overdueEntries[0]?.internalId).toBe("RCP-000001");
    expect(summary.windowHours).toBe(24);
    expect(submissions.rows.size).toBe(2);
  });

  it("drops a receipt out of the pending count once the authority accepts it", async () => {
    const { svc, submissions } = service();
    const printed = await svc.enqueueReceipt(receipt);
    const stored = submissions.rows.get(printed.submission.id) as EtaSubmission;
    submissions.rows.set(stored.id, { ...stored, status: "accepted" });

    expect((await svc.receiptQueueSummary("2026-09-30T00:00:00.000Z")).pending).toBe(0);
  });
});

describe("the e-seal never gates a consumer receipt", () => {
  it("submits a receipt for an eseal tenant instead of parking it in بانتظار التوقيع", async () => {
    const { svc } = service({ config: { signingMethod: "eseal" } });
    const printed = await svc.enqueueReceipt(receipt);

    // The transmit port is the offline stub, so the receipt stays queued — what
    // matters is that it never reached pending_signature on the way there.
    await expect(svc.submit(printed.submission.id)).rejects.toMatchObject({ code: "ETA_OFFLINE" });
    expect((await svc.findById(printed.submission.id))?.status).toBe("ready");
  });

  it("reaches مرسل on an eseal tenant once the gateway answers", async () => {
    const submissions = new MemSubmissions();
    const svc = new EtaService({
      config: new MemConfig({ ...READY, signingMethod: "eseal" }),
      submissions,
      receiptUuid: countingUuidPort(),
      transmit: {
        async transmit() {
          return { ok: true, etaUuid: "authority-uuid" };
        },
      },
      now: () => "2026-09-01T10:00:00.000Z",
      newId: () => `eta-seal-${++ids}`,
    });

    const printed = await svc.enqueueReceipt(receipt);
    expect((await svc.submit(printed.submission.id)).status).toBe("submitted");
  });

  it("still parks a B2B invoice for the same tenant — the seal gate is intact", async () => {
    const { svc } = service({ config: { signingMethod: "eseal" } });
    const queued = await svc.enqueue({
      internalId: "INV-SEAL-1",
      documentType: "invoice",
      issueDateTime: "2026-09-01T10:00:00.000Z",
      receiver: { registrationNumber: "300123456700003", name: "عميل", type: "B" },
      branchCode: null,
      lines: [],
      totalNet: "0",
      totalTax: "0",
      totalAmount: "0",
    });
    expect((await svc.submit(queued.id)).status).toBe("pending_signature");
  });
});

describe("a receipt is refused rather than reported with a blank device serial", () => {
  it("refuses and queues nothing", async () => {
    const { svc, submissions } = service();
    await expect(
      svc.enqueueReceipt({ ...receipt, seller: { deviceSerialNumber: "  ", branchCode: "1" } }),
    ).rejects.toMatchObject({ code: "ETA_DEVICE_SERIAL_NOT_REGISTERED" });
    expect(submissions.rows.size).toBe(0);
  });
});

describe("the per-device receipt chain (D283, DEC-25)", () => {
  const numbered = (n: number, serial = "POS-0001"): EtaReceiptInput => ({
    ...receipt,
    internalId: `RCP-${serial}-${n}`,
    seller: { deviceSerialNumber: serial, branchCode: "1", companyTradeName: "متجر" },
  });
  const header = (p: { submission: { payload: unknown } }) =>
    (p.submission.payload as { header: { uuid: string; previousUUID: string } }).header;

  it("chains each receipt onto the device's previous one, starting from an empty previousUUID", async () => {
    const { svc } = service();
    const first = await svc.enqueueReceipt(numbered(1));
    const second = await svc.enqueueReceipt(numbered(2));
    expect(header(first).previousUUID).toBe("");
    expect(header(second).previousUUID).toBe(first.uuid);
    expect(second.submission.receiptSeq).toBe(2);
    expect(await svc.receiptChainHead("POS-0001")).toMatchObject({ lastUuid: second.uuid, lastSeq: 2 });
  });

  it("keeps the order when sales are issued concurrently — no two receipts claim the same predecessor", async () => {
    const { svc } = service();
    const printed = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => svc.enqueueReceipt(numbered(n))));
    const bySeq = [...printed].sort((a, b) => (a.submission.receiptSeq ?? 0) - (b.submission.receiptSeq ?? 0));
    expect(bySeq.map((p) => p.submission.receiptSeq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(printed.map((p) => header(p).previousUUID)).size).toBe(6);
    bySeq.forEach((p, i) => expect(header(p).previousUUID).toBe(i === 0 ? "" : bySeq[i - 1]!.uuid));
  });

  it("keeps one chain per serial — two tills never link into each other", async () => {
    const { svc } = service();
    const [a1, b1, a2, b2] = await Promise.all([
      svc.enqueueReceipt(numbered(1, "POS-A")),
      svc.enqueueReceipt(numbered(1, "POS-B")),
      svc.enqueueReceipt(numbered(2, "POS-A")),
      svc.enqueueReceipt(numbered(2, "POS-B")),
    ]);
    expect(header(a1!).previousUUID).toBe("");
    expect(header(b1!).previousUUID).toBe("");
    expect(header(a2!).previousUUID).toBe(a1!.uuid);
    expect(header(b2!).previousUUID).toBe(b1!.uuid);
    expect((await svc.receiptChainHead("POS-A"))?.lastSeq).toBe(2);
    expect((await svc.receiptChainHead("POS-B"))?.lastSeq).toBe(2);
  });

  it("ignores a caller-stated previousUuid — the chain row is the only source of the head", async () => {
    const { svc } = service();
    const first = await svc.enqueueReceipt(numbered(1));
    const second = await svc.enqueueReceipt({ ...numbered(2), previousUuid: "forged" } as EtaReceiptInput);
    expect(header(second).previousUUID).toBe(first.uuid);
  });

  it("does not advance the chain on a reprint", async () => {
    const { svc } = service();
    const first = await svc.enqueueReceipt(numbered(1));
    await svc.enqueueReceipt(numbered(1));
    expect(await svc.receiptChainHead("POS-0001")).toMatchObject({ lastUuid: first.uuid, lastSeq: 1 });
  });

  it("rebuilds on the new head when another writer advanced the chain between read and write", async () => {
    const submissions = new MemSubmissions();
    const inner = createInMemoryEtaReceiptChain(submissions);
    let raced = false;
    const chain: EtaReceiptChainRepository = {
      head: (serial) => inner.head(serial),
      list: () => inner.list(),
      async append(entry) {
        if (!raced) {
          raced = true;
          await inner.append({
            serial: entry.serial,
            expectedPreviousUuid: null,
            submission: { ...entry.submission, id: "elsewhere", internalId: "RCP-ELSEWHERE", etaUuid: "uuid-elsewhere" },
          });
        }
        return inner.append(entry);
      },
    };
    const svc = new EtaService({
      config: new MemConfig(READY),
      submissions,
      receiptUuid: countingUuidPort(),
      receiptChain: chain,
      newId: () => `eta-${++ids}`,
    });
    const printed = await svc.enqueueReceipt(numbered(1));
    expect(header(printed).previousUUID).toBe("uuid-elsewhere");
    expect(printed.submission.receiptSeq).toBe(2);
  });
});

describe("submitReadyReceipts — reported device by device, in chain order", () => {
  it("sends each device's receipts oldest link first and stops a device at its first offline refusal", async () => {
    const sent: string[] = [];
    let clock = 0;
    const submissions = new MemSubmissions();
    const svc = new EtaService({
      config: new MemConfig(READY),
      submissions,
      receiptUuid: countingUuidPort(),
      now: () => new Date(Date.UTC(2026, 8, 1, 10, 0, clock++)).toISOString(),
      newId: () => `eta-${++ids}`,
      transmit: {
        async transmit(submission) {
          if (submission.receiptSerial === "POS-OFF") throw new EtaOfflineError();
          sent.push(submission.internalId);
          return { ok: true, etaUuid: submission.etaUuid ?? undefined };
        },
      },
    });
    for (const [n, serial] of [[1, "POS-A"], [1, "POS-OFF"], [2, "POS-A"], [2, "POS-OFF"], [3, "POS-A"]] as const) {
      await svc.enqueueReceipt({ ...receipt, internalId: `${serial}-${n}`, seller: { deviceSerialNumber: serial, branchCode: "1", companyTradeName: "متجر" } });
    }
    const result = await svc.submitReadyReceipts();
    expect(sent).toEqual(["POS-A-1", "POS-A-2", "POS-A-3"]);
    expect(result.queued).toHaveLength(2);
  });

  it("reports a device's ready receipts in ONE /receiptsubmissions call when the port batches (D-B4), mapping acceptedDocuments/rejectedDocuments back onto each submission — a rejection inside the batch does not lose the accepted receipts beside it", async () => {
    const batches: string[][] = [];
    let clock = 0;
    const submissions = new MemSubmissions();
    const svc = new EtaService({
      config: new MemConfig(READY),
      submissions,
      receiptUuid: countingUuidPort(),
      now: () => new Date(Date.UTC(2026, 8, 1, 10, 0, clock++)).toISOString(),
      newId: () => `eta-${++ids}`,
      transmit: {
        async transmit() {
          throw new Error("the batch leg should have been used instead of one-at-a-time submit");
        },
        async transmitReceiptBatch(batch) {
          batches.push(batch.map((s) => s.internalId));
          return {
            submissionUUID: "SUB-BATCH-1",
            outcomes: batch.map((s, i) =>
              i === 1
                ? { submissionId: s.id, ok: false, errors: ["رفضت المصلحة هذا الإيصال"], errorCodes: ["E1"] }
                : { submissionId: s.id, ok: true, etaUuid: s.etaUuid ?? undefined },
            ),
          };
        },
      },
    });
    for (const n of [1, 2, 3]) {
      await svc.enqueueReceipt({ ...receipt, internalId: `RCP-BATCH-${n}` });
    }
    const result = await svc.submitReadyReceipts();
    expect(batches).toEqual([["RCP-BATCH-1", "RCP-BATCH-2", "RCP-BATCH-3"]]);
    expect(result.submitted.map((s) => s.internalId)).toEqual(["RCP-BATCH-1", "RCP-BATCH-3"]);
    expect(result.rejected.map((s) => s.internalId)).toEqual(["RCP-BATCH-2"]);
    expect(result.submitted.every((s) => s.status === "submitted")).toBe(true);
    expect(result.rejected[0]?.errors).toEqual(["رفضت المصلحة هذا الإيصال"]);
  });
});

describe("reissueReceipt — correcting and re-issuing a REJECTED receipt (D-B4)", () => {
  const header = (p: { submission: { payload: unknown } }) =>
    (p.submission.payload as { header: { uuid: string; previousUUID: string; referenceOldUUID?: string } }).header;

  it("refuses to correct a receipt the authority never rejected", async () => {
    const { svc } = service();
    await svc.enqueueReceipt(receipt);
    await expect(svc.reissueReceipt(receipt.internalId, { ...receipt, internalId: "RCP-000001-R2" })).rejects.toThrow(
      EtaReissueNotRejectedError,
    );
  });

  it("refuses a correction that reuses the rejected receipt's own number", async () => {
    const submissions = new MemSubmissions();
    const svc = new EtaService({
      config: new MemConfig(READY),
      submissions,
      receiptUuid: countingUuidPort(),
      now: () => "2026-09-01T10:00:00.000Z",
      newId: () => `eta-${++ids}`,
    });
    const original = await svc.enqueueReceipt(receipt);
    submissions.rows.set(original.submission.id, { ...original.submission, status: "error", errors: ["رفضت المصلحة"] });
    await expect(svc.reissueReceipt(receipt.internalId, { ...receipt, internalId: receipt.internalId })).rejects.toThrow(
      EtaReissueSameInternalIdError,
    );
  });

  it("re-issues within the 96-hour window, referencing the rejected receipt's UUID via header.referenceOldUUID and chaining right after it", async () => {
    let clock = "2026-09-01T10:00:00.000Z";
    const submissions = new MemSubmissions();
    const svc = new EtaService({
      config: new MemConfig(READY),
      submissions,
      receiptUuid: countingUuidPort(),
      now: () => clock,
      newId: () => `eta-${++ids}`,
    });
    const original = await svc.enqueueReceipt(receipt);
    submissions.rows.set(original.submission.id, { ...original.submission, status: "error", errors: ["رفضت المصلحة"] });

    clock = "2026-09-05T09:00:00.000Z"; // 95 hours later — inside the window
    const corrected = await svc.reissueReceipt(receipt.internalId, { ...receipt, internalId: "RCP-000001-R2" });
    expect(header(corrected).referenceOldUUID).toBe(original.uuid);
    // The correction is a NEW receipt on the same device's chain, right after
    // the rejected one — the CAS honours the chain exactly as any other issue.
    expect(header(corrected).previousUUID).toBe(original.uuid);
    expect(corrected.submission.status).toBe("ready");
    expect(await svc.receiptChainHead("POS-0001")).toMatchObject({ lastUuid: corrected.uuid, lastSeq: 2 });
  });

  it("refuses past the 96-hour correction window, bilingually", async () => {
    let clock = "2026-09-01T10:00:00.000Z";
    const submissions = new MemSubmissions();
    const svc = new EtaService({
      config: new MemConfig(READY),
      submissions,
      receiptUuid: countingUuidPort(),
      now: () => clock,
      newId: () => `eta-${++ids}`,
    });
    const original = await svc.enqueueReceipt(receipt);
    submissions.rows.set(original.submission.id, { ...original.submission, status: "error", errors: ["رفضت المصلحة"] });

    clock = "2026-09-05T11:00:00.000Z"; // 97 hours later — past the window
    const attempt = svc.reissueReceipt(receipt.internalId, { ...receipt, internalId: "RCP-000001-R2" });
    await expect(attempt).rejects.toThrow(EtaReissueWindowExpiredError);
    await expect(attempt).rejects.toMatchObject({ code: "ETA_REISSUE_WINDOW_EXPIRED" });
    await expect(attempt).rejects.toMatchObject({ messageEn: expect.stringContaining("96 hours") });
  });
});
