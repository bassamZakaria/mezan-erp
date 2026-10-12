import { resolveEtaEndpoints, type EtaConfig, type EtaConfigRepository } from "./config.js";
import { buildEtaPayload, type EtaDocumentInput } from "./payload.js";
import {
  buildEtaReceiptPayload,
  canonicalizeEtaDocument,
  etaReceiptIssuedAt,
  etaReceiptQrValue,
  etaReceiptReissueDeadline,
  summarizeEtaReceiptQueue,
  unavailableEtaReceiptUuidPort,
  ETA_RECEIPT_BATCH_MAX,
  ETA_RECEIPT_REISSUE_WINDOW_HOURS,
  type EtaReceiptInput,
  type EtaReceiptQueueSummary,
  type EtaReceiptUuidPort,
} from "./receipt.js";
import {
  attachEtaSignature,
  etaPayloadIsSigned,
  EtaSigningUnavailableError,
  type EtaSignatureResult,
  type EtaSigningPort,
} from "./signing.js";
import {
  EtaSubmissionState,
  type EtaSubmission,
  type EtaSubmissionRepository,
  type EtaSubmissionStatus,
  type EtaTransmitLogEntry,
} from "./submission.js";
import { canonicalEtaJson, unconfiguredEtaSigner, type EtaSignerPort } from "./signer.js";
import { summarizeEtaRejections, type EtaRejectionsReport } from "./rejections-report.js";
import {
  createInMemoryEtaReceiptChain,
  createInMemoryEtaReceiptGaps,
  createKeyedSerializer,
  EtaReceiptChainConflictError,
  type EtaReceiptChainHead,
  type EtaReceiptChainRepository,
  type EtaReceiptGap,
  type EtaReceiptGapRepository,
} from "./receipt-chain.js";
import {
  DuplicateEtaSubmissionError,
  EtaDeviceSerialNotRegisteredError,
  EtaExclusionReasonRequiredError,
  EtaOfflineError,
  EtaReissueNotRejectedError,
  EtaReissueSameInternalIdError,
  EtaReissueWindowExpiredError,
  EtaSignerNotConfiguredError,
  EtaSigningFailedError,
  EtaSubmissionNotFoundError,
  EtaSubmissionInFlightError,
  InvalidEtaTransitionError,
} from "./errors.js";
import {
  EtaPrevalidationFailedError,
  EtaPrevalidationSeverity,
  hasBlockingEtaFindings,
  type EtaPrevalidationFinding,
} from "./prevalidate.js";

/**
 * Result of a transmit attempt against the ETA gateway. `ok` → accepted for
 * processing (moves to مرسل); `errors` → rejected (moves to أخطاء). `log`
 * carries every request/response of the attempt so the submission record keeps
 * the evidence of what was actually filed.
 */
export interface EtaTransmitResult {
  readonly ok: boolean;
  readonly etaUuid?: string;
  readonly submissionId?: string | null;
  readonly errors?: readonly string[];
  /** One authority error code per entry of {@link errors} (same index), null where none was sent. */
  readonly errorCodes?: readonly (string | null)[];
  readonly log?: readonly EtaTransmitLogEntry[];
}

/** What the authority says about a document already transmitted. */
export interface EtaStatusResult {
  readonly state: "accepted" | "rejected" | "pending" | "unknown";
  readonly errors: readonly string[];
  /** One authority error code per entry of {@link errors} (same index), null where none was sent. */
  readonly errorCodes?: readonly (string | null)[];
  readonly log?: readonly EtaTransmitLogEntry[];
}

/** One receipt's outcome inside a batch `/receiptsubmissions` call. */
export interface EtaReceiptBatchOutcome {
  readonly submissionId: string;
  readonly ok: boolean;
  readonly etaUuid?: string;
  readonly errors?: readonly string[];
  /** One authority error code per entry of {@link errors} (same index), null where none was sent. */
  readonly errorCodes?: readonly (string | null)[];
}

/** Result of reporting up to {@link ETA_RECEIPT_BATCH_MAX} receipts of ONE device in a single call. */
export interface EtaReceiptBatchResult {
  readonly submissionUUID?: string | null;
  /** One outcome per submission handed in, same order. */
  readonly outcomes: readonly EtaReceiptBatchOutcome[];
  readonly log?: readonly EtaTransmitLogEntry[];
}

/** Port for the ONLINE transmit step. See {@link stubOnlineTransmitPort} and `createEtaHttpTransmitPort`. */
export interface EtaTransmitPort {
  transmit(submission: EtaSubmission, config: EtaConfig): Promise<EtaTransmitResult>;
  /** Polls `GET /documents/{uuid}/raw`. Absent on ports that cannot reach the network. */
  fetchStatus?(submission: EtaSubmission, config: EtaConfig): Promise<EtaStatusResult>;
  /** اختبار الاتصال — a real token request against the identity server. */
  checkCredentials?(config: EtaConfig): Promise<EtaConnectionCheck>;
  /**
   * D-B4 — reports every submission in ONE `/receiptsubmissions` call (at most
   * {@link ETA_RECEIPT_BATCH_MAX}, all of the same device). Absent on a port
   * with no batch leg — `submitReadyReceipts` then falls back to one `submit()`
   * per receipt, exactly as before this lane.
   */
  transmitReceiptBatch?(submissions: readonly EtaSubmission[], config: EtaConfig): Promise<EtaReceiptBatchResult>;
}

