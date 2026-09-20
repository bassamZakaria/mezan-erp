import {
  buildEtaPayload,
  buildPosReceiptInput,
  buildRefundReceiptInput,
  convertToBase,
  DuplicateEtaSubmissionError,
  EtaDeviceSerialNotRegisteredError,
  EtaDeviceSerialUnknownError,
  EtaOfflineError,
  EtaOriginalReceiptNotFoundError,
  etaReceiptIssuedAt,
  extend as extendQtyByPrice,
  findLineTaxRate,
  Money,
  prevalidateEtaInvoice,
  resolveEtaVatSubType,
  SALES_INVOICE_ACTIVE_STATUSES,
  salesInvoiceTotals,
  type CustomerRepository,
  type DocumentEventPublisher,
  type DocumentRepository,
  type EtaBranchCodeRepository,
  type EtaEnqueueInput,
  type EtaPrevalidationFinding,
  type EtaPrevalidationLineInput,
  type EtaReceiptBuyerInput,
  type EtaReceiptDevice,
  type EtaReceiptItemCodes,
  type EtaReceiptLookups,
  type EtaReceiptPaymentMethod,
  type EtaService,
  type EtaUnitMappingRepository,
  type ItemRepository,
  type SalesInvoice,
  type SalesInvoiceLine,
  type SalesInvoiceRepository,
  type SalesReturnLine,
  type TaxRateRepository,
  type VoucherPaymentMethod,
} from "@mezan/domain";

/** What a till prints: the number, the identifier the QR encodes, and the QR itself. */
export interface IssuedEtaReceipt {
  readonly receiptNo: string;
  readonly uuid: string;
  readonly qrValue: string;
}

export interface IssueEtaReceiptOptions {
  /**
   * The POS device that issues it. Omitted, the device registered for the
   * document's branch. A serial nobody registered is refused, never filed.
   */
  readonly serial?: string;
  /** The tender actually taken. Omitted, the tender recorded against the invoice, else «أخرى». */
  readonly paymentMethod?: EtaReceiptPaymentMethod;
}

export interface EtaReceiptIssuerDeps {
  readonly eta: EtaService;
  readonly invoices: Pick<SalesInvoiceRepository, "findById">;
  readonly returns: Pick<DocumentRepository<SalesReturnLine>, "findById">;
  readonly customers: Pick<CustomerRepository, "findById">;
  readonly items: Pick<ItemRepository, "findById">;
  readonly taxRates: Pick<TaxRateRepository, "list">;
  readonly branchCodes: EtaBranchCodeRepository;
  readonly unitMappings: EtaUnitMappingRepository;
  /** The payment method of the collection that settled most of this invoice, if any. */
  readonly tenderOf: (invoiceId: string) => Promise<VoucherPaymentMethod | null>;
  readonly companyTradeName: () => Promise<string>;
  /**
   * The device a serial names. The POS terminals (DEC-25) plug in here; the
   * default looks the serial up on the branch registrations.
   */
  readonly resolveDevice?: (serial: string) => Promise<EtaReceiptDevice | null>;
  readonly now?: () => string;
  /** How long an offline device waits before the next reporting run. Default five minutes. */
  readonly retryMs?: number;
}

export interface EtaReceiptIssuer {
  /** إصدار إيصال لفاتورة بيع مستهلك. Null for a B2B sale (that is an e-invoice) or a document that is not live. */
  issueInvoiceReceipt(invoiceId: string, options?: IssueEtaReceiptOptions): Promise<IssuedEtaReceipt | null>;
  /** إيصال مرتجع for a confirmed consumer return. Null for a B2B return (that is a credit note). */
  issueReturnReceipt(returnId: string, options?: IssueEtaReceiptOptions): Promise<IssuedEtaReceipt | null>;
  /**
   * تصحيح إيصال بيع مرفوض وإعادة إصداره (D-B4) — rebuilds the invoice's e-receipt
   * with a new receipt number and reports it referencing the rejected one's
   * UUID (header.referenceOldUUID), inside the authority's 96-hour correction
   * window. Null when the invoice has no e-receipt the authority actually
   * rejected — nothing to correct.
   */
  reissueInvoiceReceipt(invoiceId: string, options?: IssueEtaReceiptOptions): Promise<IssuedEtaReceipt | null>;
  /** The refund-receipt mirror of {@link reissueInvoiceReceipt}, for a confirmed consumer return's rejected receipt. */
  reissueReturnReceipt(returnId: string, options?: IssueEtaReceiptOptions): Promise<IssuedEtaReceipt | null>;
  /**
   * Reports queued receipts when الإرسال التلقائي is on; one run at a time.
   * While a device is offline the run repeats every `retryMs`, so the queue
   * drains on its own once the connection returns.
   */
  scheduleSubmission(): void;
  /**
   * Resolves once the submission run in flight has settled — what a caller
   * awaits before closing the backend, so the run is not cut off mid-read.
   */
  settle(): Promise<void>;
  /** Whether a submission run is in flight right now. */
  pending(): boolean;
  /** Whether an e-receipt exists for this invoice — a receipted sale cannot be voided, only returned. */
  hasInvoiceReceipt(invoiceId: string): Promise<boolean>;
  /** Cancels a pending retry; the backend's close() calls it. */
  stop(): void;
}

