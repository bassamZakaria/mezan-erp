import type { EtaConfig, EtaConfigRepository } from "./config.js";
import { buildEtaPayload, type EtaDocumentInput } from "./payload.js";
import {
  buildEtaReceiptPayload,
  canonicalizeEtaDocument,
  etaReceiptQrValue,
  summarizeEtaReceiptQueue,
  unavailableEtaReceiptUuidPort,
  type EtaReceiptInput,
  type EtaReceiptQueueSummary,
  type EtaReceiptUuidPort,
} from "./receipt.js";
import {
  attachEtaSignature,
  etaPayloadIsSigned,
  unavailableEsealSigningPort,
  EtaSigningUnavailableError,
  type EtaSigningPort,
} from "./signing.js";
import type {
  EtaSubmission,
  EtaSubmissionRepository,
  EtaSubmissionStatus,
} from "./submission.js";
import {
  DuplicateEtaSubmissionError,
  EtaExclusionReasonRequiredError,
  EtaOfflineError,
  EtaSubmissionNotFoundError,
  InvalidEtaTransitionError,
} from "./errors.js";

/**
 * Result of a transmit attempt against the ETA gateway. `ok` → accepted for
 * processing (moves to مرسل); `errors` → rejected (moves to أخطاء).
 */
export interface EtaTransmitResult {
  readonly ok: boolean;
  readonly etaUuid?: string;
  readonly errors?: readonly string[];
}

/** Port for the ONLINE transmit step. See {@link stubOnlineTransmitPort}. */
export interface EtaTransmitPort {
  transmit(submission: EtaSubmission, config: EtaConfig): Promise<EtaTransmitResult>;
}

/**
 * ───────────────────────────────────────────────────────────────────────────
 * STUB — ONLINE-ONLY TRANSMIT. Real transmission to the Egyptian Tax Authority
 * requires a live HTTPS call to the ETA gateway with signed credentials, which
 * this build does NOT perform. The queue + lifecycle below are fully functional
 * offline; this stub stands in for the network leg and refuses with
 * {@link EtaOfflineError}, leaving the submission safely queued. Swap this port
 * for a real HTTP client to go live.
 * ───────────────────────────────────────────────────────────────────────────
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
  /** Defaults to the online-only stub — supply a real client to actually transmit. */
  readonly transmit?: EtaTransmitPort;
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
}

/** What a till needs to print (or reprint) one receipt. */
export interface EtaReceiptPrintData {
  readonly submission: EtaSubmission;
  readonly uuid: string;
  readonly qrValue: string;
}

/** Input to enqueue a confirmed document. */
export type EtaEnqueueInput = EtaDocumentInput;

/**
 * The ETA e-invoicing service: build the payload, queue a confirmed document,
 * drive the جاهز→بانتظار التوقيع→مرسل→مقبول lifecycle, and route the online
 * transmit through a (stubbed) port. All queue state is real and offline.
 */
export class EtaService {
  private readonly transmitPort: EtaTransmitPort;
  private readonly receiptUuidPort: EtaReceiptUuidPort;
  private readonly signingPort: EtaSigningPort;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(private readonly deps: EtaServiceDeps) {
    this.transmitPort = deps.transmit ?? stubOnlineTransmitPort();
    this.receiptUuidPort = deps.receiptUuid ?? unavailableEtaReceiptUuidPort();
    this.signingPort = deps.signing ?? unavailableEsealSigningPort();
    this.now = deps.now ?? (() => new Date().toISOString());
    this.newId = deps.newId ?? (() => `eta-${Math.random().toString(36).slice(2)}`);
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

  /** Build the payload and add a confirmed document to the queue in status جاهز. */
  async enqueue(input: EtaEnqueueInput): Promise<EtaSubmission> {
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
    };
    await this.deps.submissions.create(submission);
    return submission;
  }