/** The honest answer to اختبار الاتصال: what was tried, and what came back. */
export interface EtaConnectionCheck {
  readonly ok: boolean;
  readonly reason: "connected" | "missing_credentials" | "rejected" | "unreachable";
  readonly detail: string | null;
  readonly identityUrl: string;
  readonly checkedAt: string;
}

/**
 * The OFFLINE default. An install with no ETA credentials configured never
 * opens a socket: this refuses with {@link EtaOfflineError} and leaves the
 * document queued. `createEtaHttpTransmitPort` (transmit.ts) is the real leg
 * and is wired in whenever the config carries credentials.
 */
export function stubOnlineTransmitPort(): EtaTransmitPort {
  return {
    async transmit(): Promise<EtaTransmitResult> {
      throw new EtaOfflineError();
    },
  };
}

export interface EtaServiceDeps {
  readonly config: EtaConfigRepository;
  readonly submissions: EtaSubmissionRepository;
  /** Defaults to the offline stub — supply a real client to actually transmit. */
  readonly transmit?: EtaTransmitPort;
  /** The e-seal. Defaults to a signer that refuses in Arabic until one is configured. */
  readonly signer?: EtaSignerPort;
  readonly now?: () => string;
  /** Generates ids for new submissions. */
  readonly newId?: () => string;
  /**
   * SHA-256 for the e-receipt UUID. Defaults to a port that REFUSES rather
   * than inventing one — a fabricated UUID prints a QR that resolves to
   * nothing at the authority.
   */
  readonly receiptUuid?: EtaReceiptUuidPort;
  /**
   * الختم الإلكتروني — the signing agent. Defaults to a port that refuses, so
   * a submission parks in بانتظار التوقيع and stays there instead of being
   * transmitted unsigned.
   */
  readonly signing?: EtaSigningPort;
  /**
   * The per-device previousUUID chain. Defaults to one held in memory over
   * `submissions`; a persistent install passes the SQLite table so the head
   * advances in the same transaction as the receipt row.
   */
  readonly receiptChain?: EtaReceiptChainRepository;
  /** Sales and returns that should have a receipt and do not. Defaults to memory. */
  readonly receiptGaps?: EtaReceiptGapRepository;
}

/**
 * A receipt to issue. `previousUuid` is deliberately absent: the chain head is
 * read from the device's own chain row inside the issue, never taken from a
 * caller, because a caller-supplied predecessor is how two sales end up
 * claiming the same link.
 */
export type EtaChainedReceiptInput = Omit<EtaReceiptInput, "previousUuid">;

/** What a till needs to print (or reprint) one receipt. */
export interface EtaReceiptPrintData {
  readonly submission: EtaSubmission;
  readonly uuid: string;
  readonly qrValue: string;
  /** رقم الإيصال — the number printed on the paper (the submission's internalId). */
  readonly receiptNo: string;
}

export const ETA_UNRECORDED_SUBMISSION_CODE = "MEZAN_UNRECORDED_SUBMISSION";
const ETA_UNRECORDED_SUBMISSION_MESSAGE =
  "أُرسل هذا المستند إلى مصلحة الضرائب ولم يُسجَّل ردّها، فلم يُرسَل مرة أخرى. راجع بوابة الفواتير الإلكترونية: إن وجدته مسجَّلًا فسجِّل رقمه (UUID) هنا، وإن لم تجده فأعده إلى الطابور ليُرسَل.";
const HTTP_NOT_FOUND = 404;

const RECEIPT_CHAIN_ATTEMPTS = 3;

function queueOrder(a: EtaSubmission, b: EtaSubmission): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return (a.receiptSeq ?? 0) - (b.receiptSeq ?? 0);
}

/** An in-bounds index into `arr` — `noUncheckedIndexedAccess` cannot see the loop invariant that guarantees this. */
function at<T>(arr: readonly T[], index: number): T {
  const value = arr[index];
  if (value === undefined) throw new Error(`Index ${index} out of bounds (length ${arr.length}).`);
  return value;
}

/** Input to enqueue a confirmed document. */
export type EtaEnqueueInput = EtaDocumentInput;

/**
 * EXTERNAL CONTRACT: the CAdES-BES key lives on the taxpayer's hardware token
 * and never leaves it, so the only e-seal implementation that can exist is an
 * out-of-process one. This adapts that external signing program to the e-seal
 * port; its refusals become {@link EtaSigningUnavailableError} so a v1.0
 * document parks in بانتظار التوقيع instead of being transmitted unsigned.
 */
function esealPortFromExternalSigner(signer: EtaSignerPort, now: () => string): EtaSigningPort {
  return {
    async sign(submission: EtaSubmission): Promise<EtaSignatureResult> {
      try {
        const value = await signer.sign(canonicalEtaJson(submission.payload));
        return { signatureType: "I", value, signedAt: now() };
      } catch (err) {
        if (err instanceof EtaSignerNotConfiguredError) throw new EtaSigningUnavailableError();
        if (err instanceof EtaSigningFailedError) throw new EtaSigningUnavailableError(err.message);
        throw err;
      }
    },
  };
}

/**
 * The ETA e-invoicing service: build the payload, queue a confirmed document,
 * drive the جاهز→بانتظار التوقيع→مرسل→مقبول lifecycle, and route the online
 * transmit through a (stubbed) port. All queue state is real and offline.
 */
