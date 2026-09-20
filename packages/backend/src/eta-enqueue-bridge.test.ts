import { describe, expect, it, vi } from "vitest";
import type { DocumentDomainEvent } from "@mezan/domain";
import { createEtaEnqueueBridge, type EtaEnqueueBridge } from "./eta-receipts.js";

/**
 * The bridge's tasks are fire-and-forget AND deliberately delayed, so they
 * outlive the confirm that started them. `BackendHandle.close()` closes the one
 * shared SQLite connection every store reads through, so a task resuming after
 * it reads a closed handle: measured on a clean `MEZAN_SEED_DEMO=1` boot as 10
 * lines of `[eta] could not queue SALES_INVOICE/… TypeError: The database
 * connection is not open`, and ten consumer e-receipts missing from the tenant
 * the seeder then handed to the router.
 */

const CONFIRMED: DocumentDomainEvent = {
  type: "DOCUMENT_CONFIRMED",
  docType: "SALES_INVOICE",
  docId: "INV-1",
  docNo: "INV-1",
  occurredAt: "2026-09-20T09:00:00.000Z",
};

function bridge(overrides: { readonly taxNumber?: string | null } = {}): {
  readonly bridge: EtaEnqueueBridge;
  readonly issueInvoiceReceipt: ReturnType<typeof vi.fn>;
  readonly findById: ReturnType<typeof vi.fn>;
} {
  const issueInvoiceReceipt = vi.fn(async () => ({ receiptNo: "R-1", uuid: "u", qrValue: "q" }));
  const findById = vi.fn(async () => ({ id: "INV-1", customerId: "CUST-1", status: "confirmed" }));
  const deps = {
    eta: { getConfig: async () => ({ autoSubmitOnConfirm: true }) },
    issuer: { issueInvoiceReceipt, scheduleSubmission: vi.fn() },
    invoices: { findById },
    customers: { findById: async () => ({ id: "CUST-1", taxNumber: overrides.taxNumber ?? null }) },
    items: { findById: async () => null },
    taxRates: { list: async () => [] },
    branchCodes: { list: async () => [] },
    unitMappings: { list: async () => [] },
  } as unknown as Parameters<typeof createEtaEnqueueBridge>[0];
  return { bridge: createEtaEnqueueBridge(deps), issueInvoiceReceipt, findById };
}

describe("createEtaEnqueueBridge lifecycle", () => {
  it("drain() resolves only once the task it started has issued the receipt", async () => {
    const { bridge: b, issueInvoiceReceipt } = bridge();
    b.publish(CONFIRMED);
    // The task parks on purpose to let the confirm route win the race, so
    // nothing has happened yet at this point.
    expect(issueInvoiceReceipt).not.toHaveBeenCalled();
    await b.drain();
    expect(issueInvoiceReceipt).toHaveBeenCalledWith("INV-1");
  });

  it("a task parked when stop() lands never touches the store again", async () => {
    const { bridge: b, issueInvoiceReceipt } = bridge();
    b.publish(CONFIRMED);
    b.stop();
    await b.drain();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(issueInvoiceReceipt).not.toHaveBeenCalled();
  });

  it("starts no task at all after stop()", async () => {
    const { bridge: b, findById } = bridge();
    b.stop();
    b.publish(CONFIRMED);
    await b.drain();
    expect(findById).not.toHaveBeenCalled();
  });

  it("drain() is idle when nothing was published", async () => {
    await expect(bridge().bridge.drain()).resolves.toBeUndefined();
  });

  it("ignores an event that is not a confirmed sales invoice", async () => {
    const { bridge: b, findById } = bridge();
    b.publish({ ...CONFIRMED, type: "DOCUMENT_DRAFTED" });
    b.publish({ ...CONFIRMED, docType: "PURCHASE_INVOICE" });
    await b.drain();
    expect(findById).not.toHaveBeenCalled();
  });
});