const TENDER_TO_RECEIPT: Record<VoucherPaymentMethod, EtaReceiptPaymentMethod> = {
  cash: "cash",
  card: "card",
  wallet: "wallet",
  bank: "transfer",
  cheque: "other",
};

const ROUTE_FIRST_MS = 50;

/** A national ID is 14 digits (SDK Main Calculations); anything else is left off rather than rejected. */
const NATIONAL_ID = /^\d{14}$/;

export function createEtaReceiptIssuer(deps: EtaReceiptIssuerDeps): EtaReceiptIssuer {
  const now = deps.now ?? (() => new Date().toISOString());

  async function lookups(itemIds: readonly string[]): Promise<EtaReceiptLookups> {
    const [taxRates, unitMappings, items] = await Promise.all([
      deps.taxRates.list(),
      deps.unitMappings.list(),
      Promise.all([...new Set(itemIds)].map(async (id) => [id, await deps.items.findById(id)] as const)),
    ]);
    const byId = new Map<string, EtaReceiptItemCodes>();
    for (const [id, item] of items) {
      if (item) {
        byId.set(id, {
          code: item.code,
          etaItemCode: item.etaItemCode,
          etaCodeType: item.etaCodeType,
          baseUnitCode: item.baseUnitCode,
        });
      }
    }
    return { items: byId, taxRates, unitByCode: new Map(unitMappings.map((m) => [m.unitCode, m.etaUnitCode])) };
  }

  async function device(branchId: string, serial: string | undefined): Promise<EtaReceiptDevice> {
    const mappings = await deps.branchCodes.list();
    const companyTradeName = await deps.companyTradeName();
    if (serial !== undefined && serial.trim() !== "") {
      const wanted = serial.trim();
      const resolved = deps.resolveDevice ? await deps.resolveDevice(wanted) : null;
      if (resolved) return { ...resolved, companyTradeName: resolved.companyTradeName ?? companyTradeName };
      const mapping = mappings.find((m) => m.deviceSerialNumber?.trim() === wanted);
      if (!mapping) throw new EtaDeviceSerialUnknownError(wanted);
      return { serial: wanted, branchCode: mapping.etaBranchCode, companyTradeName };
    }
    const mapping = mappings.find((m) => m.branchId === branchId);
    const registered = mapping?.deviceSerialNumber?.trim() ?? "";
    if (registered === "") throw new EtaDeviceSerialNotRegisteredError(branchId);
    return { serial: registered, branchCode: mapping?.etaBranchCode ?? null, companyTradeName };
  }

  async function buyerOf(customerId: string): Promise<{ readonly b2b: boolean; readonly buyer: EtaReceiptBuyerInput }> {
    const customer = await deps.customers.findById(customerId);
    if (customer?.taxNumber) return { b2b: true, buyer: { type: "B", id: customer.taxNumber, name: customer.nameAr } };
    const nationalId = customer?.nationalId?.trim() ?? "";
    return NATIONAL_ID.test(nationalId)
      ? { b2b: false, buyer: { type: "P", id: nationalId, name: customer?.nameAr ?? null } }
      : { b2b: false, buyer: { type: "P", id: null, name: null } };
  }

  async function tender(invoiceId: string, given: EtaReceiptPaymentMethod | undefined): Promise<EtaReceiptPaymentMethod> {
    if (given) return given;
    const method = await deps.tenderOf(invoiceId);
    return method ? TENDER_TO_RECEIPT[method] : "other";
  }

  /**
   * A consumer document that fails to receipt is recorded as a gap before the
   * error goes back to the caller, so the reporting-window counters show it —
   * the confirm that produced it has already posted and will not be undone.
   */
  async function withGap<T>(
    gap: { readonly internalId: string; readonly docType: "invoice" | "return"; readonly docId: string; readonly issuedAt: string },
    issue: () => Promise<T>,
  ): Promise<T> {
    try {
      return await issue();
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      await deps.eta.recordReceiptGap({
        ...gap,
        code: typeof code === "string" ? code : "ETA_RECEIPT_FAILED",
        reason: err instanceof Error ? err.message : String(err),
        recordedAt: now(),
      });
      throw err;
    }
  }

  /**
   * D-B4 — a corrected receipt is a NEW document on the device's chain, so it
   * needs its own رقم إيصال. `-R2`, `-R3`, … so the paper still reads as a
   * correction of the same sale rather than an unrelated new receipt.
   */
  async function nextReissueNumber(base: string): Promise<string> {
    for (let n = 2; ; n++) {
      const candidate = `${base}-R${n}`;
      if (!(await deps.eta.findByInternalId(candidate))) return candidate;
    }
  }

  let draining = false;
  let again = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let running: Promise<void> | null = null;
  const retryMs = deps.retryMs ?? 5 * 60_000;

  async function drain(): Promise<void> {
    if (draining) {
      again = true;
      return;
    }
    draining = true;
    let queued = 0;
    try {
      do {
        again = false;
        const config = await deps.eta.getConfig();
        // INVARIANT: re-checked after every await. `submitReadyReceipts` reads
        // the store, and this run outlives whatever scheduled it, so resuming
        // past `stop()` reads a closed connection.
        if (stopped || !config.autoSubmitOnConfirm) return;
        queued = (await deps.eta.submitReadyReceipts()).queued.length;
      } while (again);
    } finally {
      draining = false;
    }
    if (queued > 0 && retry === null && !stopped) {
      retry = setTimeout(() => {
        retry = null;
        schedule();
      }, retryMs);
      retry.unref?.();
    }
  }

  /**
   * INVARIANT: nothing may touch the store after `stop()`. `stop()` runs inside
   * `BackendHandle.close()`, immediately before the shared SQLite connection is
   * closed, so a retry armed after it would resume against a closed handle.
   */
  function schedule(): void {
    if (stopped) return;
    const run = drain().catch((error: unknown) => {
      if (error instanceof EtaOfflineError) return;
      console.error("[eta] receipt submission run failed", error);
    });
    running = run;
    void run.finally(() => {
      if (running === run) running = null;
    });
  }

  return {
    async issueInvoiceReceipt(invoiceId, options = {}) {
      const invoice = await deps.invoices.findById(invoiceId);
      if (!invoice || !SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) return null;
      const { b2b, buyer } = await buyerOf(invoice.customerId);
      if (b2b) return null;
      const receiptNo = invoice.docNo ?? invoice.id;
      const reprint = await deps.eta.receiptForPrint(receiptNo);
      if (reprint) return { receiptNo: reprint.receiptNo, uuid: reprint.uuid, qrValue: reprint.qrValue };
      const issuedAt = invoice.confirmedAt ?? now();
      return withGap({ internalId: receiptNo, docType: "invoice", docId: invoice.id, issuedAt }, async () => {
        const printed = await deps.eta.enqueueReceipt(
          buildPosReceiptInput({
            invoice,
            issuedAt,
            device: await device(invoice.branchId, options.serial),
            paymentMethod: await tender(invoice.id, options.paymentMethod),
            buyer,
            lookups: await lookups(invoice.lines.map((l) => l.itemId)),
          }),
        );
        return { receiptNo: printed.receiptNo, uuid: printed.uuid, qrValue: printed.qrValue };
      });
    },

    async issueReturnReceipt(returnId, options = {}) {
      const doc = await deps.returns.findById(returnId);
      const first = doc?.lines[0];
      if (!doc || !first || doc.status !== "confirmed") return null;
      const invoice = await deps.invoices.findById(first.sourceInvoiceId);
      if (!invoice) return null;
      const { b2b, buyer } = await buyerOf(first.customerId);
      if (b2b) return null;
      const receiptNo = doc.docNo ?? doc.id;
      const reprint = await deps.eta.receiptForPrint(receiptNo);
      if (reprint) return { receiptNo: reprint.receiptNo, uuid: reprint.uuid, qrValue: reprint.qrValue };
      const issuedAt = doc.confirmedAt ?? now();
      return withGap({ internalId: receiptNo, docType: "return", docId: doc.id, issuedAt }, async () => {
        const original = await deps.eta.findByInternalId(invoice.docNo ?? invoice.id);
        if (!original || original.documentType !== "receipt" || !original.etaUuid) {
          throw new EtaOriginalReceiptNotFoundError(invoice.docNo ?? invoice.id);
        }
        const printed = await deps.eta.enqueueReceipt(
          buildRefundReceiptInput({
            invoice,
            returnLines: doc.lines,
            receiptNumber: receiptNo,
            issuedAt,
            device: await device(invoice.branchId, options.serial),
            referenceUuid: original.etaUuid,
            referenceIssuedAt: etaReceiptIssuedAt(original),
            paymentMethod: options.paymentMethod ?? receiptPaymentMethodOf(original.payload),
            buyer,
            lookups: await lookups(doc.lines.map((l) => l.itemId)),
          }),
        );
        return { receiptNo: printed.receiptNo, uuid: printed.uuid, qrValue: printed.qrValue };
      });
    },

    async reissueInvoiceReceipt(invoiceId, options = {}) {
      const invoice = await deps.invoices.findById(invoiceId);
      if (!invoice || !SALES_INVOICE_ACTIVE_STATUSES.has(invoice.status)) return null;
      const { b2b, buyer } = await buyerOf(invoice.customerId);
      if (b2b) return null;
      const receiptNo = invoice.docNo ?? invoice.id;
      const rejected = await deps.eta.findByInternalId(receiptNo);
      // Nothing to correct unless the authority actually rejected this sale's
      // receipt — `EtaService.reissueReceipt` refuses anything else anyway,
      // but resolving it here lets the route answer 404-shaped null cleanly.
      if (!rejected || rejected.documentType !== "receipt" || rejected.status !== "error") return null;
      const issuedAt = now();
      const corrected = buildPosReceiptInput({
        invoice,
        receiptNumber: await nextReissueNumber(receiptNo),
        issuedAt,
        device: await device(invoice.branchId, options.serial),
        paymentMethod: await tender(invoice.id, options.paymentMethod),
        buyer,
        lookups: await lookups(invoice.lines.map((l) => l.itemId)),
      });
      const printed = await deps.eta.reissueReceipt(receiptNo, corrected);
      return { receiptNo: printed.receiptNo, uuid: printed.uuid, qrValue: printed.qrValue };
    },

    async reissueReturnReceipt(returnId, options = {}) {
      const doc = await deps.returns.findById(returnId);
      const first = doc?.lines[0];
      if (!doc || !first || doc.status !== "confirmed") return null;
      const invoice = await deps.invoices.findById(first.sourceInvoiceId);
      if (!invoice) return null;
      const { b2b, buyer } = await buyerOf(first.customerId);
      if (b2b) return null;
      const receiptNo = doc.docNo ?? doc.id;
      const rejected = await deps.eta.findByInternalId(receiptNo);
      if (!rejected || rejected.documentType !== "receipt" || rejected.status !== "error") return null;
      const original = await deps.eta.findByInternalId(invoice.docNo ?? invoice.id);
      if (!original || original.documentType !== "receipt" || !original.etaUuid) {
        throw new EtaOriginalReceiptNotFoundError(invoice.docNo ?? invoice.id);
      }
      const issuedAt = now();
      const corrected = buildRefundReceiptInput({
        invoice,
        returnLines: doc.lines,
        receiptNumber: await nextReissueNumber(receiptNo),
        issuedAt,
        device: await device(invoice.branchId, options.serial),
        referenceUuid: original.etaUuid,
        referenceIssuedAt: etaReceiptIssuedAt(original),
        paymentMethod: options.paymentMethod ?? receiptPaymentMethodOf(original.payload),
        buyer,
        lookups: await lookups(doc.lines.map((l) => l.itemId)),
      });
      const printed = await deps.eta.reissueReceipt(receiptNo, corrected);
      return { receiptNo: printed.receiptNo, uuid: printed.uuid, qrValue: printed.qrValue };
    },

    async hasInvoiceReceipt(invoiceId) {
      const invoice = await deps.invoices.findById(invoiceId);
      if (!invoice) return false;
      return (await deps.eta.receiptForPrint(invoice.docNo ?? invoice.id)) !== null;
    },

    scheduleSubmission: schedule,

    async settle() {
      while (running !== null) await running;
    },

    pending: () => running !== null,

    stop() {
      stopped = true;
      if (retry !== null) clearTimeout(retry);
      retry = null;
    },
  };
}