export class EtaService {
  private readonly transmitPort: EtaTransmitPort;
  private readonly signerPort: EtaSignerPort;
  private readonly receiptUuidPort: EtaReceiptUuidPort;
  private readonly signingPort: EtaSigningPort;
  private readonly receiptChain: EtaReceiptChainRepository;
  private readonly receiptGaps: EtaReceiptGapRepository;
  private readonly perDevice = createKeyedSerializer();
  // Signing and transmitting are awaited with the tenant's connection handed
  // back, so another request can reach the same document meanwhile. One held
  // here is refused to every other sender and editor until its outcome is
  // written. In memory on purpose: a process that dies mid-flight must leave
  // the document where it was, to be sent again.
  private readonly inFlight = new Set<string>();
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(private readonly deps: EtaServiceDeps) {
    this.transmitPort = deps.transmit ?? stubOnlineTransmitPort();
    this.signerPort = deps.signer ?? unconfiguredEtaSigner();
    this.receiptUuidPort = deps.receiptUuid ?? unavailableEtaReceiptUuidPort();
    this.now = deps.now ?? (() => new Date().toISOString());
    this.signingPort = deps.signing ?? esealPortFromExternalSigner(this.signerPort, () => this.now());
    this.newId = deps.newId ?? (() => `eta-${Math.random().toString(36).slice(2)}`);
    this.receiptChain = deps.receiptChain ?? createInMemoryEtaReceiptChain(deps.submissions);
    this.receiptGaps = deps.receiptGaps ?? createInMemoryEtaReceiptGaps();
  }

  getConfig(): Promise<EtaConfig> {
    return this.deps.config.get();
  }

  saveConfig(config: EtaConfig): Promise<void> {
    return this.deps.config.save(config);
  }

  list(status?: EtaSubmissionStatus): Promise<EtaSubmission[]> {
    return this.deps.submissions.list(status);
  }

  /** تقرير أسباب الرفض — every رفض submission grouped by its authority error code. */
  async rejectionsReport(): Promise<EtaRejectionsReport> {
    return summarizeEtaRejections(await this.deps.submissions.list());
  }

  /**
   * Build the payload and add a confirmed document to the queue in status
   * جاهز. `prevalidation` is the ENH-011b pre-check the caller already ran
   * against the source document's own master data (item/unit/tax-rate/branch
   * mappings the domain layer has no port to read itself) — it is ALWAYS
   * stored, never thrown here: a confirm is never blocked by it (WF-04 step
   * 1 warns, it does not refuse). `EtaService.submit` is where a `Blocking`
   * finding actually stops the document.
   */
  async enqueue(
    input: EtaEnqueueInput,
    prevalidation: readonly EtaPrevalidationFinding[] = [],
  ): Promise<EtaSubmission> {
    const existing = await this.deps.submissions.findByInternalId(input.internalId);
    if (existing) throw new DuplicateEtaSubmissionError(input.internalId);
    const config = await this.deps.config.get();
    const stamp = this.now();
    const submission: EtaSubmission = {
      id: this.newId(),
      internalId: input.internalId,
      documentType: input.documentType,
      status: "ready",
      etaUuid: null,
      payload: buildEtaPayload(input, config),
      errors: [],
      exclusionReason: null,
      createdAt: stamp,
      updatedAt: stamp,
      submittedAt: null,
      gatewaySubmissionId: null,
      signature: null,
      transmitLog: [],
      prevalidation,
    };
    await this.deps.submissions.create(submission);
    return submission;
  }

  /**
   * إصلاح وإعادة الطابور (WF-04 step 4) — regenerate a queued document's
   * payload and pre-validation after the underlying data was fixed (an item
   * code registered, a customer's TIN entered, …). Only a document the
   * authority has not yet accepted or is currently processing may be rebuilt:
   * requeuing a أُرسل/مقبول submission would silently replace evidence of
   * what was actually filed. `signature` is cleared — a changed payload
   * invalidates any prior e-seal.
   */
  async requeue(
    id: string,
    rebuilt: { readonly payload: unknown; readonly prevalidation: readonly EtaPrevalidationFinding[] },
  ): Promise<EtaSubmission> {
    const submission = await this.require(id);
    if (!["ready", "pending_signature", "error", "excluded"].includes(submission.status)) {
      throw new InvalidEtaTransitionError(submission.status, "requeue");
    }
    return this.persist({
      ...submission,
      status: "ready",
      payload: rebuilt.payload,
      prevalidation: rebuilt.prevalidation,
      errors: [],
      rejectionCodes: [],
      transmitStartedAt: null,
      exclusionReason: null,
      signature: null,
    });
  }

