import { resolveEtaEndpoints, type EtaConfig, type EtaConfigRepository } from "./config.js";
import { buildEtaPayload, type EtaDocumentInput } from "./payload.js";
import type {
  EtaSubmission,
  EtaSubmissionRepository,
  EtaSubmissionStatus,
  EtaTransmitLogEntry,
} from "./submission.js";
import { canonicalEtaJson, unconfiguredEtaSigner, type EtaSignerPort } from "./signer.js";
import {
  DuplicateEtaSubmissionError,
  EtaExclusionReasonRequiredError,
  EtaOfflineError,
  EtaSignerNotConfiguredError,
  EtaSigningFailedError,
  EtaSubmissionNotFoundError,
  InvalidEtaTransitionError,
} from "./errors.js";

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
  readonly log?: readonly EtaTransmitLogEntry[];
}

/** What the authority says about a document already transmitted. */
export interface EtaStatusResult {
  readonly state: "accepted" | "rejected" | "pending" | "unknown";
  readonly errors: readonly string[];
  readonly log?: readonly EtaTransmitLogEntry[];
}

/** Port for the ONLINE transmit step. See {@link stubOnlineTransmitPort} and `createEtaHttpTransmitPort`. */
export interface EtaTransmitPort {
  transmit(submission: EtaSubmission, config: EtaConfig): Promise<EtaTransmitResult>;
  /** Polls `GET /documents/{uuid}/raw`. Absent on ports that cannot reach the network. */
  fetchStatus?(submission: EtaSubmission, config: EtaConfig): Promise<EtaStatusResult>;
  /** اختبار الاتصال — a real token request against the identity server. */
  checkCredentials?(config: EtaConfig): Promise<EtaConnectionCheck>;
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
  private readonly signerPort: EtaSignerPort;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(private readonly deps: EtaServiceDeps) {
    this.transmitPort = deps.transmit ?? stubOnlineTransmitPort();
    this.signerPort = deps.signer ?? unconfiguredEtaSigner();
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
      gatewaySubmissionId: null,
      signature: null,
      transmitLog: [],
    };
    await this.deps.submissions.create(submission);
    return submission;
  }

  /**
   * Submit one queued document. When the config requires an e-seal (v1.0
   * signing) a ready submission first moves to بانتظار التوقيع; from there the
   * external signer runs and the signed document is transmitted. An install
   * with no credentials never opens a socket: the offline port refuses and the
   * document stays queued.
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

    let toTransmit = submission;
    if (config.signingMethod === "eseal" && !submission.signature) {
      try {
        const signature = await this.signerPort.sign(canonicalEtaJson(submission.payload));
        toTransmit = { ...submission, signature };
        await this.persist(toTransmit);
      } catch (err) {
        if (err instanceof EtaSignerNotConfiguredError || err instanceof EtaSigningFailedError) {
          // Stays بانتظار التوقيع: the document is not rejected, it is unsigned.
          await this.persist({ ...submission, status: "pending_signature", errors: [err.message] });
        }
        throw err;
      }
    }

    const result = await this.transmitPort.transmit(toTransmit, config);
    const withLog = this.appendLog(toTransmit, result.log);
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
    return this.persist({ ...withLog, status: "error", errors: result.errors ?? ["فشل الإرسال"] });
  }

  /**
   * تحديث الحالة من المصلحة — poll `GET /documents/{uuid}/raw` for one
   * transmitted document and record the clearance or the rejection. A port with
   * no network leg (or a document with no UUID) refuses offline and changes
   * nothing.
   */
  async refreshStatus(id: string): Promise<EtaSubmission> {
    const submission = await this.require(id);
    if (submission.status !== "submitted") throw new InvalidEtaTransitionError(submission.status, "refresh");
    if (!this.transmitPort.fetchStatus || !submission.etaUuid) throw new EtaOfflineError();
    const config = await this.deps.config.get();
    const result = await this.transmitPort.fetchStatus(submission, config);
    const withLog = this.appendLog(submission, result.log);
    if (result.state === "accepted") {
      return this.persist({ ...withLog, status: "accepted", errors: [] });
    }
    if (result.state === "rejected") {
      return this.persist({ ...withLog, status: "error", errors: result.errors });
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

    const pending = [
      ...(await this.deps.submissions.list("ready")),
      ...(await this.deps.submissions.list("pending_signature")),
    ];
    for (const s of pending) {
      try {
        const next = await this.submit(s.id);
        if (next.status === "submitted") submitted.push(next);
        else if (next.status === "error") rejected.push(next);
      } catch (err) {
        if (err instanceof EtaOfflineError) queued.push(s.id);
        else if (err instanceof EtaSignerNotConfiguredError || err instanceof EtaSigningFailedError) unsigned.push(s.id);
        else throw err;
      }
    }

    if (this.transmitPort.fetchStatus) {
      for (const s of await this.deps.submissions.list("submitted")) {
        try {
          const next = await this.refreshStatus(s.id);
          if (next.status === "accepted") accepted.push(next);
          else if (next.status === "error") rejected.push(next);
        } catch (err) {
          if (err instanceof EtaOfflineError) queued.push(s.id);
          else throw err;
        }
      }
    }

    return { submitted, accepted, rejected, queued, unsigned };
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

  private async require(id: string): Promise<EtaSubmission> {
    const submission = await this.deps.submissions.findById(id);
    if (!submission) throw new EtaSubmissionNotFoundError(id);
    return submission;
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