const CODE_TO_METHOD: Record<string, EtaReceiptPaymentMethod> = {
  C: "cash",
  V: "card",
  VO: "voucher",
  GC: "gift_card",
  P: "points",
};

/** A refund is paid back the way the sale was paid, unless the till says otherwise. */
function receiptPaymentMethodOf(payload: unknown): EtaReceiptPaymentMethod {
  const code = (payload as { paymentMethod?: unknown } | null)?.paymentMethod;
  return typeof code === "string" ? (CODE_TO_METHOD[code] ?? "other") : "other";
}

/**
 * The producer the ETA queue never had (D5): a confirmed sales invoice reaches
 * the queue from its own confirm event.
 *
 * WHICH DOCUMENT gets built is decided by the customer, not by a setting: a
 * customer with a tax registration number is a B2B sale and becomes an
 * e-invoice, queued when الإرسال التلقائي عند التأكيد is on; one without is a
 * consumer sale and gets an e-RECEIPT — ALWAYS, because the till prints its
 * UUID and QR whether or not anything is transmitted yet (D283). Only the
 * reporting of the receipt follows the setting.
 *
 * Fire-and-forget: a queueing failure must never fail the confirm that emitted
 * it. The confirm route issues the receipt synchronously as well, and issuing
 * is idempotent, so whichever runs second returns the first one's receipt.
 *
 * Fire-and-forget still has a lifecycle. Each task outlives the confirm that
 * started it — it parks 50 ms on purpose — so the bridge tracks what is still
 * running (`drain`) and refuses to touch the store once the backend has begun
 * closing (`stop`). Without those, the demo seed's own confirms resumed after
 * `backend.close()` and every consumer receipt was lost to a swallowed
 * "database connection is not open": 10 of them on a clean boot.
 */