  /**
   * إصدار إيصال إلكتروني — issue one receipt on its device's chain and hand
   * back what the paper needs. IDEMPOTENT: a receipt already issued under this
   * number is returned as it stands, with the UUID it was printed with the
   * first time. A reprint is the same piece of paper, so it carries the same
   * identifier and the same QR — minting a second submission would report one
   * sale to the authority twice and fork the device's chain.
   *
   * The UUID is computed here, before printing, because the receipt is
   * reported AFTER the sale and the customer walks out with the QR in hand.
   * Issues on one serial run one at a time; the head is read, the receipt
   * built on it, and the chain advanced by compare-and-set with the insert.
   */
  async enqueueReceipt(input: EtaChainedReceiptInput): Promise<EtaReceiptPrintData> {
    const serial = input.seller.deviceSerialNumber.trim();
    if (serial === "") throw new EtaDeviceSerialNotRegisteredError(input.seller.branchCode);
    return this.perDevice(serial, async () => {
      const config = await this.deps.config.get();
      for (let attempt = 0; attempt < RECEIPT_CHAIN_ATTEMPTS; attempt++) {
        const existing = await this.deps.submissions.findByInternalId(input.internalId);
        if (existing) {
          if (existing.documentType !== "receipt") throw new DuplicateEtaSubmissionError(input.internalId);
          return this.receiptPrintData(existing, config);
        }
        const head = await this.receiptChain.head(serial);
        const previousUuid = head?.lastUuid ?? null;
        const payload = buildEtaReceiptPayload(
          { ...input, seller: { ...input.seller, deviceSerialNumber: serial }, previousUuid },
          config,
        );
        const uuid = await this.receiptUuidPort.compute(canonicalizeEtaDocument(payload));
        (payload.header as Record<string, unknown>).uuid = uuid;
        const stamp = this.now();
        const submission: EtaSubmission = {
          id: this.newId(),
          internalId: input.internalId,
          documentType: "receipt",
          status: "ready",
          etaUuid: uuid,
          payload,
          errors: [],
          exclusionReason: null,
          createdAt: stamp,
          updatedAt: stamp,
          submittedAt: null,
          gatewaySubmissionId: null,
          signature: null,
          transmitLog: [],
          receiptSerial: serial,
          receiptSeq: (head?.lastSeq ?? 0) + 1,
        };
        if (await this.receiptChain.append({ serial, expectedPreviousUuid: previousUuid, submission })) {
          await this.receiptGaps.clear(input.internalId);
          return this.receiptPrintData(submission, config);
        }
      }
      throw new EtaReceiptChainConflictError(serial);
    });
  }

  /**
   * تصحيح إيصال مرفوض وإعادة إصداره (D-B4) — the authority lets a receipt it
   * REJECTED be corrected and re-submitted, referencing header.referenceOldUUID
   * at the rejected receipt's own UUID, but only within 96 hours of that
   * rejected receipt's own issuance (SDK Receipt Issuance FAQ). `corrected` is
   * a fresh receipt built by the caller from the now-fixed source document —
   * it MUST carry a new `internalId` (a corrected receipt is a new document on
   * the chain, not an edit of the old one) — and is issued through the exact
   * same per-device chain compare-and-set as any other receipt: this method
   * only enforces the window and the reference, then delegates to
   * {@link enqueueReceipt}.
   */
  async reissueReceipt(rejectedInternalId: string, corrected: EtaChainedReceiptInput): Promise<EtaReceiptPrintData> {
    const rejected = await this.deps.submissions.findByInternalId(rejectedInternalId);
    if (!rejected || rejected.documentType !== "receipt" || rejected.status !== "error" || !rejected.etaUuid) {
      throw new EtaReissueNotRejectedError(rejectedInternalId);
    }
    if (corrected.internalId === rejectedInternalId) {
      throw new EtaReissueSameInternalIdError(rejectedInternalId);
    }
    const issuedAt = etaReceiptIssuedAt(rejected);
    if (Date.parse(this.now()) > Date.parse(etaReceiptReissueDeadline(issuedAt))) {
      throw new EtaReissueWindowExpiredError(issuedAt, ETA_RECEIPT_REISSUE_WINDOW_HOURS);
    }
    return this.enqueueReceipt({ ...corrected, referenceOldUuid: rejected.etaUuid });
  }

  /** يسجّل بيعاً لم يصدر له إيصال, so the reporting-window counters include it. */
  recordReceiptGap(gap: EtaReceiptGap): Promise<void> {
    return this.receiptGaps.record(gap);
  }

  listReceiptGaps(): Promise<EtaReceiptGap[]> {
    return this.receiptGaps.list();
  }

  /** رأس السلسلة — the device's last issued receipt, or null before its first. */
  receiptChainHead(serial: string): Promise<EtaReceiptChainHead | null> {
    return this.receiptChain.head(serial);
  }

  /** إعادة طباعة — the stored identifier, never a fresh one. */
  async receiptForPrint(internalId: string): Promise<EtaReceiptPrintData | null> {
    const submission = await this.deps.submissions.findByInternalId(internalId);
    if (!submission || submission.documentType !== "receipt") return null;
    return this.receiptPrintData(submission, await this.deps.config.get());
  }

  /**
   * كم إيصالاً لم يُبلَّغ بعد — the pending and past-window counts. Offline is
   * a normal state for a till, so a rising `pending` is expected; `overdue`
   * above zero is the number a shop must act on.
   */
  async receiptQueueSummary(now?: string): Promise<EtaReceiptQueueSummary> {
    const [all, config, gaps] = await Promise.all([
      this.deps.submissions.list(),
      this.deps.config.get(),
      this.receiptGaps.list(),
    ]);
    // A sale that never got a receipt is as unreported as one stuck in the
    // queue, and ages against the same window from the sale moment.
    const unissued = gaps.map((g) => ({
      id: `gap:${g.internalId}`,
      internalId: g.internalId,
      documentType: "receipt",
      status: "error",
      payload: { header: { dateTimeIssued: g.issuedAt } },
      createdAt: g.recordedAt,
    }));
    return {
      ...summarizeEtaReceiptQueue([...all, ...unissued], now ?? this.now(), config.receiptReportingWindowHours),
      unissued: gaps.length,
    };
  }

  private receiptPrintData(submission: EtaSubmission, config: EtaConfig): EtaReceiptPrintData {
    const payload = submission.payload as {
      header?: { dateTimeIssued?: string };
      totalAmount?: string;
      seller?: { rin?: string };
    } | null;
    const uuid = submission.etaUuid ?? "";
    return {
      submission,
      uuid,
      receiptNo: submission.internalId,
      qrValue: etaReceiptQrValue({
        uuid,
        issueDateTime: payload?.header?.dateTimeIssued ?? submission.createdAt,
        environment: config.environment,
        totalAmount: payload?.totalAmount ?? null,
        issuerRin: payload?.seller?.rin || config.taxRegistrationNumber,
      }),
    };
  }