  /**
   * إصدار إيصال إلكتروني — queue one receipt and hand back what the paper
   * needs. Unlike {@link enqueue} this is IDEMPOTENT: a receipt already in the
   * queue is returned as it stands, with the UUID it was printed with the
   * first time. A reprint is the same piece of paper, so it carries the same
   * identifier and the same QR — minting a second submission would report one
   * sale to the authority twice.
   *
   * The UUID is computed here, before printing, because the receipt is
   * reported AFTER the sale and the customer walks out with the QR in hand.
   */
  async enqueueReceipt(input: EtaReceiptInput): Promise<EtaReceiptPrintData> {
    const config = await this.deps.config.get();
    const existing = await this.deps.submissions.findByInternalId(input.internalId);
    if (existing) return this.receiptPrintData(existing, config);

    const payload = buildEtaReceiptPayload(input, config);
    const uuid = await this.receiptUuidPort.compute(canonicalizeEtaDocument(payload));
    const header = payload.header as Record<string, unknown>;
    header.uuid = uuid;
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
    };
    await this.deps.submissions.create(submission);
    return this.receiptPrintData(submission, config);
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
    const all = await this.deps.submissions.list();
    return summarizeEtaReceiptQueue(all, now ?? this.now());
  }

  private receiptPrintData(submission: EtaSubmission, config: EtaConfig): EtaReceiptPrintData {
    const payload = submission.payload as { header?: { dateTimeIssued?: string } } | null;
    const uuid = submission.etaUuid ?? "";
    return {
      submission,
      uuid,
      qrValue: etaReceiptQrValue({
        uuid,
        issueDateTime: payload?.header?.dateTimeIssued ?? submission.createdAt,
        environment: config.environment,
      }),
    };
  }

  /**
   * Submit one queued document. When the config requires an e-seal (v1.0
   * signing) a ready submission first moves to بانتظار التوقيع; otherwise it is
   * transmitted through the (stubbed) online port. An offline stub leaves it
   * queued and re-throws {@link EtaOfflineError}.
   */
  async submit(id: string): Promise<EtaSubmission> {
    let submission = await this.require(id);
    if (!["ready", "pending_signature", "error"].includes(submission.status)) {
      throw new InvalidEtaTransitionError(submission.status, "submit");
    }
    const config = await this.deps.config.get();

    if (config.signingMethod === "eseal" && !etaPayloadIsSigned(submission.payload)) {
      try {
        const signature = await this.signingPort.sign(submission, config);
        submission = await this.persist({
          ...submission,
          payload: attachEtaSignature(submission.payload, signature),
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

    const result = await this.transmitPort.transmit(submission, config);
    if (result.ok) {
      return this.persist({
        ...submission,
        status: "submitted",
        errors: [],
        etaUuid: result.etaUuid ?? submission.etaUuid,
        submittedAt: this.now(),
      });
    }
    return this.persist({ ...submission, status: "error", errors: result.errors ?? ["فشل الإرسال"] });
  }

  /** Authority acceptance callback: مرسل → مقبول with the assigned UUID. */
  async markAccepted(id: string, etaUuid: string): Promise<EtaSubmission> {
    const submission = await this.require(id);
    if (submission.status !== "submitted") {
      throw new InvalidEtaTransitionError(submission.status, "accept");
    }
    return this.persist({ ...submission, status: "accepted", etaUuid, errors: [] });
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
    const ready = await this.deps.submissions.list("ready");
    const submitted: EtaSubmission[] = [];
    const queued: string[] = [];
    for (const s of ready) {
      try {
        submitted.push(await this.submit(s.id));
      } catch (err) {
        if (err instanceof EtaOfflineError) queued.push(s.id);
        else throw err;
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
    const submission = await this.deps.submissions.findById(id);
    if (!submission) throw new EtaSubmissionNotFoundError(id);
    return submission;
  }

  private async persist(next: EtaSubmission): Promise<EtaSubmission> {
    const updated = { ...next, updatedAt: this.now() };
    await this.deps.submissions.update(updated);
    return updated;
  }
}