export interface EtaEnqueueBridge extends DocumentEventPublisher {
  /** Resolves once every task this bridge has started has settled. */
  drain(): Promise<void>;
  /** No further task starts, and no running task touches the store again. */
  stop(): void;
}

export function createEtaEnqueueBridge(deps: {
  readonly eta: EtaService;
  readonly issuer: EtaReceiptIssuer;
  readonly invoices: Pick<SalesInvoiceRepository, "findById">;
  readonly customers: Pick<CustomerRepository, "findById">;
  readonly items: Pick<ItemRepository, "findById">;
  readonly taxRates: Pick<TaxRateRepository, "list">;
  readonly branchCodes: EtaBranchCodeRepository;
  readonly unitMappings: EtaUnitMappingRepository;
}): EtaEnqueueBridge {
  const inFlight = new Set<Promise<void>>();
  let stopped = false;
  return {
    publish(event) {
      if (event.type !== "DOCUMENT_CONFIRMED" || event.docType !== "SALES_INVOICE") return;
      if (stopped) return;
      const task = (async () => {
        const invoice = await deps.invoices.findById(event.docId);
        if (!invoice) return;
        const customer = await deps.customers.findById(invoice.customerId);
        if (!customer?.taxNumber) {
          // The confirm route issues this receipt itself, with the tender the
          // till reports; waiting a beat lets it win, and this call then only
          // covers confirms from other paths (approvals, conversions).
          await new Promise((resolve) => setTimeout(resolve, ROUTE_FIRST_MS));
          // INVARIANT: every resumption after an await re-checks `stopped`.
          // This task outlives the confirm that started it, and `stop()` runs
          // immediately before the shared SQLite connection closes — resuming
          // past it touched a closed handle and lost the receipt behind a
          // swallowed "database connection is not open".
          if (stopped) return;
          if (await deps.issuer.issueInvoiceReceipt(invoice.id)) deps.issuer.scheduleSubmission();
          return;
        }
        const config = await deps.eta.getConfig();
        if (!config.autoSubmitOnConfirm || stopped) return;
        await enqueueInvoice(deps, invoice, customer.taxNumber, event.occurredAt);
      })().catch((error: unknown) => {
        if (error instanceof DuplicateEtaSubmissionError) return;
        console.error(`[eta] could not queue ${event.docType}/${event.docId}`, error);
      });
      inFlight.add(task);
      void task.finally(() => inFlight.delete(task));
    },

    async drain() {
      while (inFlight.size > 0) await Promise.all([...inFlight]);
    },

    stop() {
      stopped = true;
    },
  };
}