  /**
   * Submit one queued document. When the config requires an e-seal (v1.0
   * signing) a ready submission first moves to بانتظار التوقيع; from there the
   * external signer runs and the signed document is transmitted. An install
   * with no credentials never opens a socket: the offline port refuses and the
   * document stays queued.
   */
  async submit(id: string): Promise<EtaSubmission> {
    return this.holding([id], () => this.submitHeld(id));
  }

  private async submitHeld(id: string): Promise<EtaSubmission> {
    let submission = await this.found(id);
    if (!["ready", "pending_signature", "error"].includes(submission.status)) {
      throw new InvalidEtaTransitionError(submission.status, "submit");
    }
    if (submission.transmitStartedAt) {
      const settled = await this.settleUnrecorded(submission, await this.deps.config.get());
      if (settled) return settled;
      submission = await this.found(id);
    }
    // ENH-011b: a `Blocking` finding means the authority would refuse this
    // document outright — refused here, before a wasted round trip, listing
    // every failing rule so a fix pass does not take one submit per rule.
    if (submission.prevalidation && hasBlockingEtaFindings(submission.prevalidation)) {
      throw new EtaPrevalidationFailedError(
        submission.prevalidation.filter((f) => f.severity === EtaPrevalidationSeverity.Blocking),
      );
    }
    const config = await this.deps.config.get();

    // EXTERNAL CONTRACT: an e-receipt (B2C) carries NO e-signature or e-seal —
    // the accounting system registered as the software POS is itself the
    // issuing device. Only the B2B e-invoice needs the CAdES seal. Gating
    // receipts on `signingMethod` parked every consumer sale in
    // بانتظار التوقيع waiting for a signature the regime never asks for.
    const needsSeal = config.signingMethod === "eseal" && submission.documentType !== "receipt";
    if (needsSeal && !etaPayloadIsSigned(submission.payload)) {
      try {
        const signature = await this.signingPort.sign(submission, config);
        submission = await this.persist({
          ...submission,
          payload: attachEtaSignature(submission.payload, signature),
          signature: signature.value,
          status: "ready",
          errors: [],
        });
      } catch (err) {
        if (!(err instanceof EtaSigningUnavailableError)) throw err;
        // Parked, and it says why. Pressing إرسال again re-enters this branch
        // and parks again: an unsigned 1.0 document is never transmitted.
        return this.persist({ ...submission, status: "pending_signature", errors: [err.message] });
      }
    }

    submission = await this.persist({ ...submission, transmitStartedAt: this.now() });
    let result: EtaTransmitResult;
    try {
      result = await this.transmitPort.transmit(submission, config);
    } catch (err) {
      // Never reached the authority, so nothing is awaiting a record. Any
      // other failure — a lost turn above all — leaves the mark in place.
      if (err instanceof EtaOfflineError) await this.persist({ ...submission, transmitStartedAt: null });
      throw err;
    }
    const withLog = { ...this.appendLog(submission, result.log), transmitStartedAt: null };
    if (result.ok) {
      return this.persist({
        ...withLog,
        status: "submitted",
        errors: [],
        etaUuid: result.etaUuid ?? withLog.etaUuid,
        gatewaySubmissionId: result.submissionId ?? withLog.gatewaySubmissionId,
        submittedAt: this.now(),
      });
    }
    return this.persist({
      ...withLog,
      status: "error",
      errors: result.errors ?? ["فشل الإرسال"],
      rejectionCodes: result.errorCodes ?? [],
    });
  }

  // A document marked as handed over whose answer was never recorded. It is
  // never sent again on its own: the authority is asked what it holds when the
  // UUID is known, and otherwise the document is put in front of a person.
  // Returns null only when the authority says it has never seen it, which is
  // the one case a resend is safe.
  private async settleUnrecorded(submission: EtaSubmission, config: EtaConfig): Promise<EtaSubmission | null> {
    if (!this.transmitPort.fetchStatus || !submission.etaUuid) {
      return this.persist({
        ...submission,
        status: EtaSubmissionState.Error,
        errors: [ETA_UNRECORDED_SUBMISSION_MESSAGE],
        rejectionCodes: [ETA_UNRECORDED_SUBMISSION_CODE],
      });
    }
    const result = await this.transmitPort.fetchStatus(submission, config);
    const withLog = this.appendLog(submission, result.log);
    if (result.state === "accepted") {
      return this.persist({ ...withLog, status: EtaSubmissionState.Accepted, errors: [], rejectionCodes: [], transmitStartedAt: null });
    }
    if (result.state === "rejected") {
      return this.persist({
        ...withLog,
        status: EtaSubmissionState.Error,
        errors: result.errors,
        rejectionCodes: result.errorCodes ?? [],
        transmitStartedAt: null,
      });
    }
    if (result.state === "pending") {
      return this.persist({
        ...withLog,
        status: EtaSubmissionState.Submitted,
        errors: [],
        submittedAt: submission.transmitStartedAt ?? this.now(),
        transmitStartedAt: null,
      });
    }
    if (result.log?.at(-1)?.status !== HTTP_NOT_FOUND) return this.persist(withLog);
    await this.persist({ ...withLog, status: EtaSubmissionState.Ready, errors: [], rejectionCodes: [], transmitStartedAt: null });
    return null;
  }

