/**
 * الإرسال إلى مصلحة الضرائب — the real network leg of ETA e-invoicing.
 *
 * Two hops, both documented by the authority:
 *   1. OAuth2 client-credentials against the ETA identity server
 *      (`POST {identityUrl}/connect/token`, scope `InvoicingAPI`).
 *   2. `POST {apiBaseUrl}/documentsubmissions` with `{ documents: [...] }`,
 *      answering `acceptedDocuments` / `rejectedDocuments`.
 * Status afterwards comes from `GET {apiBaseUrl}/documents/{uuid}/raw`.
 *
 * An e-RECEIPT takes a different leg entirely (SDK, eReceipt APIs — see
 * {@link transmitReceipt}): the token is requested with the POS DEVICE's own
 * client id/secret and its `posserial` / `pososversion` / `posmodelframework` /
 * `presharedkey` headers, and the receipt is POSTed to `/receiptsubmissions` as
 * `{receipts, signatures}`. Sending a receipt down the invoice leg with the
 * company's InvoicingAPI token (D284) files nothing the receipt regime counts.
 *
 * Everything here is a port over an injected `EtaHttpClient`, so the whole leg
 * is testable against a fake server and — the rule this module exists under —
 * NO network call happens unless the operator configured credentials. An
 * unconfigured install refuses with {@link EtaOfflineError} and leaves the
 * document queued, exactly as the offline queue always did.
 */
import { ConnectionTurnLostError } from "../audit/audit-event.js";
import { EtaOfflineError } from "./errors.js";
import { resolveEtaEndpoints, type EtaConfig } from "./config.js";
import { ETA_RECEIPT_BATCH_MAX, serializeEtaReceiptSubmission } from "./receipt.js";
import type { EtaSubmission, EtaTransmitLogEntry } from "./submission.js";
import type {
  EtaTransmitPort,
  EtaTransmitResult,
  EtaStatusResult,
  EtaConnectionCheck,
  EtaReceiptBatchResult,
} from "./service.js";

export interface EtaHttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface EtaHttpResponse {
  readonly status: number;
  readonly body: string;
}

/** The one seam the network crosses. Injected everywhere so tests never open a socket. */
export type EtaHttpClient = (request: EtaHttpRequest) => Promise<EtaHttpResponse>;

/** The credentials the identity server needs. Read from the encrypted store, never from {@link EtaConfig}. */
export interface EtaCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface EtaCredentialsPort {
  read(): Promise<EtaCredentials | null>;
}

/**
 * What the authority issued for ONE registered POS device. The receipt token
 * endpoint refuses a request whose headers do not match the device it was
 * registered as, so all of these travel together.
 */
export interface EtaPosCredentials {
  readonly serial: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly osVersion: string | null;
  readonly modelFramework: string | null;
  readonly presharedKey: string | null;
}

/** Looks up the device a receipt was issued on. Read from the sealed store, never from a request. */
export interface EtaPosCredentialsPort {
  forSerial(serial: string): Promise<EtaPosCredentials | null>;
}

export interface EtaRetryPolicy {
  /** Total attempts per HTTP call, including the first. */
  readonly attempts: number;
  /** First backoff in milliseconds; doubled per retry. */
  readonly baseDelayMs: number;
}

export const DEFAULT_ETA_RETRY: EtaRetryPolicy = { attempts: 3, baseDelayMs: 500 };

export interface EtaHttpTransmitDeps {
  readonly http: EtaHttpClient;
  readonly credentials: EtaCredentialsPort;
  /** Per-device credentials for the e-receipt leg. Absent → receipts stay queued (offline). */
  readonly posCredentials?: EtaPosCredentialsPort;
  readonly retry?: EtaRetryPolicy;
  readonly now?: () => string;
  readonly sleep?: (ms: number) => Promise<void>;
}

const REDACTED = "«محجوب»";

/** The authority's own error envelope on a rejected document. */
interface EtaErrorDetail {
  readonly code?: string;
  readonly message?: string;
  readonly propertyPath?: string;
}

interface EtaRejectedDocument {
  readonly internalId?: string;
  readonly error?: { readonly code?: string; readonly message?: string; readonly details?: readonly EtaErrorDetail[] };
}

