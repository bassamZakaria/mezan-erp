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
 * Everything here is a port over an injected `EtaHttpClient`, so the whole leg
 * is testable against a fake server and — the rule this module exists under —
 * NO network call happens unless the operator configured credentials. An
 * unconfigured install refuses with {@link EtaOfflineError} and leaves the
 * document queued, exactly as the offline queue always did.
 */
import { EtaOfflineError } from "./errors.js";
import { resolveEtaEndpoints, type EtaConfig } from "./config.js";
import type { EtaSubmission, EtaTransmitLogEntry } from "./submission.js";
import type { EtaTransmitPort, EtaTransmitResult, EtaStatusResult, EtaConnectionCheck } from "./service.js";

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

function flattenErrors(rejected: EtaRejectedDocument | undefined, fallback: string): string[] {
  if (!rejected?.error) return [fallback];
  const head = rejected.error.message ?? rejected.error.code ?? fallback;
  const details = (rejected.error.details ?? []).map((d) =>
    [d.propertyPath, d.message ?? d.code].filter(Boolean).join(": "),
  );
  return [head, ...details].filter((s) => s.trim() !== "");
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

  return {
    async checkCredentials(config: EtaConfig): Promise<EtaConnectionCheck> {
      const { identityUrl } = resolveEtaEndpoints(config);
      const log: EtaTransmitLogEntry[] = [];
      try {
        await token(config, log);
        return { ok: true, reason: "connected", detail: null, identityUrl, checkedAt: now() };
      } catch (err) {
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
      const log: EtaTransmitLogEntry[] = [];
      const { apiBaseUrl } = resolveEtaEndpoints(config);
      let accessToken: string;
      try {
        accessToken = await token(config, log);
      } catch (err) {
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
      return {
        ok: false,
        errors: flattenErrors(rejected, "رفضت مصلحة الضرائب المستند دون بيان السبب."),
        log,
      };
    },

    async fetchStatus(submission: EtaSubmission, config: EtaConfig): Promise<EtaStatusResult> {
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
        | { status?: string; validationResults?: { status?: string; validationSteps?: readonly { status?: string; error?: { message?: string } }[] } }
        | null;
      if (response.status >= 400 || !parsed) {
        return { state: "unknown", errors: [`تعذّرت قراءة حالة المستند من مصلحة الضرائب (${response.status}).`], log };
      }
      const raw = (parsed.status ?? "").toLowerCase();
      if (raw === "valid") return { state: "accepted", errors: [], log };
      if (raw === "invalid" || raw === "rejected" || raw === "cancelled") {
        const steps = parsed.validationResults?.validationSteps ?? [];
        const errors = steps
          .filter((s) => (s.status ?? "").toLowerCase() !== "valid")
          .map((s) => s.error?.message ?? "")
          .filter((m) => m.trim() !== "");
        return { state: "rejected", errors: errors.length > 0 ? errors : [`حالة المستند لدى المصلحة: ${parsed.status}`], log };
      }
      return { state: "pending", errors: [], log };
    },
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