  /**
   * تحديث الحالة من المصلحة — poll `GET /documents/{uuid}/raw` for one
   * transmitted document and record the clearance or the rejection. A port with
   * no network leg (or a document with no UUID) refuses offline and changes
   * nothing.
   */
  async refreshStatus(id: string): Promise<EtaSubmission> {
    return this.holding([id], () => this.refreshStatusHeld(id));
  }

  private async refreshStatusHeld(id: string): Promise<EtaSubmission> {
    const submission = await this.found(id);
    if (submission.status !== "submitted") throw new InvalidEtaTransitionError(submission.status, "refresh");
    if (!this.transmitPort.fetchStatus || !submission.etaUuid) throw new EtaOfflineError();
    const config = await this.deps.config.get();
    const result = await this.transmitPort.fetchStatus(submission, config);
    const withLog = this.appendLog(submission, result.log);
    if (result.state === "accepted") {
      return this.persist({ ...withLog, status: "accepted", errors: [] });
    }
    if (result.state === "rejected") {
      return this.persist({ ...withLog, status: "error", errors: result.errors, rejectionCodes: result.errorCodes ?? [] });
    }
    return this.persist(withLog);
  }

  /**
   * معالجة قائمة الإرسال — drive the whole queue in one pass: submit everything
   * ready (and everything awaiting signature, once a signer is configured),
   * then poll every document already transmitted for its clearance. Offline and
   * unsigned documents are collected rather than thrown, so one unreachable
   * document does not abort the run.
   */
  async processQueue(): Promise<{
    submitted: EtaSubmission[];
    accepted: EtaSubmission[];
    rejected: EtaSubmission[];
    queued: string[];
    unsigned: string[];
  }> {
    const submitted: EtaSubmission[] = [];
    const accepted: EtaSubmission[] = [];
    const rejected: EtaSubmission[] = [];
    const queued: string[] = [];
    const unsigned: string[] = [];

    // Oldest first, and a device's receipts in chain order: a link reported
    // before its predecessor names a previousUUID the authority has not seen.
    const pending = [
      ...(await this.deps.submissions.list("ready")),
      ...(await this.deps.submissions.list("pending_signature")),
    ].sort(queueOrder);
    for (const s of pending) {
      try {
        const next = await this.submit(s.id);
        if (next.status === "submitted") submitted.push(next);
        else if (next.status === "error") rejected.push(next);
        else if (next.status === "pending_signature") unsigned.push(s.id);
      } catch (err) {
        if (err instanceof EtaOfflineError || err instanceof EtaSubmissionInFlightError) queued.push(s.id);
        else if (err instanceof EtaSignerNotConfiguredError || err instanceof EtaSigningFailedError) unsigned.push(s.id);
        else if (!(err instanceof InvalidEtaTransitionError)) throw err;
      }
    }

    if (this.transmitPort.fetchStatus) {
      for (const s of await this.deps.submissions.list("submitted")) {
        try {
          const next = await this.refreshStatus(s.id);
          if (next.status === "accepted") accepted.push(next);
          else if (next.status === "error") rejected.push(next);
        } catch (err) {
          if (err instanceof EtaOfflineError || err instanceof EtaSubmissionInFlightError) queued.push(s.id);
          else if (!(err instanceof InvalidEtaTransitionError)) throw err;
        }
      }
    }

    return { submitted, accepted, rejected, queued, unsigned };
  }

  /**
   * إرسال الإيصالات الجاهزة — report every queued receipt, device by device, in
   * chain order, in calls of at most {@link ETA_RECEIPT_BATCH_MAX} (D-B4). A
   * device that is offline (no credentials, no network) keeps the rest of its
   * chain queued rather than reporting later links first; a chunk with any
   * rejection halts the rest of ITS device's queue the same way, but the
   * receipts the authority DID accept inside that same chunk stay accepted —
   * a partially rejected batch never loses the accepted half.
   */
  async submitReadyReceipts(): Promise<{ submitted: EtaSubmission[]; queued: string[]; rejected: EtaSubmission[] }> {
    const ready = (await this.deps.submissions.list("ready"))
      .filter((s) => s.documentType === "receipt")
      .sort((a, b) =>
        (a.receiptSerial ?? "") !== (b.receiptSerial ?? "")
          ? (a.receiptSerial ?? "") < (b.receiptSerial ?? "") ? -1 : 1
          : (a.receiptSeq ?? 0) - (b.receiptSeq ?? 0) || queueOrder(a, b),
      );
    const referenceOf = (s: EtaSubmission): string | null => {
      const reference = (s.payload as { header?: { referenceUUID?: unknown } } | null)?.header?.referenceUUID;
      return typeof reference === "string" ? reference : null;
    };
    const statusByUuid = new Map<string, EtaSubmissionStatus>();
    for (const reference of new Set(ready.map(referenceOf))) {
      const status = reference === null ? null : await this.deps.submissions.statusByEtaUuid(reference);
      if (reference !== null && status !== null) statusByUuid.set(reference, status);
    }
    const submitted: EtaSubmission[] = [];
    const queued: string[] = [];
    const rejected: EtaSubmission[] = [];
    const halted = new Set<string>();
    const referenceStatusOf = (s: EtaSubmission): string | undefined => {
      // A refund names its sale receipt, which must already be with the
      // authority — a refund on another till could otherwise overtake it.
      const reference = referenceOf(s);
      return reference === null ? undefined : statusByUuid.get(reference);
    };
    const referenceReady = (s: EtaSubmission): boolean => {
      const status = referenceStatusOf(s);
      return status === undefined || status === "submitted" || status === "accepted";
    };

    let index = 0;
    while (index < ready.length) {
      const s = at(ready, index);
      const serial = s.receiptSerial ?? `legacy:${s.id}`;
      if (halted.has(serial) || !referenceReady(s)) {
        halted.add(serial);
        queued.push(s.id);
        index++;
        continue;
      }
      // A run of the SAME device's queue, chain order already guaranteeing
      // it is consecutive here, stops at the batch cap or at the first
      // receipt whose reference is not yet clear to report.
      const chunk: EtaSubmission[] = [s];
      let j = index + 1;
      while (j < ready.length && chunk.length < ETA_RECEIPT_BATCH_MAX) {
        const next = at(ready, j);
        if ((next.receiptSerial ?? `legacy:${next.id}`) !== serial || !referenceReady(next)) break;
        chunk.push(next);
        j++;
      }
      index = j;

      try {
        const outcomes = await this.submitReceiptChunk(chunk);
        let chunkFailed = false;
        for (const next of outcomes) {
          statusByUuid.set(next.etaUuid ?? "", next.status);
          if (next.status === "submitted") submitted.push(next);
          else if (next.status === "error") {
            rejected.push(next);
            chunkFailed = true;
          }
        }
        if (chunkFailed) halted.add(serial);
      } catch (err) {
        if (!(err instanceof EtaOfflineError || err instanceof EtaSubmissionInFlightError)) throw err;
        halted.add(serial);
        for (const queuedSubmission of chunk) queued.push(queuedSubmission.id);
      }
    }
    // 202 is only the synchronous half of the authority's validation; a receipt
    // can turn Invalid afterwards, and only a poll brings that back to the queue.
    if (this.transmitPort.fetchStatus) {
      for (const s of await this.deps.submissions.list("submitted")) {
        if (s.documentType !== "receipt") continue;
        try {
          const next = await this.refreshStatus(s.id);
          if (next.status === "error") rejected.push(next);
        } catch (err) {
          if (!(err instanceof EtaOfflineError || err instanceof EtaSubmissionInFlightError || err instanceof InvalidEtaTransitionError)) throw err;
        }
      }
    }
    return { submitted, queued, rejected };
  }