interface EtaAcceptedDocument {
  readonly uuid?: string;
  readonly internalId?: string;
  readonly longId?: string;
}

interface EtaReceiptSubmissionResponse {
  readonly submissionUUID?: string;
  readonly submissionId?: string;
  readonly acceptedDocuments?: readonly { readonly uuid?: string; readonly longId?: string; readonly receiptNumber?: string }[];
  readonly rejectedDocuments?: readonly {
    readonly uuid?: string;
    readonly receiptNumber?: string;
    readonly error?: { readonly message?: string; readonly code?: string; readonly details?: readonly EtaErrorDetail[] };
  }[];
  readonly error?: { readonly message?: string; readonly code?: string; readonly details?: readonly EtaErrorDetail[] };
}

interface EtaSubmissionResponse {
  readonly submissionId?: string;
  readonly acceptedDocuments?: readonly EtaAcceptedDocument[];
  readonly rejectedDocuments?: readonly EtaRejectedDocument[];
  readonly error?: { readonly message?: string; readonly details?: readonly EtaErrorDetail[] };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

/** One rejection line, paired with the authority's own error code when it sent one — see `EtaSubmission.rejectionCodes`. */
interface EtaFlattenedError {
  readonly message: string;
  readonly code: string | null;
}

function flattenErrorEntries(
  rejected: { readonly error?: EtaRejectedDocument["error"] } | undefined,
  fallback: string,
): EtaFlattenedError[] {
  if (!rejected?.error) return [{ message: fallback, code: null }];
  const head = { message: rejected.error.message ?? rejected.error.code ?? fallback, code: rejected.error.code ?? null };
  const details = (rejected.error.details ?? []).map((d) => ({
    message: [d.propertyPath, d.message ?? d.code].filter(Boolean).join(": "),
    code: d.code ?? null,
  }));
  return [head, ...details].filter((e) => e.message.trim() !== "");
}


// REQUIRED at the top of every catch in this file: each call here is made with
// the connection's turn handed back, and a caller that lost the turn must stop.
// Read as a transport failure it would be recorded without the turn; retried,
// a document the authority already has would be sent again.
function stopOnLostTurn(err: unknown): void {
  if (err instanceof ConnectionTurnLostError) throw err;
}

/** Retry only what a retry can fix: a transport failure, a rate limit, or the authority's own 5xx. */
function retryable(status: number | null): boolean {
  if (status === null) return true;
  return status === 408 || status === 429 || status >= 500;
}

export function createEtaHttpTransmitPort(deps: EtaHttpTransmitDeps): EtaTransmitPort {
  const retry = deps.retry ?? DEFAULT_ETA_RETRY;
  const now = deps.now ?? (() => new Date().toISOString());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function call(
    request: EtaHttpRequest,
    log: EtaTransmitLogEntry[],
    loggedBody: string | null,
  ): Promise<EtaHttpResponse> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= retry.attempts; attempt++) {
      try {
        const response = await deps.http(request);
        log.push({
          at: now(),
          attempt,
          method: request.method,
          url: request.url,
          requestBody: loggedBody,
          status: response.status,
          responseBody: response.body.slice(0, 8000),
          error: null,
        });
        if (!retryable(response.status) || attempt === retry.attempts) return response;
      } catch (err) {
        stopOnLostTurn(err);
        lastError = err;
        log.push({
          at: now(),
          attempt,
          method: request.method,
          url: request.url,
          requestBody: loggedBody,
          status: null,
          responseBody: "",
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempt === retry.attempts) throw err;
      }
      await sleep(retry.baseDelayMs * 2 ** (attempt - 1));
    }
    throw lastError ?? new Error("ETA request exhausted its attempts.");
  }

