import { describe, it, expect } from "vitest";
import { DEFAULT_ETA_CONFIG, type EtaConfig, type EtaConfigRepository } from "./config.js";
import type { EtaSubmission, EtaSubmissionRepository, EtaSubmissionStatus } from "./submission.js";
import { EtaService } from "./service.js";
import { EtaReceiptUuidUnavailableError, type EtaReceiptInput, type EtaReceiptUuidPort } from "./receipt.js";

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
type CountingPort = EtaReceiptUuidPort & { calls: number };

function service(overrides: { config?: Partial<EtaConfig>; uuid?: CountingPort; now?: string } = {}) {
  const submissions = new MemSubmissions();
  const uuid = overrides.uuid ?? countingUuidPort();
  const svc = new EtaService({
    config: new MemConfig({ ...DEFAULT_ETA_CONFIG, ...overrides.config }),
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
  seller: { deviceSerialNumber: "POS-0001", branchCode: "1" },
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

  it("builds the QR from the assigned UUID and the sale moment", async () => {
    const { svc } = service({ config: { environment: "production" } });
    const printed = await svc.enqueueReceipt(receipt);
    expect(printed.qrValue).toBe(
      "https://invoicing.eta.gov.eg/receipts/search/uuid-1/share/2026-09-01T10%3A00%3A00.000Z",
    );
  });

  it("refuses when no UUID port is wired rather than printing a QR that resolves to nothing", async () => {
    const submissions = new MemSubmissions();
    const svc = new EtaService({ config: new MemConfig(DEFAULT_ETA_CONFIG), submissions });
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
    expect(summary.overdue).toBe(1);
    expect(summary.overdueEntries[0]?.internalId).toBe("RCP-000001");
    expect(summary.windowHours).toBe(72);
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