  /**
   * Reports one device's chunk (≤ {@link ETA_RECEIPT_BATCH_MAX}) in a single
   * `/receiptsubmissions` call when the transmit port supports it, mapping
   * `acceptedDocuments`/`rejectedDocuments` back onto each submission; falls
   * back to one {@link submit} per receipt on a port with no batch leg.
   */
  private async submitReceiptChunk(chunk: readonly EtaSubmission[]): Promise<EtaSubmission[]> {
    if (!this.transmitPort.transmitReceiptBatch) {
      const out: EtaSubmission[] = [];
      for (const s of chunk) {
        try {
          out.push(await this.submit(s.id));
        } catch (err) {
          if (!(err instanceof InvalidEtaTransitionError)) throw err;
        }
      }
      return out;
    }
    const transmitBatch = this.transmitPort.transmitReceiptBatch.bind(this.transmitPort);
    return this.holding(
      chunk.map((s) => s.id),
      async () => {
        // The caller listed this chunk before earlier chunks went out, and each
        // of those waited on the authority. Read again now the ids are held:
        // a receipt another drive reported meanwhile is not reported twice.
        const config = await this.deps.config.get();
        const out: EtaSubmission[] = [];
        const still: EtaSubmission[] = [];
        for (const listed of chunk) {
          let now = await this.found(listed.id);
          if (now.status === EtaSubmissionState.Ready && now.transmitStartedAt) {
            const settled = await this.settleUnrecorded(now, config);
            if (settled) out.push(settled);
            now = settled ?? (await this.found(listed.id));
          }
          // A chain: each receipt names the one before it. Once a link is
          // refused or left unsettled, the links after it are not reported.
          if (now.status === EtaSubmissionState.Error || now.transmitStartedAt) break;
          if (now.status === EtaSubmissionState.Ready) still.push(now);
        }
        if (still.length === 0) return out;
        const startedAt = this.now();
        for (let i = 0; i < still.length; i += 1) still[i] = await this.persist({ ...at(still, i), transmitStartedAt: startedAt });
        let result: Awaited<ReturnType<typeof transmitBatch>>;
        try {
          result = await transmitBatch(still, config);
        } catch (err) {
          if (err instanceof EtaOfflineError) {
            for (const s of still) await this.persist({ ...s, transmitStartedAt: null });
          }
          throw err;
        }
        const byId = new Map(result.outcomes.map((o) => [o.submissionId, o]));
        for (const s of still) {
          const outcome = byId.get(s.id) ?? {
            submissionId: s.id,
            ok: false,
            errors: ["لم يرد رد من مصلحة الضرائب لهذا الإيصال ضمن الدفعة."],
          };
          out.push(await this.applyReceiptOutcome(s, outcome, result.log, result.submissionUUID ?? null));
        }
        return out;
      },
    );
  }

  private async applyReceiptOutcome(
    submission: EtaSubmission,
    outcome: {
      readonly ok: boolean;
      readonly etaUuid?: string;
      readonly errors?: readonly string[];
      readonly errorCodes?: readonly (string | null)[];
    },
    log: readonly EtaTransmitLogEntry[] | undefined,
    gatewaySubmissionId: string | null,
  ): Promise<EtaSubmission> {
    const withLog = { ...this.appendLog(submission, log), transmitStartedAt: null };
    if (outcome.ok) {
      return this.persist({
        ...withLog,
        status: "submitted",
        errors: [],
        etaUuid: outcome.etaUuid ?? withLog.etaUuid,
        gatewaySubmissionId: gatewaySubmissionId ?? withLog.gatewaySubmissionId,
        submittedAt: this.now(),
      });
    }
    return this.persist({
      ...withLog,
      status: "error",
      errors: outcome.errors && outcome.errors.length > 0 ? outcome.errors : ["فشل الإرسال"],
      rejectionCodes: outcome.errorCodes ?? [],
    });
  }