export interface EtaInvoicePrevalidationDeps {
  readonly eta: EtaService;
  readonly items: Pick<ItemRepository, "findById">;
  readonly taxRates: Pick<TaxRateRepository, "list">;
  readonly branchCodes: EtaBranchCodeRepository;
  readonly unitMappings: EtaUnitMappingRepository;
}

/**
 * Builds BOTH the ETA payload input and the ENH-011b pre-validation input
 * from the same source-document read, so the two can never disagree about
 * which item/unit/tax-rate a line resolved against. Shared by the
 * confirm-time enqueue (`enqueueInvoice`) and the fix-and-requeue rebuild
 * (`rebuildEtaInvoiceSubmission`) — a requeue reads the SAME masters again,
 * which is the entire point: it picks up whatever the accountant just fixed.
 */
async function buildInvoiceEtaInputs(
  deps: EtaInvoicePrevalidationDeps,
  invoice: SalesInvoice,
  taxNumber: string,
  occurredAt: string,
): Promise<{ readonly enqueueInput: EtaEnqueueInput; readonly prevalidation: readonly EtaPrevalidationFinding[] }> {
  const totals = salesInvoiceTotals(invoice);
  const lineTotals = new Map(totals.lines.map((l) => [l.lineId, l]));
  const [taxRates, branchCodes, unitMappings, config] = await Promise.all([
    deps.taxRates.list(),
    deps.branchCodes.list(),
    deps.unitMappings.list(),
    deps.eta.getConfig(),
  ]);
  const unitByCode = new Map(unitMappings.map((m) => [m.unitCode, m.etaUnitCode]));
  const lineItems = await Promise.all(invoice.lines.map((line: SalesInvoiceLine) => deps.items.findById(line.itemId)));
  const branchMapping = branchCodes.find((b) => b.branchId === invoice.branchId) ?? null;

  const prevalidationLines: EtaPrevalidationLineInput[] = [];
  const payloadLines = invoice.lines.map((line: SalesInvoiceLine, index: number) => {
    const lt = lineTotals.get(line.lineId);
    const item = lineItems[index] ?? null;
    // The unit the LINE was priced in, not the item's base unit: the
    // quantity and unit price below are both per entered unit, so
    // filing the base unit code would misstate the quantity sold.
    const unitCode = line.unitCode !== "" ? line.unitCode : (item?.baseUnitCode ?? "");
    const taxRate = findLineTaxRate(taxRates, line.taxRatePercent);
    const netTotal = (lt?.taxableBase ?? Money.zero()).toString();
    const taxAmount = (lt?.tax ?? Money.zero()).toString();
    prevalidationLines.push({
      itemId: line.itemId,
      itemLabel: line.itemNameAr,
      itemCode: item?.etaItemCode ?? null,
      itemCodeType: item?.etaCodeType ?? null,
      unitCode,
      etaUnitCode: unitByCode.get(unitCode) ?? null,
      taxRatePercent: line.taxRatePercent,
      etaTaxSubType: taxRate?.etaSubType ?? null,
      netTotal,
      taxAmount,
    });
    return {
      description: line.itemNameAr,
      // A fallback to the internal code is fine for FILING (the authority is
      // told SOMETHING) but is exactly what `ItemCodeMissing` above flags as
      // not registered — the two must read the same underlying fact.
      itemCode: item?.etaItemCode ?? item?.code ?? line.itemId,
      quantity: line.qty.toString(),
      unitType: unitByCode.get(unitCode) ?? unitCode,
      unitPrice: line.unitPrice.toString(),
      // On a foreign document the authority wants the sold amount AND
      // its pound equivalent; on an EGP one they are the same number.
      unitPriceEgp: invoice.fxRate ? convertToBase(line.unitPrice, invoice.fxRate).toString() : line.unitPrice.toString(),
      netTotal,
      taxSubType: resolveEtaVatSubType(taxRate?.etaSubType, line.taxRatePercent),
      taxRate: String(line.taxRatePercent),
      taxAmount,
    };
  });

  const prevalidation = prevalidateEtaInvoice(
    {
      branchCode: branchMapping?.etaBranchCode ?? null,
      receiver: { type: "B", registrationNumber: taxNumber, customerId: invoice.customerId },
      lines: prevalidationLines,
      totalNet: totals.taxableTotal.toString(),
      totalTax: totals.taxTotal.toString(),
      totalAmount: totals.grandTotal.toString(),
    },
    config,
  );

  return {
    enqueueInput: {
      internalId: invoice.docNo ?? invoice.id,
      documentType: "invoice",
      issueDateTime: occurredAt,
      branchCode: branchMapping?.etaBranchCode ?? null,
      receiver: { registrationNumber: taxNumber, name: invoice.customerNameAr, type: "B" },
      // The document's OWN currency and the rate it was booked at. Filing
      // every line as EGP misstated a foreign invoice to the authority
      // (D78), and the payload refuses a foreign document with no rate
      // rather than sending one at par.
      currency: invoice.currency,
      exchangeRate: invoice.fxRate ?? null,
      lines: payloadLines,
      totalNet: totals.taxableTotal.toString(),
      totalTax: totals.taxTotal.toString(),
      totalAmount: totals.grandTotal.toString(),
    },
    prevalidation,
  };
}

