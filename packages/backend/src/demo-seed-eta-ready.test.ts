import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bootBackendKit, rowsOf, type BackendKit } from "./test-helpers/backend-kit.js";

const TODAY = "2026-08-24";
const BUSINESS_CUSTOMER = "CUST-DEMO-1";
const BLOCKING = "blocking";

interface SeededItem {
  readonly itemId: string;
  readonly code: string;
  readonly etaItemCode: string | null;
}

const MAPPING_LIST_CAP = 200;
const ISSUED_ONLY_ON_A_RETENTION_RELEASE = "SRV-CONTRACTING-RETENTION";

interface SeededCustomer {
  readonly id: string;
  readonly code: string;
  readonly etaBuyerType: string;
}

interface Submission {
  readonly internalId: string;
  readonly documentType: string;
  readonly prevalidation?: { severity: string; code: string }[];
}

let kit: BackendKit;
let etaLogLines: string[];
let seededSubmissions: Submission[];

async function sale(id: string, customerId: string, itemId: string, isStock: boolean) {
  const created = await kit.call("POST", "/sales-invoices", {
    id, date: TODAY, dueDate: "2026-09-23", customerId, customerNameAr: "عميل", warehouseId: "WH-MAIN", branchId: "BR-MAIN", arAccountId: "1105", taxAccountId: "2200",
    lines: [{ lineId: "A", itemId, itemNameAr: "صنف", isStock, qty: "1", unitPrice: "100", revenueAccountId: "4100", cogsAccountId: "5100", inventoryAccountId: "1200", taxRateId: "VAT14" }],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const confirmed = await kit.call("POST", `/sales-invoices/${id}/confirm`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  return confirmed.body;
}

const submissions = async (): Promise<Submission[]> => rowsOf((await kit.call("GET", "/eta/submissions?pageSize=10000")).body) as Submission[];

const submissionOf = async (internalId: string) => (await submissions()).find((row) => row.internalId === internalId);

const blockersOf = (submission: Submission | undefined) =>
  (submission?.prevalidation ?? []).filter((finding) => finding.severity === BLOCKING).map((finding) => finding.code);

const everySeeded = async <Row,>(path: string): Promise<Row[]> => rowsOf((await kit.call("GET", `${path}?pageSize=10000`)).body) as Row[];

async function everySeededItem(): Promise<SeededItem[]> {
  const items = (await kit.call("GET", "/eta/item-mappings")).body.rows as SeededItem[];
  expect(items.length).toBeGreaterThan(20);
  expect(items.length).toBeLessThan(MAPPING_LIST_CAP);
  return items;
}

beforeAll(async () => {
  etaLogLines = [];
  const record = (...parts: unknown[]) => {
    const line = parts.map(String).join(" ");
    if (line.includes("[eta]")) etaLogLines.push(line);
  };
  const spies = [vi.spyOn(console, "error").mockImplementation(record), vi.spyOn(console, "warn").mockImplementation(record), vi.spyOn(console, "log").mockImplementation(record)];
  kit = await bootBackendKit();
  await kit.backend.drain();
  for (const spy of spies) spy.mockRestore();
  seededSubmissions = await submissions();
}, 120_000);

afterAll(async () => {
  await kit.close();
});

describe("the demo tenant as it is seeded", () => {
  it("boots without one e-document refusal in the log", () => {
    expect(etaLogLines).toEqual([]);
  });

  it("holds no seeded e-document back on a blocking finding", () => {
    expect(seededSubmissions.length).toBeGreaterThan(100);
    const held = seededSubmissions.filter((submission) => blockersOf(submission).length > 0).map((submission) => [submission.internalId, submission.documentType, blockersOf(submission)]);
    expect(held).toEqual([]);
  });

  it("gives every seeded item an authority code", async () => {
    expect((await everySeededItem()).filter((item) => !item.etaItemCode).map((item) => item.code)).toEqual([]);
  });
});

describe("the demo tenant can file what it sells", () => {
  it("queues an e-invoice with nothing blocking it for a sale of every seeded item to a business customer", async () => {
    const held: Record<string, string[]> = {};
    const sellable = (await everySeededItem()).filter((item) => item.itemId !== ISSUED_ONLY_ON_A_RETENTION_RELEASE);
    for (const [index, item] of sellable.entries()) {
      const posted = await sale(`SEED-ETA-INV-${index}`, BUSINESS_CUSTOMER, item.itemId, false);
      const submission = await submissionOf(posted.docNo);
      expect(submission, `e-invoice of ${posted.docNo} for ${item.code}`).toBeDefined();
      const blockers = blockersOf(submission);
      if (blockers.length > 0) held[item.code] = blockers;
    }
    expect(held).toEqual({});
  });

  it("files a sale to every seeded customer: a clean e-invoice for a business, an issued e-receipt for an individual", async () => {
    const unfiled: Record<string, string> = {};
    for (const [index, customer] of (await everySeeded<SeededCustomer>("/customers")).entries()) {
      const posted = await sale(`SEED-ETA-CUST-${index}`, customer.id, "ITEM-DEMO-6", false);
      if (customer.etaBuyerType === "individual") {
        if (posted.etaReceiptError || !posted.etaReceipt?.uuid) unfiled[customer.code] = String(posted.etaReceiptError ?? "no receipt");
        continue;
      }
      const blockers = blockersOf(await submissionOf(posted.docNo));
      if (blockers.length > 0) unfiled[customer.code] = blockers.join(",");
    }
    expect(unfiled).toEqual({});
  });

  it("queues the credit note of a return on such a sale with nothing blocking it", async () => {
    const posted = await sale("SEED-ETA-INV-RET", BUSINESS_CUSTOMER, "ITEM-DEMO-5", false);
    expect(posted.status).toBe("confirmed");
    const drafted = await kit.call("POST", "/sales-returns/from-invoice", { id: "SEED-ETA-RET", date: TODAY, memo: "", warehouseId: "WH-MAIN", sourceInvoiceId: "SEED-ETA-INV-RET", reason: "DEFECTIVE", requested: [{ itemId: "ITEM-DEMO-5", sourceLineId: "A", qty: "1" }] });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const returned = await kit.call("POST", "/sales-returns/SEED-ETA-RET/confirm", {});
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    const creditNote = await submissionOf(returned.body.document.docNo);
    expect(creditNote?.documentType).toBe("credit_note");
    expect(blockersOf(creditNote)).toEqual([]);
  });

  it("issues a consumer e-receipt at the confirm of a sale to an individual", async () => {
    const posted = await sale("SEED-ETA-RCPT", "CUST-DEMO-3", "ITEM-DEMO-6", false);
    expect(posted.etaReceiptError ?? null).toBeNull();
    expect(posted.etaReceipt?.uuid).toEqual(expect.any(String));
  });
});