  /**
   * اختبار الاتصال — asks the identity server for a token with the stored
   * credentials. Offline-safe: with no port and no credentials it reports
   * `missing_credentials` and opens no socket.
   */
  async testConnection(): Promise<EtaConnectionCheck> {
    const config = await this.deps.config.get();
    const identityUrl = resolveEtaEndpoints(config).identityUrl;
    if (!config.clientId || !config.hasClientSecret) {
      return {
        ok: false,
        reason: "missing_credentials",
        detail: "لم تُدخل بيانات الربط (Client ID/Secret) بعد.",
        identityUrl,
        checkedAt: this.now(),
      };
    }
    if (!this.transmitPort.checkCredentials) {
      return {
        ok: false,
        reason: "unreachable",
        detail: "الإرسال إلى المصلحة غير مُهيّأ في هذه النسخة.",
        identityUrl,
        checkedAt: this.now(),
      };
    }
    return this.transmitPort.checkCredentials(config);
  }

  /** Authority acceptance callback: مرسل → مقبول with the assigned UUID. */
  async markAccepted(id: string, etaUuid: string): Promise<EtaSubmission> {
    const submission = await this.require(id);
    const unrecorded = submission.status === EtaSubmissionState.Error && Boolean(submission.transmitStartedAt);
    if (submission.status !== EtaSubmissionState.Submitted && !unrecorded) {
      throw new InvalidEtaTransitionError(submission.status, "accept");
    }
    return this.persist({ ...submission, status: EtaSubmissionState.Accepted, etaUuid, errors: [], rejectionCodes: [], transmitStartedAt: null });
  }

  /** Authority rejection callback: مرسل → أخطاء with error messages. */
  async markError(id: string, errors: readonly string[]): Promise<EtaSubmission> {
    const submission = await this.require(id);
    if (!["submitted", "pending_signature"].includes(submission.status)) {
      throw new InvalidEtaTransitionError(submission.status, "reject");
    }
    return this.persist({ ...submission, status: "error", errors });
  }

  /** مستبعد — deliberately drop a document from submission (reason required). */
  async exclude(id: string, reason: string): Promise<EtaSubmission> {
    const submission = await this.require(id);
    if (reason.trim() === "") throw new EtaExclusionReasonRequiredError();
    if (submission.status === "accepted" || submission.status === "submitted") {
      throw new InvalidEtaTransitionError(submission.status, "exclude");
    }
    return this.persist({ ...submission, status: "excluded", exclusionReason: reason });
  }

  /**
   * إرسال كل الجاهز — submit every queued (ready) document. Offline transmit
   * failures leave the document queued and are collected rather than thrown, so
   * one unreachable document doesn't abort the batch.
   */
  async submitAllReady(): Promise<{ submitted: EtaSubmission[]; queued: string[] }> {
    const ready = (await this.deps.submissions.list("ready")).sort(queueOrder);
    const submitted: EtaSubmission[] = [];
    const queued: string[] = [];
    for (const s of ready) {
      try {
        submitted.push(await this.submit(s.id));
      } catch (err) {
        if (err instanceof EtaOfflineError || err instanceof EtaSubmissionInFlightError) queued.push(s.id);
        else if (!(err instanceof InvalidEtaTransitionError)) throw err;
      }
    }
    return { submitted, queued };
  }

  /**
   * One submission, payload and all. The payload is the only record of what
   * will be filed with the authority, so it has to be readable somewhere
   * (D121); the queue list deliberately omits it.
   */
  async findById(id: string): Promise<EtaSubmission | null> {
    return this.deps.submissions.findById(id);
  }

  async findByInternalId(internalId: string): Promise<EtaSubmission | null> {
    return this.deps.submissions.findByInternalId(internalId);
  }

  private async require(id: string): Promise<EtaSubmission> {
    if (this.inFlight.has(id)) throw new EtaSubmissionInFlightError(id);
    return this.found(id);
  }

  private async found(id: string): Promise<EtaSubmission> {
    const submission = await this.deps.submissions.findById(id);
    if (!submission) throw new EtaSubmissionNotFoundError(id);
    return submission;
  }

  private async holding<T>(ids: readonly string[], send: () => Promise<T>): Promise<T> {
    const busy = ids.find((id) => this.inFlight.has(id));
    if (busy !== undefined) throw new EtaSubmissionInFlightError(busy);
    for (const id of ids) this.inFlight.add(id);
    try {
      return await send();
    } finally {
      for (const id of ids) this.inFlight.delete(id);
    }
  }

  /** Keeps the last 50 round trips; a submission retried nightly for a month must not become the biggest row in the file. */
  private appendLog(submission: EtaSubmission, entries: readonly EtaTransmitLogEntry[] | undefined): EtaSubmission {
    if (!entries || entries.length === 0) return submission;
    return { ...submission, transmitLog: [...submission.transmitLog, ...entries].slice(-50) };
  }

  private async persist(next: EtaSubmission): Promise<EtaSubmission> {
    const updated = { ...next, updatedAt: this.now() };
    await this.deps.submissions.update(updated);
    return updated;
  }
}