async function enqueueInvoice(
  deps: EtaInvoicePrevalidationDeps,
  invoice: SalesInvoice,
  taxNumber: string,
  occurredAt: string,
): Promise<void> {
  const { enqueueInput, prevalidation } = await buildInvoiceEtaInputs(deps, invoice, taxNumber, occurredAt);
  await deps.eta.enqueue(enqueueInput, prevalidation);
}

/**
 * إصلاح وإعادة الطابور (WF-04 step 4) — rebuild ONE queued invoice
 * submission's payload and pre-validation from the CURRENT state of the
 * source invoice and its masters, after a fix (an item code registered, a
 * customer's TIN entered, …). Returns null when the submission's internal id
 * no longer resolves to a live B2B invoice — `requeue` has nothing to rebuild
 * from and the route reports it rather than filing a stale payload.
 */
export function createEtaInvoiceRequeueRebuilder(
  deps: EtaInvoicePrevalidationDeps & {
    readonly invoices: Pick<SalesInvoiceRepository, "findByDocNo">;
    readonly customers: Pick<CustomerRepository, "findById">;
  },
): (submission: { readonly internalId: string; readonly documentType: string }) => Promise<{
  readonly payload: unknown;
  readonly prevalidation: readonly EtaPrevalidationFinding[];
} | null> {
  return async (submission) => {
    if (submission.documentType !== "invoice") return null;
    const invoice = await deps.invoices.findByDocNo(submission.internalId);
    if (!invoice) return null;
    const customer = await deps.customers.findById(invoice.customerId);
    if (!customer?.taxNumber) return null;
    const { enqueueInput, prevalidation } = await buildInvoiceEtaInputs(
      deps,
      invoice,
      customer.taxNumber,
      invoice.confirmedAt ?? new Date().toISOString(),
    );
    const config = await deps.eta.getConfig();
    return { payload: buildEtaPayload(enqueueInput, config), prevalidation };
  };
}

