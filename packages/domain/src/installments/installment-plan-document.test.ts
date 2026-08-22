import { describe, it, expect } from "vitest";
import { Money } from "../money/index.js";
import { DocumentService } from "../documents/service.js";
import { InMemoryDocumentRepository } from "../documents/test-helpers/in-memory-document-repository.js";
import { InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { NextNumberService } from "../numbering/index.js";
import { generateInstallmentSchedule } from "./schedule.js";
import { installmentPlanDocumentType, type InstallmentLine } from "./installment-plan-document.js";
import { InvalidDocumentError } from "../documents/errors.js";

function buildLines(): InstallmentLine[] {
  const schedule = generateInstallmentSchedule({
    invoiceTotal: Money.fromMajor("375"),
    downPayment: Money.zero(),
    installmentCount: 6,
    frequency: "MONTHLY",
    startDate: "2026-08-21",
  });
  return schedule.installments.map((i) => ({
    no: i.no,
    customerId: "CUST1",
    sourceInvoiceId: "INV1",
    sourceInvoiceNumber: "INV-000014",
    frequency: "MONTHLY",
    downPayment: schedule.downPayment,
    dueDate: i.dueDate,
    amount: i.amount,
    paidAmount: Money.zero(),
    status: "pending",
    lateFeeAmount: Money.zero(),
  }));
}

function harness() {
  const repo = new InMemoryDocumentRepository<InstallmentLine>();
  const sequence = new InMemorySequenceStore();
  const numbering = new NextNumberService(sequence);
  const service = new DocumentService(installmentPlanDocumentType, {
    repo,
    numbering: { next: () => numbering.next("INSTALLMENT_PLAN") },
    now: () => "2026-08-21T00:00:00.000Z",
  });
  return { service, repo };
}

describe("Installment Plan — document lifecycle (no GL/stock hooks needed)", () => {
  it("creates and confirms a plan straight through (no workflow gate configured for this type)", async () => {
    const { service } = harness();
    await service.createDraft({ id: "IP1", date: "2026-08-21", memo: "", lines: buildLines() });
    const { document, held } = await service.confirm("IP1");
    expect(held).toBe(false);
    expect(document.status).toBe("confirmed");
    expect(document.docNo).toBe("IP-000001");
    expect(document.journalEntryId).toBeNull(); // no buildGlPosting — installments post nothing on creation
  });

  it("rejects an empty schedule", async () => {
    const { service } = harness();
    await expect(service.createDraft({ id: "IP2", date: "2026-08-21", memo: "", lines: [] })).rejects.toBeInstanceOf(
      InvalidDocumentError,
    );
  });

  it("rejects non-ascending due dates", async () => {
    const { service } = harness();
    const lines = buildLines();
    const scrambled = [lines[1] as InstallmentLine, lines[0] as InstallmentLine, ...lines.slice(2)];
    await expect(
      service.createDraft({ id: "IP3", date: "2026-08-21", memo: "", lines: scrambled }),
    ).rejects.toBeInstanceOf(InvalidDocumentError);
  });
});
