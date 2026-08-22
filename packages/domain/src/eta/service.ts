import type { EtaConfig, EtaConfigRepository } from "./config.js";
import { buildEtaPayload, type EtaDocumentInput } from "./payload.js";
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
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(private readonly deps: EtaServiceDeps) {
    this.transmitPort = deps.transmit ?? stubOnlineTransmitPort();
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
   * Submit one queued document. When the config requires an e-seal (v1.0
   * signing) a ready submission first moves to بانتظار التوقيع; otherwise it is
   * transmitted through the (stubbed) online port. An offline stub leaves it
   * queued and re-throws {@link EtaOfflineError}.
   */
  async submit(id: string): Promise<EtaSubmission> {
    const submission = await this.require(id);
    if (!["ready", "pending_signature", "error"].includes(submission.status)) {
      throw new InvalidEtaTransitionError(submission.status, "submit");
    }
    const config = await this.deps.config.get();

    if (config.signingMethod === "eseal" && submission.status === "ready") {
      return this.persist({ ...submission, status: "pending_signature", errors: [] });
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