  async function token(config: EtaConfig, log: EtaTransmitLogEntry[]): Promise<string> {
    const credentials = await deps.credentials.read();
    if (!credentials || !credentials.clientId || !credentials.clientSecret) throw new EtaOfflineError();
    const { identityUrl } = resolveEtaEndpoints(config);
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      scope: "InvoicingAPI",
    });
    const response = await call(
      {
        method: "POST",
        url: `${identityUrl}/connect/token`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
      log,
      // SECURITY: the client secret travels in this body and must never reach
      // the submission log, which any accounting.eta.view holder can read.
      `grant_type=client_credentials&client_id=${credentials.clientId}&client_secret=${REDACTED}&scope=InvoicingAPI`,
    );
    const parsed = parseJson(response.body) as { access_token?: string } | null;
    if (response.status !== 200 || !parsed?.access_token) {
      throw new Error(`تعذّر الحصول على رمز الدخول من مصلحة الضرائب (${response.status}).`);
    }
    return parsed.access_token;
  }

  const posTokens = new Map<string, { readonly token: string; readonly expiresAt: number }>();
  const posTokenKey = (credentials: EtaPosCredentials, config: EtaConfig) =>
    `${config.environment}|${credentials.serial}|${credentials.clientId}`;

  /**
   * EXTERNAL CONTRACT (SDK, Authenticate POS): `POST {identity}/connect/token`,
   * client-credentials in the form body, and the device identified by the
   * `posserial`, `pososversion`, `posmodelframework` and `presharedkey`
   * headers. The token lasts `expires_in` seconds (an hour), so it is kept per
   * device and renewed a minute early rather than requested per receipt.
   */
  async function posToken(
    credentials: EtaPosCredentials,
    config: EtaConfig,
    log: EtaTransmitLogEntry[],
  ): Promise<string> {
    const cacheKey = posTokenKey(credentials, config);
    const cached = posTokens.get(cacheKey);
    if (cached && cached.expiresAt > Date.parse(now())) return cached.token;
    const { identityUrl } = resolveEtaEndpoints(config);
    const headers: Record<string, string> = {
      "content-type": "application/x-www-form-urlencoded",
      posserial: credentials.serial,
    };
    if (credentials.osVersion) headers.pososversion = credentials.osVersion;
    if (credentials.modelFramework) headers.posmodelframework = credentials.modelFramework;
    if (credentials.presharedKey) headers.presharedkey = credentials.presharedKey;
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
    const response = await call(
      { method: "POST", url: `${identityUrl}/connect/token`, headers, body: form.toString() },
      log,
      // SECURITY: neither the device secret nor its pre-shared key may reach the
      // submission log; the key travels in a header, which the log never holds.
      `grant_type=client_credentials&client_id=${credentials.clientId}&client_secret=${REDACTED}`,
    );
    const parsed = parseJson(response.body) as { access_token?: string; expires_in?: number; error?: string } | null;
    if (response.status !== 200 || !parsed?.access_token) {
      const reason = parsed?.error ? ` — ${parsed.error}` : "";
      throw new Error(`تعذّر الحصول على رمز دخول جهاز نقطة البيع ${credentials.serial} من مصلحة الضرائب (${response.status})${reason}.`);
    }
    const lifetime = typeof parsed.expires_in === "number" && parsed.expires_in > 0 ? parsed.expires_in : 3600;
    posTokens.set(cacheKey, {
      token: parsed.access_token,
      expiresAt: Date.parse(now()) + Math.max(0, lifetime - 60) * 1000,
    });
    return parsed.access_token;
  }

  async function receiptCredentials(submission: EtaSubmission): Promise<EtaPosCredentials> {
    const payload = submission.payload as { seller?: { deviceSerialNumber?: unknown } } | null;
    const fromPayload = typeof payload?.seller?.deviceSerialNumber === "string" ? payload.seller.deviceSerialNumber : "";
    const serial = (submission.receiptSerial ?? fromPayload).trim();
    const credentials = serial !== "" ? await deps.posCredentials?.forSerial(serial) : null;
    // The SDK's token table lists all four device headers without "optional";
    // a device registered without them is not ready to report.
    if (
      !credentials?.clientId ||
      !credentials.clientSecret ||
      !credentials.osVersion ||
      !credentials.modelFramework ||
      !credentials.presharedKey
    ) {
      throw new EtaOfflineError();
    }
    return credentials;
  }

  /**
   * EXTERNAL CONTRACT (SDK, Submit Receipt Documents): `POST
   * {api}/receiptsubmissions` takes `{receipts, signatures}` for up to 500
   * receipts of ONE device, answering 202 with `submissionUUID`,
   * `acceptedDocuments` and `rejectedDocuments` keyed by uuid/receiptNumber —
   * so a partially rejected batch still names which half was accepted. 422 is
   * DuplicateSubmission — the identical body already reached the authority
   * inside ten minutes — so the batch is filed and its receipts' status is
   * polled like any other, rather than sent a third time.
   */
  async function transmitReceiptBatch(
    submissions: readonly EtaSubmission[],
    config: EtaConfig,
  ): Promise<EtaReceiptBatchResult> {
    const [first] = submissions;
    if (!first) return { outcomes: [] };
    if (submissions.length > ETA_RECEIPT_BATCH_MAX) {
      throw new RangeError(`ETA receipt batch too large (${submissions.length} > ${ETA_RECEIPT_BATCH_MAX}).`);
    }
    const credentials = await receiptCredentials(first);
    const log: EtaTransmitLogEntry[] = [];
    const { apiBaseUrl } = resolveEtaEndpoints(config);
    const body = serializeEtaReceiptSubmission(submissions.map((s) => s.payload));
    let response: EtaHttpResponse | null = null;
    for (let round = 0; round < 2; round++) {
      let accessToken: string;
      try {
        accessToken = await posToken(credentials, config, log);
      } catch (err) {
        stopOnLostTurn(err);
        // Unreachable is offline, not rejected: the batch stays queued for the
        // next run instead of turning into an error. A real rejection from the
        // identity server (wrong device credentials) is not offline — every
        // receipt of the batch is refused with that reason instead of being
        // retried forever.
        if (log.at(-1)?.status === null) throw new EtaOfflineError();
        const message = err instanceof Error ? err.message : String(err);
        return { outcomes: submissions.map((submission) => ({ submissionId: submission.id, ok: false, errors: [message] })), log };
      }
      try {
        response = await call(
          {
            method: "POST",
            url: `${apiBaseUrl}/receiptsubmissions`,
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
              "accept-language": "ar",
            },
            body,
          },
          log,
          body.slice(0, 8000),
        );
      } catch (err) {
        stopOnLostTurn(err);
        throw new EtaOfflineError();
      }
      if (response.status !== 401) break;
      posTokens.delete(posTokenKey(credentials, config));
    }
    if (!response) {
      return { outcomes: submissions.map((submission) => ({ submissionId: submission.id, ok: false, errors: ["فشل الإرسال"] })), log };
    }

    const parsed = parseJson(response.body) as EtaReceiptSubmissionResponse | null;
    // 422 DuplicateSubmission, 429 and a 5xx apply to the WHOLE call, before
    // the authority evaluated any one receipt in it — the entire batch stays
    // queued for the next run rather than reporting every receipt in it as
    // individually rejected on a guess.
    if (response.status === 422 || response.status === 429 || response.status >= 500) throw new EtaOfflineError();
    if (response.status >= 400 || !parsed) {
      // A rejection at the CALL level (not per-document) — every receipt of
      // the batch is refused with the same reason, and the accepted half of a
      // LATER call is unaffected.
      const message = parsed?.error?.message ?? `رفضت مصلحة الضرائب إرسال الإيصالات (${response.status}).`;
      const details = (parsed?.error?.details ?? []).map((d) => [d.propertyPath, d.message ?? d.code].filter(Boolean).join(": "));
      const errors = [message, ...details].filter((m) => m.trim() !== "");
      return {
        outcomes: submissions.map((submission) => ({ submissionId: submission.id, ok: false, errors })),
        log,
      };
    }

    const mineOf = (submission: EtaSubmission) => (d: { readonly uuid?: string; readonly receiptNumber?: string }) =>
      (!!d.uuid && d.uuid === submission.etaUuid) || (!!d.receiptNumber && d.receiptNumber === submission.internalId);
    const outcomes = submissions.map((submission) => {
      const mine = mineOf(submission);
      const accepted = parsed.acceptedDocuments?.find(mine);
      if (accepted) {
        return {
          submissionId: submission.id,
          ok: true,
          etaUuid: accepted.uuid ?? submission.etaUuid ?? undefined,
        };
      }
      const rejectedEntries = flattenErrorEntries(
        parsed.rejectedDocuments?.find(mine),
        "رفضت مصلحة الضرائب الإيصال دون بيان السبب.",
      );
      return {
        submissionId: submission.id,
        ok: false,
        errors: rejectedEntries.map((e) => e.message),
        errorCodes: rejectedEntries.map((e) => e.code),
      };
    });
    return { submissionUUID: parsed.submissionUUID ?? parsed.submissionId ?? null, outcomes, log };
  }

  async function transmitReceipt(submission: EtaSubmission, config: EtaConfig): Promise<EtaTransmitResult> {
    const { submissionUUID, outcomes, log } = await transmitReceiptBatch([submission], config);
    const [outcome] = outcomes;
    if (!outcome) return { ok: false, errors: ["فشل الإرسال"], log };
    if (outcome.ok) return { ok: true, etaUuid: outcome.etaUuid, submissionId: submissionUUID ?? null, log };
    return { ok: false, errors: outcome.errors, errorCodes: outcome.errorCodes, log };
  }

  /** EXTERNAL CONTRACT (SDK, Get Receipt Details): `GET {api}/receipts/{uuid}/details`, status Valid/Invalid/Cancelled. */
  async function receiptStatus(submission: EtaSubmission, config: EtaConfig): Promise<EtaStatusResult> {
    if (!submission.etaUuid) throw new EtaOfflineError();
    const credentials = await receiptCredentials(submission);
    const log: EtaTransmitLogEntry[] = [];
    const { apiBaseUrl } = resolveEtaEndpoints(config);
    const accessToken = await posToken(credentials, config, log);
    const issued = (submission.payload as { header?: { dateTimeIssued?: string } } | null)?.header?.dateTimeIssued;
    const query = issued ? `?dateTimeIssued=${encodeURIComponent(issued)}` : "";
    const response = await call(
      {
        method: "GET",
        url: `${apiBaseUrl}/receipts/${encodeURIComponent(submission.etaUuid)}/details${query}`,
        headers: { authorization: `Bearer ${accessToken}`, "accept-language": "ar" },
      },
      log,
      null,
    );
    const parsed = parseJson(response.body) as
      | { status?: string; statusReason?: string; receipt?: { status?: string; statusReason?: string } }
      | null;
    if (response.status >= 400 || !parsed) {
      return { state: "unknown", errors: [`تعذّرت قراءة حالة الإيصال من مصلحة الضرائب (${response.status}).`], log };
    }
    const status = parsed.receipt?.status ?? parsed.status ?? "";
    const reason = parsed.receipt?.statusReason ?? parsed.statusReason ?? "";
    const raw = status.toLowerCase();
    if (raw === "valid") return { state: "accepted", errors: [], log };
    if (raw === "invalid" || raw === "rejected" || raw === "cancelled") {
      return { state: "rejected", errors: [reason || `حالة الإيصال لدى المصلحة: ${status}`], log };
    }
    return { state: "pending", errors: [], log };
  }

  return {
    async checkCredentials(config: EtaConfig): Promise<EtaConnectionCheck> {
      const { identityUrl } = resolveEtaEndpoints(config);
      const log: EtaTransmitLogEntry[] = [];
      try {
        await token(config, log);
        return { ok: true, reason: "connected", detail: null, identityUrl, checkedAt: now() };
      } catch (err) {
        stopOnLostTurn(err);
        if (err instanceof EtaOfflineError) {
          return {
            ok: false,
            reason: "missing_credentials",
            detail: "لم تُدخل بيانات الربط (Client ID/Secret) بعد.",
            identityUrl,
            checkedAt: now(),
          };
        }
        const last = log[log.length - 1];
        const rejected = last?.status !== null && last?.status !== undefined && last.status < 500;
        return {
          ok: false,
          reason: rejected ? "rejected" : "unreachable",
          detail: err instanceof Error ? err.message : String(err),
          identityUrl,
          checkedAt: now(),
        };
      }
    },

    async transmit(submission: EtaSubmission, config: EtaConfig): Promise<EtaTransmitResult> {
      if (submission.documentType === "receipt") return transmitReceipt(submission, config);
      const log: EtaTransmitLogEntry[] = [];
      const { apiBaseUrl } = resolveEtaEndpoints(config);
      let accessToken: string;
      try {
        accessToken = await token(config, log);
      } catch (err) {
        stopOnLostTurn(err);
        if (err instanceof EtaOfflineError) throw err;
        return { ok: false, errors: [err instanceof Error ? err.message : String(err)], log };
      }

      const body = JSON.stringify({ documents: [submission.payload] });
      let response: EtaHttpResponse;
      try {
        response = await call(
          {
            method: "POST",
            url: `${apiBaseUrl}/documentsubmissions`,
            headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
            body,
          },
          log,
          body.slice(0, 8000),
        );
      } catch (err) {
        stopOnLostTurn(err);
        return { ok: false, errors: [err instanceof Error ? err.message : String(err)], log };
      }

      const parsed = parseJson(response.body) as EtaSubmissionResponse | null;
      if (response.status >= 400 || !parsed) {
        const message = parsed?.error?.message ?? `رفضت مصلحة الضرائب الإرسال (${response.status}).`;
        return { ok: false, errors: [message], log };
      }
      const accepted = parsed.acceptedDocuments?.find(
        (d) => !d.internalId || d.internalId === submission.internalId,
      );
      if (accepted?.uuid) {
        return { ok: true, etaUuid: accepted.uuid, submissionId: parsed.submissionId ?? null, log };
      }
      const rejected = parsed.rejectedDocuments?.find(
        (d) => !d.internalId || d.internalId === submission.internalId,
      );
      const rejectedEntries = flattenErrorEntries(rejected, "رفضت مصلحة الضرائب المستند دون بيان السبب.");
      return {
        ok: false,
        errors: rejectedEntries.map((e) => e.message),
        errorCodes: rejectedEntries.map((e) => e.code),
        log,
      };
    },

    async fetchStatus(submission: EtaSubmission, config: EtaConfig): Promise<EtaStatusResult> {
      if (submission.documentType === "receipt") return receiptStatus(submission, config);
      if (!submission.etaUuid) throw new EtaOfflineError();
      const log: EtaTransmitLogEntry[] = [];
      const { apiBaseUrl } = resolveEtaEndpoints(config);
      const accessToken = await token(config, log);
      const response = await call(
        {
          method: "GET",
          url: `${apiBaseUrl}/documents/${encodeURIComponent(submission.etaUuid)}/raw`,
          headers: { authorization: `Bearer ${accessToken}` },
        },
        log,
        null,
      );
      const parsed = parseJson(response.body) as
        | {
            status?: string;
            validationResults?: {
              status?: string;
              validationSteps?: readonly { status?: string; error?: { message?: string; code?: string } }[];
            };
          }
        | null;
      if (response.status >= 400 || !parsed) {
        return { state: "unknown", errors: [`تعذّرت قراءة حالة المستند من مصلحة الضرائب (${response.status}).`], log };
      }
      const raw = (parsed.status ?? "").toLowerCase();
      if (raw === "valid") return { state: "accepted", errors: [], log };
      if (raw === "invalid" || raw === "rejected" || raw === "cancelled") {
        const failing = (parsed.validationResults?.validationSteps ?? [])
          .filter((s) => (s.status ?? "").toLowerCase() !== "valid")
          .filter((s) => (s.error?.message ?? "").trim() !== "");
        const errors = failing.map((s) => s.error!.message!);
        const errorCodes = failing.map((s) => s.error?.code ?? null);
        return {
          state: "rejected",
          errors: errors.length > 0 ? errors : [`حالة المستند لدى المصلحة: ${parsed.status}`],
          errorCodes: errors.length > 0 ? errorCodes : [null],
          log,
        };
      }
      return { state: "pending", errors: [], log };
    },

    transmitReceiptBatch,
  };
}

/**
 * The default client over the platform `fetch`. Kept here rather than in the
 * wiring so a caller that wants the real network leg does not have to
 * re-implement it; every test injects its own instead.
 */
export function fetchEtaHttpClient(timeoutMs = 30000): EtaHttpClient {
  return async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        body: request.body,
        signal: controller.signal,
      });
      return { status: response.status, body: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  };
}