/**
 * A confirmed SALES RETURN reaches the authority as the document its sale was
 * (D77/D122, D282): a B2B return is an إشعار دائن against the invoice, queued
 * when الإرسال التلقائي is on; a CONSUMER return is a refund receipt
 * (receiptType "r") whose referenceUUID is the sale receipt's UUID, issued on
 * the chain of the device that refunds. Filing a consumer return as a credit
 * note with receiver "P" reported something the receipt regime never sees, and
 * left the sale receipt's VAT standing.
 *
 * ONLY sales returns. A purchase return is a credit note the SUPPLIER issues to
 * us — their filing obligation, not ours.
 */
export function createReturnEtaEnqueueBridge(deps: {
  readonly eta: EtaService;
  readonly issuer: EtaReceiptIssuer;
  readonly returns: Pick<DocumentRepository<SalesReturnLine>, "findById">;
  readonly customers: Pick<CustomerRepository, "findById">;
  readonly items: Pick<ItemRepository, "findById">;
  readonly taxRates: Pick<TaxRateRepository, "list">;
  readonly branchCodes: EtaBranchCodeRepository;
  readonly unitMappings: EtaUnitMappingRepository;
}): DocumentEventPublisher {
  return {
    publish(event) {
      if (event.type !== "DOCUMENT_CONFIRMED" || event.docType !== "SALES_RETURN") return;
      void (async () => {
        const doc = await deps.returns.findById(event.docId);
        const first = doc?.lines[0];
        if (!doc || !first) return;
        const customer = await deps.customers.findById(first.customerId);
        if (!customer?.taxNumber) {
          if (await deps.issuer.issueReturnReceipt(doc.id)) deps.issuer.scheduleSubmission();
          return;
        }
        const config = await deps.eta.getConfig();
        if (!config.autoSubmitOnConfirm) return;

        const [taxRates, branchCodes, unitMappings] = await Promise.all([
          deps.taxRates.list(),
          deps.branchCodes.list(),
          deps.unitMappings.list(),
        ]);
        const unitByCode = new Map(unitMappings.map((m) => [m.unitCode, m.etaUnitCode]));
        const lineItems = await Promise.all(doc.lines.map((line) => deps.items.findById(line.itemId)));

        let totalNet = Money.zero();
        let totalTax = Money.zero();
        const branchCode = branchCodes[0]?.etaBranchCode ?? null;
        const prevalidationLines: EtaPrevalidationLineInput[] = [];
        const lines = doc.lines.map((line, index) => {
          const item = lineItems[index] ?? null;
          const net = extendQtyByPrice(line.qty, line.unitPrice);
          const rate = line.taxRatePercent ?? 0;
          const taxRate = findLineTaxRate(taxRates, rate);
          const unitCode = item?.baseUnitCode ?? "";
          totalNet = totalNet.add(net);
          totalTax = totalTax.add(line.taxAmount);
          prevalidationLines.push({
            itemId: line.itemId,
            itemLabel: item?.nameAr ?? line.itemId,
            itemCode: item?.etaItemCode ?? null,
            itemCodeType: item?.etaCodeType ?? null,
            unitCode,
            etaUnitCode: unitByCode.get(unitCode) ?? null,
            taxRatePercent: rate,
            etaTaxSubType: taxRate?.etaSubType ?? null,
            netTotal: net.toString(),
            taxAmount: line.taxAmount.toString(),
          });
          return {
            description: item?.nameAr ?? line.itemId,
            itemCode: item?.etaItemCode ?? item?.code ?? line.itemId,
            quantity: line.qty.toString(),
            unitType: unitByCode.get(unitCode) ?? unitCode,
            unitPrice: line.unitPrice.toString(),
            netTotal: net.toString(),
            taxSubType: resolveEtaVatSubType(taxRate?.etaSubType, rate),
            taxRate: String(rate),
            taxAmount: line.taxAmount.toString(),
          };
        });

        // Every line of a return belongs to one invoice (the document type
        // enforces it), so the note references exactly that one.
        const referenced = [...new Set(doc.lines.map((l) => l.sourceInvoiceNumber ?? l.sourceInvoiceId))];
        const totalAmount = totalNet.add(totalTax);
        const prevalidation = prevalidateEtaInvoice(
          {
            branchCode,
            receiver: { type: "B", registrationNumber: customer.taxNumber, customerId: first.customerId },
            lines: prevalidationLines,
            totalNet: totalNet.toString(),
            totalTax: totalTax.toString(),
            totalAmount: totalAmount.toString(),
          },
          config,
        );

        await deps.eta.enqueue(
          {
            internalId: doc.docNo ?? doc.id,
            documentType: "credit_note",
            issueDateTime: event.occurredAt,
            branchCode,
            receiver: { registrationNumber: customer.taxNumber, name: customer.nameAr, type: "B" },
            referencedDocumentIds: referenced,
            lines,
            totalNet: totalNet.toString(),
            totalTax: totalTax.toString(),
            totalAmount: totalAmount.toString(),
          },
          prevalidation,
        );
      })().catch((error: unknown) => {
        if (error instanceof DuplicateEtaSubmissionError) return;
        console.error(`[eta] could not queue ${event.docType}/${event.docId}`, error);
      });
    },
  };
}
